<template>
  <div class="px-4 pt-1 pb-3 shrink-0" v-if="store.mediaType === 'video'">
    <div class="flex items-end gap-3">
      <!-- Sound: what is sent, and what the preview plays -->
      <button
        type="button"
        class="vc-icon-btn"
        :class="{ 'vc-icon-btn--active': store.mediaState.videoMuted }"
        :aria-pressed="store.mediaState.videoMuted"
        :aria-label="store.mediaState.videoMuted ? t('media_editor_video_unmute') : t('media_editor_video_mute')"
        :title="store.mediaState.videoMuted ? t('media_editor_video_muted_hint') : t('media_editor_video_mute')"
        data-testid="video-mute"
        @click="toggleMute"
      >
        <VolumeXIcon v-if="store.mediaState.videoMuted" :size="18" />
        <Volume2Icon v-else :size="18" />
      </button>

      <div class="flex-1 min-w-0">
        <!-- Cover frame: a pin above the strip, inside the kept range -->
        <div
          ref="coverTrackEl"
          class="vc-cover-track relative h-[22px] touch-none"
          :style="trackVars"
          @pointerdown.prevent="startCoverDrag"
        >
          <div
            class="vc-cover-pin"
            :class="{ 'vc-cover-pin--dragging': draggingCover }"
            role="slider"
            tabindex="0"
            :aria-label="t('media_editor_video_cover')"
            aria-orientation="horizontal"
            :aria-valuemin="percent(store.mediaState.videoCropStart)"
            :aria-valuemax="percent(trimEnd)"
            :aria-valuenow="percent(coverPosition)"
            :aria-valuetext="formatTime(coverPosition * videoDuration)"
            :title="t('media_editor_video_cover_hint')"
            data-testid="video-cover"
            @keydown="onCoverKey"
          >
            <ImageIcon :size="11" :stroke-width="2.5" />
          </div>
        </div>

        <!-- Timeline with trim handles -->
        <div
          class="video-timeline relative h-12 rounded-[9px] bg-[#212121] overflow-hidden"
          ref="containerEl"
          :style="trackVars"
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
            role="slider"
            tabindex="0"
            :aria-label="t('media_editor_video_position')"
            :aria-valuemin="percent(store.mediaState.videoCropStart)"
            :aria-valuemax="percent(trimEnd)"
            :aria-valuenow="percent(store.mediaState.currentVideoTime)"
            :aria-valuetext="formatTime(currentAbsoluteTime)"
            @pointerdown="onTrackPointerDown"
            @keydown="onPositionKey"
          />

          <!-- Left handle -->
          <div
            class="cropper-handle-left absolute h-full bg-white cursor-ew-resize flex items-center justify-center touch-none rounded-l-[9px]"
            role="slider"
            tabindex="0"
            :aria-label="t('media_editor_video_trim_start')"
            :aria-valuemin="0"
            :aria-valuemax="percent(trimEnd - minLength)"
            :aria-valuenow="percent(store.mediaState.videoCropStart)"
            :aria-valuetext="formatTime(trimStartTime)"
            data-testid="video-trim-start"
            @pointerdown.prevent="startTrimDrag('start', $event)"
            @keydown="onTrimKey('start', $event)"
          >
            <div class="w-[3px] h-4 rounded-[5px] bg-[#212121]" />
          </div>

          <!-- Right handle -->
          <div
            class="cropper-handle-right absolute h-full bg-white cursor-ew-resize flex items-center justify-center touch-none rounded-r-[9px]"
            role="slider"
            tabindex="0"
            :aria-label="t('media_editor_video_trim_end')"
            :aria-valuemin="percent(store.mediaState.videoCropStart + minLength)"
            :aria-valuemax="100"
            :aria-valuenow="percent(trimEnd)"
            :aria-valuetext="formatTime(trimEndTime)"
            data-testid="video-trim-end"
            @pointerdown.prevent="startTrimDrag('end', $event)"
            @keydown="onTrimKey('end', $event)"
          >
            <div class="w-[3px] h-4 rounded-[5px] bg-[#212121]" />
          </div>

          <!-- Playhead (time stick) -->
          <div class="time-stick absolute top-1/2 w-[4px] h-[60%] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-white shadow-[0_0_4px_rgba(0,0,0,0.5)] pointer-events-none" />
        </div>
      </div>

      <button
        type="button"
        class="vc-icon-btn"
        :aria-label="store.uiState.isPlaying ? t('media_editor_video_pause') : t('media_editor_video_play')"
        data-testid="video-play"
        @click="togglePlay"
      >
        <PauseIcon v-if="store.uiState.isPlaying" :size="18" fill="currentColor" />
        <PlayIcon v-else :size="18" fill="currentColor" />
      </button>
    </div>

    <!-- Time labels: the kept range, and the playhead (the kept length while a handle moves) -->
    <div class="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums mt-2 px-[52px]">
      <span>{{ formatTime(trimStartTime) }}</span>
      <span class="text-foreground font-medium" data-testid="video-time-center">{{ isDragging ? formatTime(trimEndTime - trimStartTime, true) : formatTime(currentAbsoluteTime) }}</span>
      <span>{{ formatTime(trimEndTime) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ImageIcon, PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from 'lucide-vue-next';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { clamp, fitToAspectRatio } from '../geometry';

const { t } = useI18n();
const { store } = useMediaEditorContext();

/** Telegram's shortest clip. */
const MIN_TRIM_SECONDS = 0.5;
const HANDLE_WIDTH = 9;
/** Arrow keys move by this much (Shift: ten times). */
const KEY_STEP_SECONDS = 0.1;

const trackEl = ref<HTMLDivElement | null>(null);
const framesCanvas = ref<HTMLCanvasElement | null>(null);
const containerEl = ref<HTMLDivElement | null>(null);
const coverTrackEl = ref<HTMLDivElement | null>(null);
const isDragging = ref(false);
const draggingCover = ref(false);

const videoDuration = computed(() => store.uiState.renderingPayload?.media?.video?.duration ?? 0);
const minLength = computed(() => (videoDuration.value > 0 ? Math.min(1, MIN_TRIM_SECONDS / videoDuration.value) : 0.05));
const trimEnd = computed(() => store.mediaState.videoCropStart + store.mediaState.videoCropLength);

const trimStartTime = computed(() => store.mediaState.videoCropStart * videoDuration.value);
const trimEndTime = computed(() => trimEnd.value * videoDuration.value);
const currentAbsoluteTime = computed(() => store.mediaState.currentVideoTime * videoDuration.value);
const coverPosition = computed(() => clamp(store.mediaState.videoThumbnailPosition, store.mediaState.videoCropStart, trimEnd.value));

const trackVars = computed(() => ({
  '--start': store.mediaState.videoCropStart,
  '--length': store.mediaState.videoCropLength,
  '--handle-width': `${HANDLE_WIDTH}px`,
  '--current-time': store.mediaState.currentVideoTime,
  '--cover': coverPosition.value
}) as Record<string, string | number>);

function formatTime(seconds: number, tenths = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${m}:${sec.toString().padStart(2, '0')}`;
  // A short clip's length reads to the tenth, as Telegram shows it while trimming.
  return tenths && s < 10 ? `${base}.${Math.floor((s * 10) % 10)}` : base;
}

const percent = (fraction: number) => Math.round(fraction * 1000) / 10;

function keyStep(e: KeyboardEvent): number {
  const seconds = KEY_STEP_SECONDS * (e.shiftKey ? 10 : 1);
  return videoDuration.value > 0 ? seconds / videoDuration.value : 0.01;
}

/** The new value an arrow / Home / End key asks for, or null for another key. */
function keyedValue(e: KeyboardEvent, value: number, min: number, max: number): number | null {
  switch (e.key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clamp(value - keyStep(e), min, max);
    case 'ArrowRight':
    case 'ArrowUp':
      return clamp(value + keyStep(e), min, max);
    case 'Home':
      return min;
    case 'End':
      return max;
    default:
      return null;
  }
}

function togglePlay() {
  store.uiState.isPlaying = !store.uiState.isPlaying;
}

function toggleMute() {
  store.set(['videoMuted'], !store.mediaState.videoMuted);
}

/** 0..1 of the duration under the pointer, on the strip's usable width. */
function positionAt(clientX: number): number {
  const rect = containerEl.value!.getBoundingClientRect();
  const usableWidth = rect.width - 2 * HANDLE_WIDTH;
  return clamp((clientX - rect.left - HANDLE_WIDTH) / usableWidth, 0, 1);
}

function onTrackPointerDown(e: PointerEvent) {
  if (!trackEl.value) return;
  trackEl.value.setPointerCapture(e.pointerId);
  store.uiState.isPlaying = false;

  const update = (ev: PointerEvent) => {
    if (!containerEl.value) return;
    store.mediaState.currentVideoTime = clamp(positionAt(ev.clientX), store.mediaState.videoCropStart, trimEnd.value);
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

function onPositionKey(e: KeyboardEvent) {
  const next = keyedValue(e, store.mediaState.currentVideoTime, store.mediaState.videoCropStart, trimEnd.value);
  if (next === null) return;
  e.preventDefault();
  store.uiState.isPlaying = false;
  store.mediaState.currentVideoTime = next;
}

/** Sets the kept range, carrying the cover along when it falls outside. */
function setTrim(start: number, end: number) {
  store.mediaState.videoCropStart = start;
  store.mediaState.videoCropLength = end - start;
  const cover = store.mediaState.videoThumbnailPosition;
  if (cover < start || cover > end) store.mediaState.videoThumbnailPosition = clamp(cover, start, end);
}

function startTrimDrag(handle: 'start' | 'end', e: PointerEvent) {
  if (!containerEl.value) return;
  store.uiState.isPlaying = false;
  isDragging.value = true;
  const detach = () => {
    isDragging.value = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  // One trim is one history entry; Esc puts the handles (and a cover they moved) back.
  const gesture = store.beginGesture({ track: [['videoCropStart'], ['videoCropLength'], ['videoThumbnailPosition']], onCancel: detach });

  const onMove = (ev: PointerEvent) => {
    if (!containerEl.value) return;
    const x = positionAt(ev.clientX);
    if (handle === 'start') {
      const end = trimEnd.value;
      const start = clamp(x, 0, end - minLength.value);
      setTrim(start, end);
      store.mediaState.currentVideoTime = start;
    } else {
      const start = store.mediaState.videoCropStart;
      const end = clamp(x, start + minLength.value, 1);
      setTrim(start, end);
      store.mediaState.currentVideoTime = end;
    }
  };

  const onUp = () => {
    detach();
    gesture.end();
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function onTrimKey(handle: 'start' | 'end', e: KeyboardEvent) {
  const start = store.mediaState.videoCropStart;
  const end = trimEnd.value;
  const next = handle === 'start'
    ? keyedValue(e, start, 0, end - minLength.value)
    : keyedValue(e, end, start + minLength.value, 1);
  if (next === null) return;
  e.preventDefault();
  store.uiState.isPlaying = false;
  const gesture = store.beginGesture({ track: [['videoCropStart'], ['videoCropLength'], ['videoThumbnailPosition']] });
  if (handle === 'start') setTrim(next, end);
  else setTrim(start, next);
  gesture.end();
  store.mediaState.currentVideoTime = next;
}

function startCoverDrag(e: PointerEvent) {
  if (!coverTrackEl.value || !containerEl.value) return;
  store.uiState.isPlaying = false;
  draggingCover.value = true;
  const detach = () => {
    draggingCover.value = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
  const gesture = store.beginGesture({ track: [['videoThumbnailPosition']], onCancel: detach });

  // The canvas shows the frame under the pin while it moves.
  const onMove = (ev: PointerEvent) => {
    if (!containerEl.value) return;
    const position = clamp(positionAt(ev.clientX), store.mediaState.videoCropStart, trimEnd.value);
    store.mediaState.videoThumbnailPosition = position;
    store.mediaState.currentVideoTime = position;
  };
  const onUp = () => {
    detach();
    gesture.end();
  };

  onMove(e);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function onCoverKey(e: KeyboardEvent) {
  const next = keyedValue(e, coverPosition.value, store.mediaState.videoCropStart, trimEnd.value);
  if (next === null) return;
  e.preventDefault();
  store.uiState.isPlaying = false;
  store.set(['videoThumbnailPosition'], next);
  store.mediaState.currentVideoTime = next;
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

  try {
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
  } finally {
    // The element holds its decoder and buffers until its source is dropped.
    thumbVideo.removeAttribute('src');
    thumbVideo.load();
  }
}
</script>

<style scoped>
.vc-icon-btn {
  width: 36px;
  height: 36px;
  margin-bottom: 6px;
  border-radius: 9999px;
  border: none;
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.vc-icon-btn:hover {
  background: hsl(var(--muted-foreground) / 0.15);
}

.vc-icon-btn:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

.vc-icon-btn--active {
  color: hsl(var(--destructive));
}

.vc-cover-pin {
  position: absolute;
  bottom: 4px;
  left: calc((100% - 2 * var(--handle-width)) * var(--cover) + var(--handle-width));
  width: 18px;
  height: 16px;
  transform: translateX(-50%);
  border-radius: 5px;
  background: #fff;
  color: #212121;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.45);
  transition: left 0.12s ease;
}

/* The point it stands on. */
.vc-cover-pin::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: #fff;
}

.vc-cover-pin--dragging {
  cursor: grabbing;
  transition: none;
}

.vc-cover-pin:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}

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

.cropper-border:focus-visible,
.cropper-handle-left:focus-visible,
.cropper-handle-right:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
}
</style>
