import { shallowRef, toRaw, type Ref } from 'vue';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { isExpressionMode, type EditorLayer, type EditorMode, type ExpressionEditorMode, type ExpressionExportFormat, type MaskRaster, type Vec2 } from '../types';
import type { RenderingPayload } from '../webgpu/initWebGPU';
import { initWebGPU, cleanupWebGPU, uploadMask, uploadColour } from '../webgpu/initWebGPU';
import { draw, type DrawingParameters } from '../webgpu/draw';
import { updateFrameTexture, updateVideoTexture } from '../webgpu/loadTexture';
import { defaultVideoQuality } from '../constants';
import type { AdjustmentKey } from '../adjustments';
import { createBrushPainter } from '../canvas/brushPainter';
import { computeExportDimensions, computeExpressionLayout } from './computeExportDimensions';
import getResultTransform from './getResultTransform';
import getScaledLayersAndLines from './getScaledLayersAndLines';
import drawTextLayer from './drawTextLayer';
import drawStickerLayer from './drawStickerLayer';
import { loadLayerFonts } from '../fonts';
import { selectEncodingProfile } from './videoEncoding';
import { encodeTransparentImage } from './encodeImage';
import { createMaskRaster } from '../mask/maskRaster';
import { maskResolution } from '../mask/maskMath';
import type { EditingMediaState } from '../store/editorStore';
import { composeVideo, type ComposeFrame } from './composeVideo';
import { hasPixelEdits, sourceVideoTransform, type SourceVideoTransform } from './videoTransform';

export type MediaEditorFinalResultPayload = {
  blob: Blob;
  hasSound: boolean;
  thumb?: {
    blob: Blob;
    size: { width: number; height: number };
  };
};

/**
 * What a video edit amounts to without rendering it, so a host can apply trim, crop, turn and mirror
 * with a converter instead of the frame-by-frame export.
 */
export type VideoEditSummary = {
  /** null: the view is turned by a free angle or tilted, so only rendering reproduces it. */
  transform: SourceVideoTransform | null;
  /** Drawing, text, stickers, adjustments or curves: only rendering reproduces them. */
  pixelEdits: boolean;
  /** The output short side picked in the editor, or null when it was left where the editor opened. */
  quality: number | null;
  /** Seconds of the source the fractions in the state are of. */
  duration: number;
};

export type MediaEditorFinalResult = {
  preview?: Blob;
  getResult: () => MediaEditorFinalResultPayload | Promise<MediaEditorFinalResultPayload>;
  cancel?: () => void;
  isVideo: boolean;
  width: number;
  height: number;
  originalSrc: string;
  editingMediaState: EditingMediaState;
  /** 0..1 while `getResult()` renders a video. */
  creationProgress?: Ref<number>;
  videoEdit?: VideoEditSummary;
};

/** Bits per second for a rendered video of this size and frame rate. */
export type VideoBitrateFn = (width: number, height: number, frameRate: number) => number;

type CreateFinalResultArgs = {
  mediaSrc: string;
  mediaType: 'image' | 'video';
  mediaState: EditingMediaState;
  canvasSize: Vec2;
  mediaRatio: number;
  renderingPayload: Pick<RenderingPayload, 'media'>;
  /** The source file: its audio goes into a rendered video, and its frames are decoded from it. */
  getMediaBlob?: () => Promise<Blob | null>;
  /** A rendered video's bitrate; the editor's own profile by default. */
  videoBitrate?: VideoBitrateFn;
  mode?: EditorMode;
  /** Rasters behind `mediaState.mask.source`. */
  getMaskSource?: (id: number | null) => MaskRaster | null;
  /** Expression modes: file format and the size the file should stay under. */
  exportFormat?: ExpressionExportFormat;
  maxBytes?: number;
  /** The editor's device pixel ratio: brush lines are stored in device pixels. */
  pixelRatio?: number;
  /** The host's quality steps (output short sides); the top one is the default. */
  videoQualitySteps?: readonly number[];
  /** The quality the editor opened with: a quality still there was not picked. */
  initialVideoQuality?: number;
};

/** The rendered video's frame rate cap: a faster source loses frames, a slower one keeps its own. */
export const RENDER_MAX_FPS = 30;

// Export canvases are full output resolution; a zero size drops the backing store now, not at GC.
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

// Must match useCropOffset padding so transforms are consistent
function cropOffsetFor(canvasSize: Vec2) {
  return {
    left: 60,
    top: 60,
    width: canvasSize[0] - 120,
    height: canvasSize[1] - 180
  };
}

