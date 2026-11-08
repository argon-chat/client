<template>
  <canvas ref="canvasEl" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { useCropOffset } from '../composables/useCropOffset';
import { useMaskPainterSlot, type MaskPainter } from '../composables/useMaskPainter';
import { initWebGPU, cleanupWebGPU, uploadMask, clearMask, uploadColour, clearColour, type RenderingPayload } from '../webgpu/initWebGPU';
import { draw, type DrawingParameters } from '../webgpu/draw';
import type { OutlineDrawParams } from '../webgpu/stickerCompositor';
import { updateVideoTexture } from '../webgpu/loadTexture';
import { fitToAspectRatio } from '../geometry';
import { defaultVideoQuality } from '../constants';
import { adjustmentsConfig } from '../adjustments';
import { ensureGizmoCanvas, removeGizmoCanvas, drawGizmos } from '../webgpu/debugGizmos';
import { isExpressionMode, type MaskStroke, type Vec2 } from '../types';
import { createMaskRaster, type MaskRasterCanvas } from '../mask/maskRaster';
import { canvasToSource, maskResolution, outlineRadiusOnCanvas } from '../mask/maskMath';
import { fitExpressionContent } from '../finalRender/computeExportDimensions';
import getResultTransform from '../finalRender/getResultTransform';
import { uploadAnnotation, clearAnnotation } from '../webgpu/annotations';
import { rasterSize, previewRasterSize } from '../canvas/annotationSpace';
import { drawAnnotationLayers } from '../canvas/annotationRaster';
import { getPreferredFormat } from '../webgpu/initDevice';
import { imageProjection, projectionBasis } from '../canvas/projective';


const { store, mode, videoQualitySteps } = useMediaEditorContext();
const cropOffset = useCropOffset();
const canvasEl = ref<HTMLCanvasElement | null>(null);
const expression = isExpressionMode(mode) && store.mediaType === 'image';

let device: GPUDevice | null = null;
let context: GPUCanvasContext | null = null;
let payload: RenderingPayload | null = null;
let animFrameId: number | null = null;
let videoPlaybackId: number | null = null;
let disposed = false;
const initAbort = new AbortController();

