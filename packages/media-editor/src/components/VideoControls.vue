<template>
  <div class="px-4 py-3 shrink-0" v-if="store.mediaType === 'video'">
    <!-- Timeline with cropper handles -->
    <div
      class="video-timeline relative h-12 rounded-[9px] bg-[#212121] overflow-hidden"
      ref="containerEl"
      :style="{
        '--start': store.mediaState.videoCropStart,
        '--length': store.mediaState.videoCropLength,
        '--handle-width': '9px',
        '--current-time': store.mediaState.currentVideoTime
      } as any"
    >
      <!-- Frame thumbnails canvas -->
      <canvas ref="framesCanvas" class="absolute inset-0 w-full h-full pointer-events-none" />

      <!-- Darkened areas outside trim -->
      <div class="cropper-bg-left absolute h-full w-full bg-black/65 pointer-events-none" />
      <div class="cropper-bg-right absolute h-full w-full bg-black/65 pointer-events-none" />

      <!-- Horizontal border (top+bottom) - also the draggable middle area -->
      <div
        class="cropper-border absolute h-full border-y-2 border-white cursor-pointer touch-none"
        :class="{ '!cursor-grabbing': isDragging }"
        ref="trackEl"
        @pointerdown="onTrackPointerDown"
      />

      <!-- Left handle -->
      <div
        class="cropper-handle-left absolute h-full bg-white cursor-ew-resize flex items-center justify-center touch-none rounded-l-[9px]"
        @pointerdown.prevent="startTrimDrag('start', $event)"
      >
        <div class="w-[3px] h-4 rounded-[5px] bg-[#212121]" />
      </div>

      <!-- Right handle -->
      <div
        class="cropper-handle-right absolute h-full bg-white cursor-ew-resize flex items-center justify-center touch-none rounded-r-[9px]"
        @pointerdown.prevent="startTrimDrag('end', $event)"
      >
        <div class="w-[3px] h-4 rounded-[5px] bg-[#212121]" />
      </div>

      <!-- Playhead (time stick) -->
      <div class="time-stick absolute top-1/2 w-[4px] h-[60%] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)] pointer-events-none" />
    </div>

    <!-- Time labels -->
    <div class="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums mt-2 mb-1">
      <span>{{ formatTime(trimStartTime) }}</span>
      <span class="text-foreground font-medium">{{ formatTime(currentAbsoluteTime) }}</span>
      <span>{{ formatTime(trimEndTime) }}</span>
    </div>

    <div class="flex justify-center mt-2">
      <button class="size-10 rounded-full bg-muted border-none text-foreground cursor-pointer flex items-center justify-center hover:bg-muted-foreground/15 transition-colors" @click="togglePlay">
        <svg v-if="!store.uiState.isPlaying" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21" />
        </svg>
        <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { clamp, fitToAspectRatio } from '../geometry';

const { store } = useMediaEditorContext();

const trackEl = ref<HTMLDivElement | null>(null);
const framesCanvas = ref<HTMLCanvasElement | null>(null);
const containerEl = ref<HTMLDivElement | null>(null);
const isDragging = ref(false);

// --- Time formatting ---
const videoDuration = computed(() => store.uiState.renderingPayload?.media?.video?.duration ?? 0);

const trimStartTime = computed(() => store.mediaState.videoCropStart * videoDuration.value);
const trimEndTime = computed(() => (store.mediaState.videoCropStart + store.mediaState.videoCropLength) * videoDuration.value);
const currentAbsoluteTime = computed(() => store.mediaState.currentVideoTime * videoDuration.value);

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function togglePlay() {
  store.uiState.isPlaying = !store.uiState.isPlaying;
}

function onTrackPointerDown(e: PointerEvent) {
  if (!trackEl.value) return;
  trackEl.value.setPointerCapture(e.pointerId);
  store.uiState.isPlaying = false;

  const update = (ev: PointerEvent) => {
    if (!containerEl.value) return;
    const rect = containerEl.value.getBoundingClientRect();
    const handleWidth = 9;
    const usableWidth = rect.width - 2 * handleWidth;
    const x = clamp((ev.clientX - rect.left - handleWidth) / usableWidth, 0, 1);
    store.mediaState.currentVideoTime = clamp(x, store.mediaState.videoCropStart, store.mediaState.videoCropStart + store.mediaState.videoCropLength);
  };

  update(e);

  const onMove = (ev: PointerEvent) => update(ev);
  const onUp = () => {
    trackEl.value?.removeEventListener('pointermove', onMove);
    trackEl.value?.removeEventListener('pointerup', onUp);
  };

  trackEl.value.addEventListener('pointermove', onMove);
  trackEl.value.addEventListener('pointerup', onUp);
}