async function drawLayers(ctx: CanvasRenderingContext2D, layers: EditorLayer[]): Promise<void> {
  for (const layer of layers) {
    if (layer.type === 'text') drawTextLayer(ctx, layer);
    else if (layer.type === 'sticker') await drawStickerLayer(ctx, layer);
  }
}

export async function createFinalResult(args: CreateFinalResultArgs): Promise<MediaEditorFinalResult> {
  const { mediaSrc, mediaType, mediaState, canvasSize, mediaRatio, renderingPayload } = args;

  await loadLayerFonts(mediaState.resizableLayers);

  if (args.mode && isExpressionMode(args.mode) && mediaType === 'image') {
    return createExpressionResult(args, args.mode);
  }

  const cropOffset = cropOffsetFor(canvasSize);

  const videoType = mediaType === 'video' ? 'video' as const : undefined;
  const newRatio = mediaState.currentImageRatio || mediaRatio;
  const sizeConstraints = {
    sourceWidth: renderingPayload.media.width,
    sourceAspectRatio: mediaRatio,
    cropAspectRatio: newRatio,
    cropAreaSize: cropOffset,
    zoomScale: mediaState.scale,
    outputMode: videoType
  };

  // A video goes out at the quality set in the Adjustments tab (an output short side), never above the
  // crop's own size. It counts as picked when it moved from where the editor opened.
  let forcedQuality: number | undefined;
  let pickedQuality: number | null = null;
  if (videoType) {
    const [naturalW, naturalH] = computeExportDimensions(sizeConstraints);
    const naturalShort = Math.min(naturalW, naturalH);
    const defaultQuality = defaultVideoQuality(renderingPayload.media, args.videoQualitySteps);
    const quality = mediaState.videoQuality || defaultQuality;
    const opened = args.initialVideoQuality || defaultQuality;
    if (mediaState.videoQuality && mediaState.videoQuality !== opened) pickedQuality = mediaState.videoQuality;
    forcedQuality = Math.min(quality, naturalShort);
  }

  const [scaledWidth, scaledHeight] = computeExportDimensions({ ...sizeConstraints, forcedQuality });

  // Create offscreen canvas for rendering
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = scaledWidth;
  resultCanvas.height = scaledHeight;

  // A video's preview is its cover frame (the trim start until a cover is picked).
  const sourceDuration = renderingPayload.media.video?.duration;
  const duration = sourceDuration && Number.isFinite(sourceDuration) ? sourceDuration : 0;
  const coverPosition = clampToTrim(mediaState.videoThumbnailPosition, mediaState);

  const { payload: gpuPayload, context: gpuContext } = await initWebGPU({
    canvas: resultCanvas,
    mediaSrc,
    mediaType,
    videoTime: coverPosition * duration,
    waitToSeek: true
  });

  // Render brushes onto a separate canvas
  const brushResultCanvas = document.createElement('canvas');
  brushResultCanvas.width = scaledWidth;
  brushResultCanvas.height = scaledHeight;

  // The export payload and both canvases are owned here only. Releasing is idempotent because the
  // video path hands it to getResult()/cancel() while every earlier exit (return or throw) runs it too.
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    cleanupWebGPU(gpuPayload);
    gpuContext.unconfigure();
    releaseCanvas(resultCanvas);
    releaseCanvas(brushResultCanvas);
  };

  try {
    const finalTransform = getResultTransform({
      scaledWidth,
      scaledHeight,
      imageWidth: gpuPayload.media.width,
      imageHeight: gpuPayload.media.height,
      cropOffset,
      mediaState
    });

    // Draw with adjustments
    const drawParams: DrawingParameters = {
      rotation: finalTransform.rotation,
      scale: finalTransform.scale,
      translation: finalTransform.translation,
      imageSize: finalTransform.imageSize,
      flip: finalTransform.flip,
      perspective: mediaState.perspective,
      curves: mediaState.curves ?? { r: [0, 0], g: [0, 0], b: [0, 0] },
      selective: mediaState.selective ?? { hue: 0, range: 0, shift: 0, sat: 0, luma: 0 },
      ...(mediaState.adjustments as Record<AdjustmentKey, number>)
    };

    draw(gpuPayload.device, gpuContext, gpuPayload, drawParams);

    const { scaledLayers, scaledLines } = getScaledLayersAndLines({
      layers: mediaState.resizableLayers,
      lines: mediaState.brushDrawnLines,
      canvasSize,
      resultSize: [scaledWidth, scaledHeight],
      cropRatio: newRatio,
      pixelRatio: args.pixelRatio
    });

    // Redraw brush lines at output resolution
    if (scaledLines.length) {
      const painter = createBrushPainter({
        targetCanvas: brushResultCanvas,
        imageCanvas: resultCanvas
      });
      for (const line of scaledLines) {
        painter.commitLine(line);
      }
    }

    if (mediaType === 'image') {
      // Image export
      const compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = scaledWidth;
      compositeCanvas.height = scaledHeight;
      try {
        const ctx = compositeCanvas.getContext('2d')!;

        ctx.drawImage(resultCanvas, 0, 0);
        ctx.drawImage(brushResultCanvas, 0, 0);

        await drawLayers(ctx, scaledLayers);

        const blob = await new Promise<Blob>((resolve) =>
          compositeCanvas.toBlob((b) => resolve(b!), 'image/png')
        );

        return {
          preview: blob,
          getResult: () => ({ blob, hasSound: false }),
          isVideo: false,
          width: scaledWidth,
          height: scaledHeight,
          originalSrc: mediaSrc,
          editingMediaState: structuredClone(toRaw(mediaState))
        };
      } finally {
        // The PNG blob is self-contained; nothing GPU- or canvas-side needs to outlive this call.
        releaseCanvas(compositeCanvas);
        release();
      }
    }

    // Video export
    return await renderVideoResult({
      payload: gpuPayload,
      device: gpuPayload.device,
      context: gpuContext,
      resultCanvas,
      brushResultCanvas,
      scaledWidth,
      scaledHeight,
      scaledLayers,
      mediaState,
      mediaSrc,
      drawParams,
      args,
      release,
      videoEdit: {
        transform: sourceVideoTransform(mediaState, [renderingPayload.media.width, renderingPayload.media.height], cropOffset),
        pixelEdits: hasPixelEdits(mediaState),
        quality: pickedQuality,
        duration
      }
    });
  } catch (e) {
    release();
    throw e;
  }
}