onMounted(async () => {
  const ownedCanvas = canvasEl.value;
  if (!ownedCanvas) return;

  updateCanvasSizeIfNeeded();

  const result = await initWebGPU({
    canvas: ownedCanvas,
    mediaSrc: store.mediaSrc,
    mediaType: store.mediaType,
    videoTime: 0,
    videoPosition: store.mediaState.videoCropStart,
    waitToSeek: true,
    transparent: expression,
    signal: initAbort.signal,
  }).catch(error => {
    if (disposed) return null;
    throw error;
  });
  if (!result) return;
  if (disposed) {
    try { cleanupWebGPU(result.payload); } finally { ownedCanvas.width = ownedCanvas.height = 0; }
    return;
  }

  payload = result.payload;
  context = result.context;
  device = payload.device;

  store.uiState.renderingPayload = payload;
  store.uiState.mediaSize = [payload.media.width, payload.media.height];
  store.uiState.mediaRatio = payload.media.width / payload.media.height;
  store.uiState.imageCanvas = ownedCanvas;

  // Set default video quality if not set
  if (!store.mediaState.videoQuality && store.mediaType === 'video') {
    store.mediaState.videoQuality = defaultVideoQuality(payload.media, videoQualitySteps?.value);
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

  await nextTick();
  store.ensureSourceAnnotations();
  updateAnnotationDensity();
  store.uiState.getSourceImageCanvas = getSourceImageCanvas;
  store.uiState.isReady = true;
  scheduleLayerSync();
  redraw();
});

onBeforeUnmount(() => {
  disposed = true;
  layerGeneration++;
  if (layerSyncFrame !== null) cancelAnimationFrame(layerSyncFrame);
  if (sourceInvalidationFrame !== null) cancelAnimationFrame(sourceInvalidationFrame);
  sourceContext?.unconfigure();
  if (sourceCanvas) sourceCanvas.width = sourceCanvas.height = 0;
  if (sourceSnapshot) sourceSnapshot.width = sourceSnapshot.height = 0;
  if (layersCanvas) layersCanvas.width = layersCanvas.height = 0;
  store.uiState.getSourceImageCanvas = undefined;
  initAbort.abort();
  if (animFrameId !== null) cancelAnimationFrame(animFrameId);
  if (videoPlaybackId !== null) cancelAnimationFrame(videoPlaybackId);
  stopVideoPlayback();
  removeGizmoCanvas();
  if (maskPainterSlot.current === maskPainter) maskPainterSlot.current = null;
  maskRaster?.dispose();
  maskRaster = null;
  const ownedCanvas = canvasEl.value;
  try {
    if (payload) cleanupWebGPU(payload);
  } finally {
    if (store.uiState.renderingPayload === payload) {
      store.uiState.renderingPayload = undefined;
      store.uiState.isReady = false;
    }
    if (store.uiState.imageCanvas === ownedCanvas) store.uiState.imageCanvas = undefined;
    if (ownedCanvas) ownedCanvas.width = ownedCanvas.height = 0;
    payload = null;
    context = null;
    device = null;
  }
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
  invalidateSourceSnapshot();
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
  invalidateSourceSnapshot();
  scheduleRedraw();
}

const maskPainter: MaskPainter = {
  begin(strokeMode: 'erase' | 'restore', size: number, point: Vec2) {
    const p = toSource(point);
    const basis = p && canvasEl.value && payload ? projectionBasis(imageProjection(store.uiState.finalTransform,
      [canvasEl.value.width, canvasEl.value.height], [payload.media.width, payload.media.height]), p) : null;
    const scale = basis ? Math.sqrt(Math.abs(basis[0] * basis[3] - basis[1] * basis[2])) : 0;
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
    invalidateSourceSnapshot();
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

  // Heard as it will be sent; a play() refused with sound (autoplay policy) plays muted.
  video.muted = store.mediaState.videoMuted;
  video.play().catch(() => {
    video.muted = true;
    return video.play().catch(() => {});
  });
  videoPlaybackTick();
}

watch(() => store.mediaState.videoMuted, (muted) => {
  const video = getVideo();
  if (video && store.uiState.isPlaying) video.muted = muted;
});

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

/** Keep the highest useful density; perspective animation never rasterizes vector layers. */
function updateAnnotationDensity() {
  if (!payload) return;
  const media: Vec2 = [payload.media.width, payload.media.height];
  const current = store.uiState.annotationRasterSize;
  const wanted = previewRasterSize(media, store.uiState.finalTransform.scale);
  if (current && wanted[0] <= current[0] && wanted[1] <= current[1]) return;
  store.uiState.annotationRasterSize = wanted;
}
watch(() => store.uiState.finalTransform.scale, updateAnnotationDensity);

let uploadedBrushRevision = -1;
watch(() => store.uiState.annotationRevision, scheduleRedraw);
let layersCanvas: HTMLCanvasElement | null = null;
let layerGeneration = 0, layerSyncFrame: number | null = null;
function scheduleLayerSync() {
  if (layerSyncFrame !== null) return;
  layerSyncFrame = requestAnimationFrame(() => { layerSyncFrame = null; void syncLayers(); });
}
async function syncLayers() {
  if (!payload || disposed) return;
  const generation = ++layerGeneration;
  const size: Vec2 = [payload.media.width, payload.media.height];
  const layers = store.mediaState.resizableLayers.filter(layer => layer.id !== store.uiState.editingTextLayer);
  if (!layers.length) {
    clearAnnotation(payload, 'layers');
    if (layersCanvas) layersCanvas.width = layersCanvas.height = 0;
    layersCanvas = null; scheduleRedraw(); return;
  }
  const raster = document.createElement('canvas');
  [raster.width, raster.height] = store.uiState.annotationRasterSize ?? rasterSize(size);
  try {
    await drawAnnotationLayers(raster, layers, size);
    if (disposed || generation !== layerGeneration || !payload) return;
    if (layersCanvas) layersCanvas.width = layersCanvas.height = 0;
    layersCanvas = raster;
    uploadAnnotation(payload, 'layers', raster);
    scheduleRedraw();
  } finally { if (layersCanvas !== raster) raster.width = raster.height = 0; }
}
watch(() => [store.mediaState.resizableLayers, store.uiState.editingTextLayer, store.uiState.annotationRasterSize], scheduleLayerSync, { deep: true });

let sourceSnapshot: HTMLCanvasElement | null = null;
let sourceCanvas: HTMLCanvasElement | null = null, sourceContext: GPUCanvasContext | null = null;
let sourceRevision = -1;
let sourceInvalidationFrame: number | null = null;
/** Mask/colour uploads happen after state watchers; invalidate only once the GPU input is current. */
function invalidateSourceSnapshot() {
  sourceRevision = -1;
  if (sourceInvalidationFrame !== null) return;
  sourceInvalidationFrame = requestAnimationFrame(() => {
    sourceInvalidationFrame = null;
    if (!disposed) store.uiState.sourceImageRevision++;
  });
}
/** A filtered image in its own plane, rendered only when a blur stroke needs its pixels. */
function getSourceImageCanvas(): HTMLCanvasElement {
  if (!payload || !device) throw new Error('Editor source is not ready');
  if (!sourceCanvas) {
    sourceCanvas = document.createElement('canvas');
    sourceSnapshot = document.createElement('canvas');
    [sourceCanvas.width, sourceCanvas.height] = store.uiState.annotationRasterSize ?? rasterSize([payload.media.width, payload.media.height]);
    sourceSnapshot.width = sourceCanvas.width; sourceSnapshot.height = sourceCanvas.height;
    sourceContext = sourceCanvas.getContext('webgpu')!;
    sourceContext.configure({ device, format: getPreferredFormat(), alphaMode: 'premultiplied' });
  }
  const size = store.uiState.annotationRasterSize;
  if (size && (sourceCanvas.width !== size[0] || sourceCanvas.height !== size[1])) {
    [sourceCanvas.width, sourceCanvas.height] = size;
    sourceSnapshot!.width = size[0]; sourceSnapshot!.height = size[1]; sourceRevision = -1;
  }
  if (sourceRevision !== store.uiState.sourceImageRevision) {
    // Sampling needs neither outline nor its viewport-sized compositor targets.
    draw(device, sourceContext!, { ...payload, compositor: undefined }, {
      rotation: 0, scale: sourceCanvas.width / payload.media.width, translation: [0, 0],
      imageSize: [payload.media.width, payload.media.height], flip: [1, 1], perspective: [0, 0],
      curves: store.mediaState.curves, selective: store.mediaState.selective, ...store.mediaState.adjustments,
    }, null, false, 0);
    // The GPU canvas expires at task end. Preserve just the lazily requested snapshot.
    const snapshot = sourceSnapshot!.getContext('2d')!;
    snapshot.clearRect(0, 0, sourceSnapshot!.width, sourceSnapshot!.height);
    snapshot.drawImage(sourceCanvas, 0, 0);
    sourceRevision = store.uiState.sourceImageRevision;
  }
  return sourceSnapshot!;
}
watch(() => [store.mediaState.adjustments, store.mediaState.curves, store.mediaState.selective], invalidateSourceSnapshot, { deep: true });

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

  if (store.uiState.brushCanvas && uploadedBrushRevision !== store.uiState.annotationRevision) {
    uploadAnnotation(payload, 'brush', store.uiState.brushCanvas, store.uiState.annotationDirtyRect);
    store.uiState.annotationDirtyRect = undefined;
    uploadedBrushRevision = store.uiState.annotationRevision;
    store.uiState.annotationUploadedRevision = uploadedBrushRevision;
  }
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
      cropProgress: store.uiState.cropTabAnimationProgress,
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
