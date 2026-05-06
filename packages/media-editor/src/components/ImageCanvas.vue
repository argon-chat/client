<template>
  <canvas ref="canvasEl" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { useCropOffset } from '../composables/useCropOffset';
import { initWebGPU, cleanupWebGPU, type RenderingPayload } from '../webgpu/initWebGPU';
import { draw, type DrawingParameters } from '../webgpu/draw';
import { updateVideoTexture } from '../webgpu/loadTexture';
import { fitToAspectRatio } from '../geometry';
import { resolveOutputQuality } from '../constants';
import { adjustmentsConfig } from '../adjustments';
import { ensureGizmoCanvas, removeGizmoCanvas, drawGizmos } from '../webgpu/debugGizmos';

const { store, mode } = useMediaEditorContext();
const cropOffset = useCropOffset();
const canvasEl = ref<HTMLCanvasElement | null>(null);

let device: GPUDevice | null = null;
let context: GPUCanvasContext | null = null;
let payload: RenderingPayload | null = null;
let animFrameId: number | null = null;
let videoPlaybackId: number | null = null;

onMounted(async () => {
  if (!canvasEl.value) return;

  updateCanvasSizeIfNeeded();

  const result = await initWebGPU({
    canvas: canvasEl.value,
    mediaSrc: store.mediaSrc,
    mediaType: store.mediaType,
    videoTime: store.mediaState.videoCropStart,
    waitToSeek: true
  });

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

  // Init image ratio + scale for avatar mode
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

  store.uiState.isReady = true;
  redraw();
});

onBeforeUnmount(() => {
  if (animFrameId !== null) cancelAnimationFrame(animFrameId);
  if (videoPlaybackId !== null) cancelAnimationFrame(videoPlaybackId);
  stopVideoPlayback();
  removeGizmoCanvas();
  if (payload) cleanupWebGPU(payload);
});

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

// Watch finalTransform + adjustments for redraw (debounced for adjustments)
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
  () => store.mediaState.adjustments,
  () => { scheduleDebouncedRedraw(); },
  { deep: true }
);

function scheduleRedraw() {
  if (animFrameId !== null) return;
  animFrameId = requestAnimationFrame(() => {
    animFrameId = null;
    redraw();
  });
}

function scheduleDebouncedRedraw() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    scheduleRedraw();
  }, 16);
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
    ...adjustmentValues as any
  };

  draw(device, context, payload, params);

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