function startTrimDrag(handle: 'start' | 'end', e: PointerEvent) {
  if (!containerEl.value) return;
  store.uiState.isPlaying = false;
  isDragging.value = true;

  const onMove = (ev: PointerEvent) => {
    if (!containerEl.value) return;
    const rect = containerEl.value.getBoundingClientRect();
    const handleWidth = 9;
    const usableWidth = rect.width - 2 * handleWidth;
    const x = clamp((ev.clientX - rect.left - handleWidth) / usableWidth, 0, 1);

    if (handle === 'start') {
      const currentEnd = store.mediaState.videoCropStart + store.mediaState.videoCropLength;
      const newStart = clamp(x, 0, currentEnd - 0.05);
      store.mediaState.videoCropStart = newStart;
      store.mediaState.videoCropLength = currentEnd - newStart;
      store.mediaState.currentVideoTime = newStart;
    } else {
      const newEnd = clamp(x, store.mediaState.videoCropStart + 0.05, 1);
      store.mediaState.videoCropLength = newEnd - store.mediaState.videoCropStart;
      store.mediaState.currentVideoTime = newEnd;
    }
  };

  const onUp = () => {
    isDragging.value = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// --- Generate video frame thumbnails ---
let cleaned = false;

onBeforeUnmount(() => {
  cleaned = true;
});

onMounted(async () => {
  if (store.mediaType !== 'video' || !framesCanvas.value || !containerEl.value) return;

  const video = store.uiState.renderingPayload?.media?.video;
  if (!video) return;

  await drawFrameThumbnails(video);
});

watch(() => store.uiState.renderingPayload?.media?.video, async (video) => {
  if (video && framesCanvas.value && containerEl.value) {
    await drawFrameThumbnails(video);
  }
});

async function drawFrameThumbnails(sourceVideo: HTMLVideoElement) {
  if (!framesCanvas.value || !containerEl.value || cleaned) return;

  const canvas = framesCanvas.value;
  const containerWidth = containerEl.value.offsetWidth;
  const containerHeight = containerEl.value.offsetHeight;

  if (!containerWidth || !containerHeight) return;

  canvas.width = containerWidth;
  canvas.height = containerHeight;

  const ctx = canvas.getContext('2d')!;
  const ratio = sourceVideo.videoWidth / sourceVideo.videoHeight;
  const [chunkWidth, chunkHeight] = fitToAspectRatio(ratio, containerWidth, containerHeight);

  const thumbVideo = document.createElement('video');
  thumbVideo.muted = true;
  thumbVideo.playsInline = true;
  thumbVideo.preload = 'auto';
  thumbVideo.src = store.mediaSrc;

  await new Promise<void>((resolve) => {
    thumbVideo.addEventListener('loadeddata', () => resolve(), { once: true });
  });

  if (cleaned) return;

  for (let x = 0; x < containerWidth; x += chunkWidth) {
    if (cleaned) return;

    const time = (x / containerWidth) * thumbVideo.duration;
    thumbVideo.currentTime = time;

    await new Promise<void>((resolve) => {
      thumbVideo.addEventListener('seeked', () => resolve(), { once: true });
    });

    if (cleaned) return;

    ctx.drawImage(thumbVideo, x, 0, chunkWidth, chunkHeight);
  }

  thumbVideo.src = '';
}
</script>

<style scoped>
.video-timeline .cropper-bg-left {
  left: calc((100% - 2 * var(--handle-width)) * var(--start) + var(--handle-width));
  transform: translateX(-100%);
}

.video-timeline .cropper-bg-right {
  left: calc((100% - 2 * var(--handle-width)) * (var(--start) + var(--length)) + var(--handle-width));
}

.video-timeline .cropper-border {
  left: calc((100% - 2 * var(--handle-width)) * var(--start) + var(--handle-width) - 1px);
  width: calc((100% - 2 * var(--handle-width)) * var(--length) + 2px);
}

.video-timeline .cropper-handle-left {
  width: var(--handle-width);
  left: calc((100% - 2 * var(--handle-width)) * var(--start));
}

.video-timeline .cropper-handle-right {
  width: var(--handle-width);
  left: calc((100% - 2 * var(--handle-width)) * (var(--start) + var(--length)) + var(--handle-width));
}

.video-timeline .time-stick {
  left: calc((100% - 2 * var(--handle-width)) * var(--current-time) + var(--handle-width));
}
</style>
