import { toRaw } from 'vue';
import { isExpressionMode, type EditorLayer, type EditorMode, type ExpressionEditorMode, type ExpressionExportFormat, type MaskRaster, type Vec2 } from '../types';
import type { BrushDrawnLine } from '../canvas/brushPainter';
import type { RenderingPayload } from '../webgpu/initWebGPU';
import { initWebGPU, cleanupWebGPU, uploadMask } from '../webgpu/initWebGPU';
import { draw, type DrawingParameters } from '../webgpu/draw';
import { updateVideoTexture } from '../webgpu/loadTexture';
import { resolveOutputQuality } from '../constants';
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

export type MediaEditorFinalResultPayload = {
  blob: Blob;
  hasSound: boolean;
  thumb?: {
    blob: Blob;
    size: { width: number; height: number };
  };
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
  creationProgress?: { value: number };
};

type CreateFinalResultArgs = {
  mediaSrc: string;
  mediaType: 'image' | 'video';
  mediaState: EditingMediaState;
  canvasSize: Vec2;
  mediaRatio: number;
  renderingPayload: Pick<RenderingPayload, 'media'>;
  getMediaBlob?: () => Promise<Blob | null>;
  mode?: EditorMode;
  /** Rasters behind `mediaState.mask.source`. */
  getMaskSource?: (id: number | null) => MaskRaster | null;
  /** Expression modes: file format and the size the file should stay under. */
  exportFormat?: ExpressionExportFormat;
  maxBytes?: number;
  /** The editor's device pixel ratio: brush lines are stored in device pixels. */
  pixelRatio?: number;
};

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

  const [scaledWidth, scaledHeight] = computeExportDimensions({
    sourceWidth: renderingPayload.media.width,
    sourceAspectRatio: mediaRatio,
    cropAspectRatio: newRatio,
    cropAreaSize: cropOffset,
    zoomScale: mediaState.scale,
    outputMode: videoType,
    forcedQuality: videoType ? resolveOutputQuality(
      computeExportDimensions({ sourceWidth: renderingPayload.media.width, sourceAspectRatio: mediaRatio, cropAspectRatio: newRatio, cropAreaSize: cropOffset, zoomScale: mediaState.scale, outputMode: videoType })[1]
    ) : undefined
  });

  // Create offscreen canvas for rendering
  const resultCanvas = document.createElement('canvas');
  resultCanvas.width = scaledWidth;
  resultCanvas.height = scaledHeight;

  const { payload: gpuPayload, context: gpuContext } = await initWebGPU({
    canvas: resultCanvas,
    mediaSrc,
    mediaType,
    videoTime: mediaState.videoCropStart,
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
      scaledLines,
      mediaState,
      mediaSrc,
      drawParams,
      args,
      release
    });
  } catch (e) {
    release();
    throw e;
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
  scaledLines: BrushDrawnLine[];
  mediaState: EditingMediaState;
  mediaSrc: string;
  drawParams: DrawingParameters;
  args: CreateFinalResultArgs;
  release: () => void;
}): Promise<MediaEditorFinalResult> {
  const { payload, device, context, resultCanvas, brushResultCanvas, scaledWidth, scaledHeight, scaledLayers, scaledLines, mediaState, mediaSrc, drawParams, args, release } = opts;

  const video = payload.media.video!;
  const startTime = video.duration * mediaState.videoCropStart;
  const endTime = video.duration * (mediaState.videoCropStart + mediaState.videoCropLength);
  const duration = endTime - startTime;

  const progress = { value: 0 };
  let canceled = false;
  let exporting = false;

  // Generate preview from first frame
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = scaledWidth;
  previewCanvas.height = scaledHeight;
  const previewCtx = previewCanvas.getContext('2d')!;
  previewCtx.drawImage(resultCanvas, 0, 0);
  previewCtx.drawImage(brushResultCanvas, 0, 0);
  await drawLayers(previewCtx, scaledLayers);

  const previewBlob = await new Promise<Blob>((resolve) =>
    previewCanvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8)
  );
  releaseCanvas(previewCanvas);

  const getResult = async (): Promise<MediaEditorFinalResultPayload> => {
    exporting = true;
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = scaledWidth;
    compositeCanvas.height = scaledHeight;
    let encoder: VideoEncoder | undefined;

    try {
      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: {
          codec: 'avc',
          width: scaledWidth,
          height: scaledHeight
        },
        fastStart: 'in-memory'
      });

      const { codec, bitrate } = selectEncodingProfile(scaledWidth, scaledHeight, 30);

      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => console.error('VideoEncoder error:', e)
      });

      encoder.configure({
        codec,
        width: scaledWidth,
        height: scaledHeight,
        bitrate
      });

      const compositeCtx = compositeCanvas.getContext('2d')!;

      const expectedFps = 30;
      const totalFrames = Math.ceil(duration * expectedFps);

      for (let frameIdx = 0; frameIdx < totalFrames && !canceled; frameIdx++) {
        const time = startTime + frameIdx / expectedFps;
        const timestamp = (frameIdx / expectedFps) * 1e6;

        // Seek video to frame
        video.currentTime = time;
        await new Promise<void>((resolve) => {
          video.addEventListener('seeked', () => resolve(), { once: true });
        });

        // Update WebGPU texture
        updateVideoTexture(device, payload.texture, video);
        draw(device, context, payload, drawParams);

        // Compose
        compositeCtx.clearRect(0, 0, scaledWidth, scaledHeight);
        compositeCtx.drawImage(resultCanvas, 0, 0);
        compositeCtx.drawImage(brushResultCanvas, 0, 0);
        await drawLayers(compositeCtx, scaledLayers);

        // Encode frame
        const frame = new VideoFrame(compositeCanvas, {
          timestamp,
          duration: 1e6 / expectedFps
        });
        encoder.encode(frame, { keyFrame: frameIdx % 60 === 0 });
        frame.close();

        progress.value = frameIdx / totalFrames;
      }

      await encoder.flush();
      encoder.close();
      muxer.finalize();

      const blob = new Blob([target.buffer], { type: 'video/mp4' });

      return { blob, hasSound: false };
    } finally {
      exporting = false;
      // Left open after a failed export the encoder keeps its codec session; already closed on success.
      if (encoder && encoder.state !== 'closed') encoder.close();
      releaseCanvas(compositeCanvas);
      release();
    }
  };

  return {
    preview: previewBlob,
    getResult,
    cancel: () => {
      canceled = true;
      // A running export is awaiting `seeked` on the video; unloading it underneath would leave that
      // wait hanging forever, so the export's own finally releases once the loop has bailed out.
      if (!exporting) release();
    },
    isVideo: true,
    width: scaledWidth,
    height: scaledHeight,
    originalSrc: mediaSrc,
    editingMediaState: structuredClone(toRaw(mediaState)),
    creationProgress: progress
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
