<template>
  <canvas ref="canvasEl" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { useCropOffset } from '../composables/useCropOffset';
import { useMaskPainterSlot, type MaskPainter } from '../composables/useMaskPainter';
import { initWebGPU, cleanupWebGPU, uploadMask, clearMask, uploadColour, clearColour, type RenderingPayload } from '../webgpu/initWebGPU';
import { draw, type DrawingParameters } from '../webgpu/draw';
import type { OutlineDrawParams } from '../webgpu/stickerCompositor';
import { updateVideoTexture } from '../webgpu/loadTexture';
import { fitToAspectRatio } from '../geometry';
import { resolveOutputQuality } from '../constants';
import { adjustmentsConfig } from '../adjustments';
import { ensureGizmoCanvas, removeGizmoCanvas, drawGizmos } from '../webgpu/debugGizmos';
import { isExpressionMode, type MaskStroke, type Vec2 } from '../types';
import { createMaskRaster, type MaskRasterCanvas } from '../mask/maskRaster';
import { canvasToSource, maskResolution, outlineRadiusOnCanvas } from '../mask/maskMath';
import { fitExpressionContent } from '../finalRender/computeExportDimensions';
import getResultTransform from '../finalRender/getResultTransform';

const { store, mode } = useMediaEditorContext();
const cropOffset = useCropOffset();
const canvasEl = ref<HTMLCanvasElement | null>(null);
const expression = isExpressionMode(mode) && store.mediaType === 'image';

let device: GPUDevice | null = null;
let context: GPUCanvasContext | null = null;
let payload: RenderingPayload | null = null;
let animFrameId: number | null = null;
let videoPlaybackId: number | null = null;
let disposed = false;

onMounted(async () => {
  if (!canvasEl.value) return;

  updateCanvasSizeIfNeeded();

  const result = await initWebGPU({
    canvas: canvasEl.value,
    mediaSrc: store.mediaSrc,
    mediaType: store.mediaType,
    videoTime: store.mediaState.videoCropStart,
    waitToSeek: true,
    transparent: expression
  });
  if (disposed) {
    cleanupWebGPU(result.payload);
    return;
  }

  payload = result.payload;
  context = result.context;
  device = payload.device;

  store.uiState.renderingPayload = payload;
  store.uiState.mediaSize = [payload.media.width, payload.media.height];
  store.uiState.mediaRatio = payload.media.width / payload.media.height;
  store.uiState.imageCanvas = canvasEl.value;

  // Set default video quality if not set
  if (!store.mediaState.videoQuality && store.mediaType === 'video') {
    store.mediaState.videoQuality = resolveOutputQuality(payload.media.height);
  }

  // Avatars start as a centred square. Emoji start uncropped: the export fits them into 100×100.
  if (mode === 'avatar' && !store.mediaState.currentImageRatio) {
    const co = cropOffset.value;
    const squareRatio = 1;
    const [w1, h1] = fitToAspectRatio(payload.media.width / payload.media.height, co.width, co.height);
    const [w2, h2] = fitToAspectRatio(squareRatio, co.width, co.height);
    store.mediaState.scale = Math.max(w2 / w1, h2 / h1);
    store.mediaState.currentImageRatio = squareRatio;
    store.uiState.fixedImageRatioKey = '1x1';
  } else if (!store.mediaState.currentImageRatio) {
    store.mediaState.currentImageRatio = payload.media.width / payload.media.height;
  }

  if (expression) syncMask();

  store.uiState.isReady = true;
  redraw();
});

onBeforeUnmount(() => {
  disposed = true;
  if (animFrameId !== null) cancelAnimationFrame(animFrameId);
  if (videoPlaybackId !== null) cancelAnimationFrame(videoPlaybackId);
  stopVideoPlayback();
  removeGizmoCanvas();
  if (maskPainterSlot.current === maskPainter) maskPainterSlot.current = null;
  maskRaster?.dispose();
  maskRaster = null;
  if (payload) cleanupWebGPU(payload);
});

// --- Mask (sticker modes) ---
// The raster is the source of truth on the CPU; the GPU gets it whole after a state change and in
// dirty rectangles while a stroke is being drawn.

let maskRaster: MaskRasterCanvas | null = null;
let rasterInSync = false;
let liveStroke: MaskStroke | null = null;

function ensureMaskRaster(): MaskRasterCanvas | null {
  if (maskRaster || !payload) return maskRaster;
  const [mw, mh] = maskResolution(payload.media.width, payload.media.height);
  maskRaster = createMaskRaster(mw, mh, mw / payload.media.width);
  return maskRaster;
}

function syncMask() {
  if (!payload) return;
  const m = store.mediaState.mask;
  const source = store.getMaskSource(m.source);
  if (!source && !m.strokes.length) {
    clearMask(payload);
    clearColour(payload);
    rasterInSync = false;
  } else {
    const raster = ensureMaskRaster();
    if (!raster) return;
    raster.render(source, m.feather, m.strokes, store.getMaskSource);
    rasterInSync = true;
    uploadMask(payload, raster.canvas);
    if (raster.colourCanvas) uploadColour(payload, raster.colourCanvas);
    else clearColour(payload);
  }
  scheduleRedraw();
}