/** A position (0..1 of the source) moved inside the trimmed range. */
function clampToTrim(position: number, state: Pick<EditingMediaState, 'videoCropStart' | 'videoCropLength'>): number {
  const start = state.videoCropStart;
  const end = state.videoCropStart + state.videoCropLength;
  return Math.min(end, Math.max(start, position || 0));
}

async function sourceBlob(args: CreateFinalResultArgs): Promise<Blob | null> {
  try {
    if (args.getMediaBlob) return await args.getMediaBlob();
    const response = await fetch(args.mediaSrc);
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

/**
 * The source's frames over [start, end) seconds, at most {@link RENDER_MAX_FPS} a second (a slower
 * source keeps its own rate: no frame is made up), each handed to `render` and yielded as what it drew.
 * Decoded with WebCodecs from the file when it can be; otherwise the `<video>` is stepped by seeking.
 */
async function* sourceFrames(opts: {
  blob: Blob | null;
  video: HTMLVideoElement;
  size: Vec2;
  start: number;
  end: number;
  signal: AbortSignal;
  render: (frame: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement) => Promise<CanvasImageSource>;
}): AsyncGenerator<ComposeFrame> {
  const { blob, video, size, start, end, signal, render } = opts;
  let lastSlot = -1;
  const takes = (t: number): boolean => {
    const slot = Math.floor(t * RENDER_MAX_FPS + 1e-6);
    if (slot <= lastSlot) return false;
    lastSlot = slot;
    return true;
  };

  if (blob) {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (track && (await track.canDecode().catch(() => false))) {
        const sink = new CanvasSink(track, { width: size[0], height: size[1], fit: 'fill', poolSize: 2 });
        for await (const { canvas, timestamp, duration } of sink.canvases(start, end)) {
          if (signal.aborted) return;
          const t = Math.max(0, timestamp - start);
          if (!takes(t)) continue;
          const image = await render(canvas);
          yield { image, timestamp: t, duration: Math.max(duration, 1 / RENDER_MAX_FPS) };
        }
        return;
      }
    } finally {
      input.dispose();
    }
  }

  // Seeking: one frame per step of the source's rate, as far as the element tells.
  const step = 1 / RENDER_MAX_FPS;
  for (let time = start; time < end - 1e-4; time += step) {
    if (signal.aborted) return;
    video.currentTime = time;
    await new Promise<void>((resolve) => {
      const done = () => {
        signal.removeEventListener('abort', done);
        resolve();
      };
      video.addEventListener('seeked', done, { once: true });
      signal.addEventListener('abort', done, { once: true });
    });
    if (signal.aborted) return;
    const t = time - start;
    if (!takes(t)) continue;
    const image = await render(video);
    yield { image, timestamp: t, duration: step };
  }
}

/** The source's frame rate, when the file says. */
async function sourceFrameRate(blob: Blob | null): Promise<number | null> {
  if (!blob) return null;
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const stats = await track.computePacketStats(120);
    return stats.averagePacketRate > 0 ? stats.averagePacketRate : null;
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

async function renderVideoResult(opts: {
  payload: RenderingPayload;
  device: GPUDevice;
  context: GPUCanvasContext;
  resultCanvas: HTMLCanvasElement;
  brushResultCanvas: HTMLCanvasElement;
  scaledWidth: number;
  scaledHeight: number;
  scaledLayers: EditorLayer[];
  mediaState: EditingMediaState;
  mediaSrc: string;
  drawParams: DrawingParameters;
  args: CreateFinalResultArgs;
  release: () => void;
  videoEdit: VideoEditSummary;
}): Promise<MediaEditorFinalResult> {
  const { payload, device, context, resultCanvas, brushResultCanvas, scaledWidth, scaledHeight, scaledLayers, mediaState, mediaSrc, drawParams, args, release, videoEdit } = opts;

  const video = payload.media.video!;
  const sourceDuration = video.duration;
  const startTime = sourceDuration * mediaState.videoCropStart;
  const endTime = sourceDuration * (mediaState.videoCropStart + mediaState.videoCropLength);
  const coverTime = clampToTrim(mediaState.videoThumbnailPosition, mediaState) * sourceDuration;

  const progress = shallowRef(0);
  const controller = new AbortController();
  let exporting = false;

  // Brush lines and layers do not move over time: drawn once, laid over every frame.
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = scaledWidth;
  overlayCanvas.height = scaledHeight;
  const overlayCtx = overlayCanvas.getContext('2d')!;
  overlayCtx.drawImage(brushResultCanvas, 0, 0);
  await drawLayers(overlayCtx, scaledLayers);
  const hasOverlay = scaledLayers.length > 0 || mediaState.brushDrawnLines.length > 0;

  // The preview is the cover frame, as initWebGPU seeked to it.
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = scaledWidth;
  previewCanvas.height = scaledHeight;
  const previewCtx = previewCanvas.getContext('2d')!;
  previewCtx.drawImage(resultCanvas, 0, 0);
  if (hasOverlay) previewCtx.drawImage(overlayCanvas, 0, 0);
  const previewBlob = await new Promise<Blob>((resolve) =>
    previewCanvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8)
  );
  releaseCanvas(previewCanvas);

  const releaseAll = (): void => {
    releaseCanvas(overlayCanvas);
    release();
  };

  const getResult = async (): Promise<MediaEditorFinalResultPayload> => {
    if (controller.signal.aborted) throw new DOMException('The export was cancelled.', 'AbortError');
    exporting = true;
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = scaledWidth;
    compositeCanvas.height = scaledHeight;
    const compositeCtx = compositeCanvas.getContext('2d')!;

    try {
      const blob = await sourceBlob(args);
      const fps = Math.min(RENDER_MAX_FPS, (await sourceFrameRate(blob)) ?? RENDER_MAX_FPS);
      const bitrate = args.videoBitrate?.(scaledWidth, scaledHeight, fps) ?? selectEncodingProfile(scaledWidth, scaledHeight, fps).bitrate;

      const render = async (frame: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement): Promise<CanvasImageSource> => {
        if (frame instanceof HTMLVideoElement) updateVideoTexture(device, payload.texture, frame);
        else updateFrameTexture(device, payload.texture, frame);
        draw(device, context, payload, drawParams);
        // Copied out in the task that drew it: a WebGPU canvas's texture does not outlive the task.
        compositeCtx.clearRect(0, 0, scaledWidth, scaledHeight);
        compositeCtx.drawImage(resultCanvas, 0, 0);
        if (hasOverlay) compositeCtx.drawImage(overlayCanvas, 0, 0);
        return compositeCanvas;
      };

      const result = await composeVideo({
        frames: sourceFrames({
          blob,
          video,
          size: [payload.media.width, payload.media.height],
          start: startTime,
          end: endTime,
          signal: controller.signal,
          render
        }),
        width: scaledWidth,
        height: scaledHeight,
        duration: endTime - startTime,
        bitrate,
        frameRate: fps,
        audio: !mediaState.videoMuted && blob ? { source: blob, start: startTime, end: endTime } : null,
        coverAt: coverTime - startTime,
        signal: controller.signal,
        onProgress: (f) => {
          progress.value = f;
        }
      });
      progress.value = 1;
      return result;
    } finally {
      exporting = false;
      releaseCanvas(compositeCanvas);
      releaseAll();
    }
  };

  return {
    preview: previewBlob,
    getResult,
    cancel: () => {
      controller.abort();
      // A running export stops at its next frame and releases in its own finally.
      if (!exporting) releaseAll();
    },
    isVideo: true,
    width: scaledWidth,
    height: scaledHeight,
    originalSrc: mediaSrc,
    editingMediaState: structuredClone(toRaw(mediaState)),
    creationProgress: progress,
    videoEdit
  };
}

/**
 * Sticker / emoji: the crop rendered at the preset size on a transparent canvas with the mask and
 * the outline, drawings and layers on top, then encoded as lossless WEBP (or PNG).
 */
async function createExpressionResult(args: CreateFinalResultArgs, mode: ExpressionEditorMode): Promise<MediaEditorFinalResult> {
  const { mediaSrc, mediaState, canvasSize, mediaRatio } = args;
  const cropOffset = cropOffsetFor(canvasSize);
  const layout = computeExpressionLayout(mode, mediaState.currentImageRatio || mediaRatio);
  const { width, height } = layout.content;

  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = width;
  resultCanvas.height = height;
  const brushCanvas = document.createElement('canvas');
  brushCanvas.width = width;
  brushCanvas.height = height;
  const outCanvas = document.createElement('canvas');
  outCanvas.width = layout.canvas[0];
  outCanvas.height = layout.canvas[1];

  const { payload, context } = await initWebGPU({
    canvas: resultCanvas,
    mediaSrc,
    mediaType: 'image',
    videoTime: 0,
    transparent: true
  });

  try {
    const { mask } = mediaState;
    const source = args.getMaskSource?.(mask.source) ?? null;
    if (source || mask.strokes.length) {
      const [mw, mh] = maskResolution(payload.media.width, payload.media.height);
      const raster = createMaskRaster(mw, mh, mw / payload.media.width);
      try {
        raster.render(source, mask.feather, mask.strokes, args.getMaskSource);
        uploadMask(payload, raster.canvas);
        if (raster.colourCanvas) uploadColour(payload, raster.colourCanvas);
      } finally {
        raster.dispose();
      }
    }

    const t = getResultTransform({
      scaledWidth: width,
      scaledHeight: height,
      imageWidth: payload.media.width,
      imageHeight: payload.media.height,
      cropOffset,
      mediaState
    });

    const drawParams: DrawingParameters = {
      rotation: t.rotation,
      scale: t.scale,
      translation: t.translation,
      imageSize: t.imageSize,
      flip: t.flip,
      perspective: mediaState.perspective,
      curves: mediaState.curves ?? { r: [0, 0], g: [0, 0], b: [0, 0] },
      selective: mediaState.selective ?? { hue: 0, range: 0, shift: 0, sat: 0, luma: 0 },
      ...(mediaState.adjustments as Record<AdjustmentKey, number>)
    };

    // Output pixels are the canvas pixels here, so the radius goes in as it is.
    const outline = mediaState.outline?.enabled && mediaState.outline.radius > 0
      ? { radius: mediaState.outline.radius, color: mediaState.outline.color }
      : null;
    draw(payload.device, context, payload, drawParams, outline);

    const { scaledLayers, scaledLines } = getScaledLayersAndLines({
      layers: mediaState.resizableLayers,
      lines: mediaState.brushDrawnLines,
      canvasSize,
      resultSize: [width, height],
      cropRatio: mediaState.currentImageRatio || mediaRatio,
      pixelRatio: args.pixelRatio
    });

    if (scaledLines.length) {
      const painter = createBrushPainter({ targetCanvas: brushCanvas, imageCanvas: resultCanvas });
      for (const line of scaledLines) painter.commitLine(line);
    }

    const ctx = outCanvas.getContext('2d')!;
    const { x, y } = layout.content;
    ctx.drawImage(resultCanvas, x, y);
    ctx.drawImage(brushCanvas, x, y);
    ctx.save();
    ctx.translate(x, y);
    await drawLayers(ctx, scaledLayers);
    ctx.restore();

    const blob = await encodeTransparentImage(outCanvas, { format: args.exportFormat, maxBytes: args.maxBytes });

    return {
      preview: blob,
      getResult: () => ({ blob, hasSound: false }),
      isVideo: false,
      width: layout.canvas[0],
      height: layout.canvas[1],
      originalSrc: mediaSrc,
      editingMediaState: structuredClone(toRaw(mediaState))
    };
  } finally {
    cleanupWebGPU(payload);
    context.unconfigure();
    releaseCanvas(resultCanvas);
    releaseCanvas(brushCanvas);
    releaseCanvas(outCanvas);
  }
}
