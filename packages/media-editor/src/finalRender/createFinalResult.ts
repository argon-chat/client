import { toRaw } from 'vue';
import type { Vec2 } from '../types';
import type { BrushDrawnLine } from '../canvas/brushPainter';
import type { RenderingPayload } from '../webgpu/initWebGPU';
import { initWebGPU, cleanupWebGPU } from '../webgpu/initWebGPU';
import { draw, type DrawingParameters } from '../webgpu/draw';
import { updateVideoTexture } from '../webgpu/loadTexture';
import { resolveOutputQuality } from '../constants';
import { fitToAspectRatio } from '../geometry';
import type { AdjustmentKey } from '../adjustments';
import { createBrushPainter } from '../canvas/brushPainter';
import { computeExportDimensions } from './computeExportDimensions';
import getResultTransform from './getResultTransform';
import getScaledLayersAndLines from './getScaledLayersAndLines';
import drawTextLayer from './drawTextLayer';
import { selectEncodingProfile, RENDER_FPS } from './videoEncoding';
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
  renderingPayload: RenderingPayload;
  getMediaBlob?: () => Promise<Blob | null>;
};

export async function createFinalResult(args: CreateFinalResultArgs): Promise<MediaEditorFinalResult> {
  const { mediaSrc, mediaType, mediaState, canvasSize, mediaRatio, renderingPayload } = args;

  // Must match useCropOffset padding so transforms are consistent
  const cropOffset = {
    left: 60,
    top: 60,
    width: canvasSize[0] - 120,
    height: canvasSize[1] - 180
  };

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

  const finalTransform = getResultTransform({
    scaledWidth,
    scaledHeight,
    imageWidth: gpuPayload.media.width,
    imageHeight: gpuPayload.media.height,
    canvasSize,
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
    ...(mediaState.adjustments as Record<AdjustmentKey, number>)
  };

  draw(gpuPayload.device, gpuContext, gpuPayload, drawParams);

  // Render brushes onto a separate canvas
  const brushResultCanvas = document.createElement('canvas');
  brushResultCanvas.width = scaledWidth;
  brushResultCanvas.height = scaledHeight;

  const { scaledLayers, scaledLines } = getScaledLayersAndLines({
    layers: mediaState.resizableLayers,
    lines: mediaState.brushDrawnLines,
    canvasSize,
    resultSize: [scaledWidth, scaledHeight]
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
    const ctx = compositeCanvas.getContext('2d')!;

    ctx.drawImage(resultCanvas, 0, 0);
    ctx.drawImage(brushResultCanvas, 0, 0);

    // Draw text layers
    for (const layer of scaledLayers) {
      if (layer.type === 'text') drawTextLayer(ctx, layer);
    }

    const blob = await new Promise<Blob>((resolve) =>
      compositeCanvas.toBlob((b) => resolve(b!), 'image/png')
    );

    cleanupWebGPU(gpuPayload);

    return {
      preview: blob,
      getResult: () => ({ blob, hasSound: false }),
      isVideo: false,
      width: scaledWidth,
      height: scaledHeight,
      originalSrc: mediaSrc,
      editingMediaState: structuredClone(toRaw(mediaState))
    };
  }

  // Video export
  return renderVideoResult({
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
    args
  });
}

async function renderVideoResult(opts: {
  payload: RenderingPayload;
  device: GPUDevice;
  context: GPUCanvasContext;
  resultCanvas: HTMLCanvasElement;
  brushResultCanvas: HTMLCanvasElement;
  scaledWidth: number;
  scaledHeight: number;
  scaledLayers: any[];
  scaledLines: BrushDrawnLine[];
  mediaState: EditingMediaState;
  mediaSrc: string;
  drawParams: DrawingParameters;
  args: CreateFinalResultArgs;
}): Promise<MediaEditorFinalResult> {
  const { payload, device, context, resultCanvas, brushResultCanvas, scaledWidth, scaledHeight, scaledLayers, scaledLines, mediaState, mediaSrc, drawParams, args } = opts;

  const video = payload.media.video!;
  const startTime = video.duration * mediaState.videoCropStart;
  const endTime = video.duration * (mediaState.videoCropStart + mediaState.videoCropLength);
  const duration = endTime - startTime;

  const progress = { value: 0 };
  let canceled = false;

  // Generate preview from first frame
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = scaledWidth;
  previewCanvas.height = scaledHeight;
  const previewCtx = previewCanvas.getContext('2d')!;
  previewCtx.drawImage(resultCanvas, 0, 0);
  previewCtx.drawImage(brushResultCanvas, 0, 0);

  const previewBlob = await new Promise<Blob>((resolve) =>
    previewCanvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.8)
  );

  const getResult = async (): Promise<MediaEditorFinalResultPayload> => {
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

    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('VideoEncoder error:', e)
    });

    encoder.configure({
      codec,
      width: scaledWidth,
      height: scaledHeight,
      bitrate
    });

    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = scaledWidth;
    compositeCanvas.height = scaledHeight;
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
      for (const layer of scaledLayers) {
        if (layer.type === 'text') drawTextLayer(compositeCtx, layer);
      }

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

    cleanupWebGPU(payload);

    return { blob, hasSound: false };
  };

  return {
    preview: previewBlob,
    getResult,
    cancel: () => { canceled = true; },
    isVideo: true,
    width: scaledWidth,
    height: scaledHeight,
    originalSrc: mediaSrc,
    editingMediaState: structuredClone(toRaw(mediaState)),
    creationProgress: progress
  };
}