/** The raster with every committed edit, rendered if it is not. */
function syncedRaster(): MaskRasterCanvas | null {
  const raster = ensureMaskRaster();
  if (!raster) return null;
  if (!rasterInSync) {
    const m = store.mediaState.mask;
    raster.render(store.getMaskSource(m.source), m.feather, m.strokes, store.getMaskSource);
    rasterInSync = true;
  }
  return raster;
}

// A feather slider changes the state on every pointer move; one re-render per frame is enough.
let maskSyncFrame: number | null = null;
function scheduleMaskSync() {
  if (maskSyncFrame !== null) return;
  maskSyncFrame = requestAnimationFrame(() => {
    maskSyncFrame = null;
    if (!liveStroke && !disposed) syncMask();
  });
}
onBeforeUnmount(() => {
  if (maskSyncFrame !== null) cancelAnimationFrame(maskSyncFrame);
});

if (expression) {
  watch(
    () => [store.mediaState.mask, store.mediaState.mask.source, store.mediaState.mask.feather, store.mediaState.mask.strokes.length],
    () => scheduleMaskSync()
  );
  watch(() => store.mediaState.outline, () => scheduleRedraw(), { deep: true });
}

function toSource(point: Vec2): Vec2 | null {
  if (!payload || !canvasEl.value) return null;
  return canvasToSource(
    point,
    store.uiState.finalTransform,
    [canvasEl.value.width, canvasEl.value.height],
    [payload.media.width, payload.media.height]
  );
}

function paintLive(from: number) {
  if (!payload || !liveStroke) return;
  const raster = syncedRaster();
  if (!raster) return;
  const rect = raster.drawStroke(liveStroke, from);
  uploadMask(payload, raster.canvas, rect);
  if (raster.colourCanvas) uploadColour(payload, raster.colourCanvas, rect);
  scheduleRedraw();
}

const maskPainter: MaskPainter = {
  begin(strokeMode: 'erase' | 'restore', size: number, point: Vec2) {
    const p = toSource(point);
    const scale = store.uiState.finalTransform.scale;
    if (!p || !(scale > 0)) return;
    liveStroke = { mode: strokeMode, size: size / scale, points: [p] };
    paintLive(0);
  },
  extend(point: Vec2) {
    const p = toSource(point);
    if (!p || !liveStroke) return;
    liveStroke.points.push(p);
    paintLive(liveStroke.points.length - 1);
  },
  end() {
    const stroke = liveStroke;
    liveStroke = null;
    if (stroke) store.addMaskStroke(stroke);
  },
  cancel() {
    if (!liveStroke) return false;
    liveStroke = null;
    syncMask();
    return true;
  },
  snapshot() {
    const raster = syncedRaster();
    return raster ? { width: raster.width, height: raster.height, data: raster.read(), colour: raster.readColour() } : null;
  },
  preview(rect, alpha, colour) {
    const raster = syncedRaster();
    if (!payload || !raster) return;
    raster.putAlpha(rect, alpha);
    uploadMask(payload, raster.canvas, rect);
    if (colour) raster.putColour(rect, colour);
    if (raster.colourCanvas) uploadColour(payload, raster.colourCanvas, rect);
    scheduleRedraw();
  },
  refresh() {
    syncMask();
  }
};

const maskPainterSlot = useMaskPainterSlot();
if (expression) maskPainterSlot.current = maskPainter;

function outlineOnCanvas(): OutlineDrawParams | null {
  const o = store.mediaState.outline;
  if (!expression || !payload || !o.enabled || o.radius <= 0 || !isExpressionMode(mode)) return null;
  const ratio = store.mediaState.currentImageRatio || payload.media.width / payload.media.height;
  const [w, h] = fitExpressionContent(mode, ratio);
  const { scale: outputScale } = getResultTransform({
    scaledWidth: w,
    scaledHeight: h,
    imageWidth: payload.media.width,
    imageHeight: payload.media.height,
    cropOffset: cropOffset.value,
    mediaState: store.mediaState
  });
  return { radius: outlineRadiusOnCanvas(o.radius, store.uiState.finalTransform.scale, outputScale), color: o.color };
}

// --- Video Playback ---
function getVideo(): HTMLVideoElement | null {
  return payload?.media.video ?? null;
}

function startVideoPlayback() {
  const video = getVideo();
  if (!video || !device || !payload) return;

  const startTime = video.duration * store.mediaState.videoCropStart;
  const endTime = video.duration * (store.mediaState.videoCropStart + store.mediaState.videoCropLength);

  if (video.currentTime < startTime || video.currentTime >= endTime) {
    video.currentTime = startTime;
  }

  video.play();
  videoPlaybackTick();
}

function stopVideoPlayback() {
  const video = getVideo();
  if (video) video.pause();
  if (videoPlaybackId !== null) {
    cancelAnimationFrame(videoPlaybackId);
    videoPlaybackId = null;
  }
}

function videoPlaybackTick() {
  const video = getVideo();
  if (!video || !device || !payload) return;

  const endTime = video.duration * (store.mediaState.videoCropStart + store.mediaState.videoCropLength);

  if (video.currentTime >= endTime) {
    video.currentTime = video.duration * store.mediaState.videoCropStart;
    video.pause();
    store.uiState.isPlaying = false;
    store.mediaState.currentVideoTime = store.mediaState.videoCropStart;
    updateVideoTextureFrame();
    redraw();
    return;
  }

  store.mediaState.currentVideoTime = video.currentTime / video.duration;
  updateVideoTextureFrame();
  redraw();
  videoPlaybackId = requestAnimationFrame(videoPlaybackTick);
}

function updateVideoTextureFrame() {
  const video = getVideo();
  if (!device || !payload || !video) return;
  updateVideoTexture(device, payload.texture, video);
}

watch(() => store.uiState.isPlaying, (playing) => {
  if (playing) {
    startVideoPlayback();
  } else {
    stopVideoPlayback();
  }
});

// Seek when user scrubs the timeline (only when not playing)
watch(() => store.mediaState.currentVideoTime, (time) => {
  if (store.uiState.isPlaying) return;
  const video = getVideo();
  if (!video) return;
  video.currentTime = time * video.duration;
  // Update texture after seek
  const onSeeked = () => {
    video.removeEventListener('seeked', onSeeked);
    updateVideoTextureFrame();
    redraw();
  };
  video.addEventListener('seeked', onSeeked);
});

// Watch finalTransform + adjustments for immediate redraw

watch(
  () => [store.uiState.finalTransform, store.uiState.canvasSize],
  () => { scheduleRedraw(); },
  { deep: true }
);

watch(
  () => store.uiState.debugGizmos,
  () => { scheduleRedraw(); }
);

watch(
  () => store.mediaState.perspective,
  () => { scheduleRedraw(); },
  { deep: true }
);

watch(
  () => store.mediaState.curves,
  () => { scheduleRedraw(); },
  { deep: true }
);

watch(
  () => store.mediaState.selective,
  () => { scheduleRedraw(); },
  { deep: true }
);

watch(
  () => store.mediaState.adjustments,
  () => { scheduleRedraw(); },
  { deep: true }
);

function scheduleRedraw() {
  if (animFrameId !== null) return;
  animFrameId = requestAnimationFrame(() => {
    animFrameId = null;
    redraw();
  });
}

function redraw() {
  if (!device || !context || !payload || !canvasEl.value) return;

  updateCanvasSizeIfNeeded();

  const ft = store.uiState.finalTransform;

  const adjustmentValues = Object.fromEntries(
    adjustmentsConfig.map(({ key }) => {
      return [key, store.mediaState.adjustments[key]];
    })
  );

  const params: DrawingParameters = {
    rotation: ft.rotation,
    scale: ft.scale,
    translation: ft.translation,
    imageSize: [payload.media.width, payload.media.height],
    flip: ft.flip,
    perspective: store.mediaState.perspective,
    curves: store.mediaState.curves ?? { r: [0, 0], g: [0, 0], b: [0, 0] },
    selective: store.mediaState.selective ?? { hue: 0, range: 0, shift: 0, sat: 0, luma: 0 },
    ...adjustmentValues as any
  };

  draw(device, context, payload, params, outlineOnCanvas());

  // Debug gizmos overlay
  if (store.uiState.debugGizmos && canvasEl.value?.parentElement) {
    ensureGizmoCanvas(canvasEl.value.parentElement);
    const co = cropOffset.value;
    drawGizmos({
      canvasSize: store.uiState.canvasSize!,
      pixelRatio: store.uiState.pixelRatio,
      mediaSize: [payload.media.width, payload.media.height],
      cropOffset: co,
      currentImageRatio: store.mediaState.currentImageRatio,
      params
    });
  } else {
    removeGizmoCanvas();
  }
}

let lastCanvasWidth = 0;
let lastCanvasHeight = 0;

function updateCanvasSizeIfNeeded() {
  if (!canvasEl.value || !store.uiState.canvasSize) return;
  const dpr = store.uiState.pixelRatio;
  const [w, h] = store.uiState.canvasSize;
  const targetW = Math.round(w * dpr);
  const targetH = Math.round(h * dpr);
  if (targetW !== lastCanvasWidth || targetH !== lastCanvasHeight) {
    canvasEl.value.width = targetW;
    canvasEl.value.height = targetH;
    lastCanvasWidth = targetW;
    lastCanvasHeight = targetH;
  }
}

defineExpose({ redraw, canvasEl });
</script>
