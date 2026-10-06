<template>
  <div
    ref="rootRef"
    class="video-attachment"
    :class="{ 'video-attachment--contain': fit === 'contain', 'is-pending': pending }"
    :data-attachment-id="video.fileId"
    data-testid="video-attachment"
    role="button"
    tabindex="0"
    :aria-label="t('video_open')"
    @click="onOpen"
    @keydown.enter.prevent="onOpen"
    @keydown.space.prevent="onOpen"
  >
    <canvas v-if="video.thumbHash && !posterLoaded" ref="placeholderRef" class="va-placeholder" />

    <img
      v-if="posterSrc"
      :crossorigin="cdnCrossOrigin(posterSrc)"
      :src="posterSrc"
      alt=""
      class="va-poster"
      :class="{ visible: posterLoaded }"
      draggable="false"
      @load="posterLoaded = true"
      @error="posterSrc = null"
    />
    <video
      v-else-if="localStill"
      class="va-poster visible"
      :src="localStill"
      muted
      playsinline
      preload="metadata"
      disablepictureinpicture
      data-testid="video-local-still"
    />

    <!-- Exists only while autoplay is on and the cell is near the screen: off, there is no <video>. -->
    <VideoPlayer
      v-if="inlineSrc"
      ref="playerRef"
      class="va-inline"
      :class="{ visible: inlineShown }"
      controls="inline"
      :src="inlineSrc"
      :poster="posterSrc"
      :width="video.width"
      :height="video.height"
      :duration-ms="video.durationMs"
      :fill-box="fit === 'cover'"
      :autoplay="wantPlaying"
      muted
      loop
      @playing="inlineShown = true"
      @timeupdate="onInlineTime"
      @error="onInlineError"
    />

    <!-- How far the silent preview has played, Telegram-style: a thin line along the bottom edge. -->
    <div
      v-if="inlineShown && !pending"
      class="va-progress"
      :class="{ 'va-progress--reset': progressReset }"
      data-testid="video-inline-progress"
      aria-hidden="true"
    >
      <div class="va-progress-fill" :style="{ width: `${inlineProgress * 100}%` }" />
    </div>

    <span class="va-badge" data-testid="video-duration">
      {{ durationText }}
      <VolumeXIcon v-if="autoplays && !pending" class="va-badge-icon" :aria-label="t('video_no_sound')" />
    </span>

    <span v-if="showPlayButton" class="va-play" data-testid="video-play-button" aria-hidden="true">
      <PlayIcon class="va-play-icon" />
    </span>

    <div v-if="pending" class="va-upload" :title="stage || undefined" data-testid="video-upload">
      <svg class="va-ring" viewBox="0 0 48 48" aria-hidden="true">
        <circle class="va-ring-track" cx="24" cy="24" r="20" />
        <circle
          class="va-ring-fill"
          :class="{ 'va-ring-fill--spin': progressValue === null }"
          cx="24"
          cy="24"
          r="20"
          :stroke-dasharray="RING"
          :stroke-dashoffset="RING * (1 - (progressValue ?? 0.25))"
        />
      </svg>
      <span v-if="stage" class="va-upload-stage">{{ stage }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { PlayIcon, VolumeXIcon } from "lucide-vue-next";
import { thumbHashToRGBA } from "thumbhash";
import type { MessageEntityVideo } from "@argon/glue";
import VideoPlayer from "@/components/media/VideoPlayer.vue";
import { useLocale } from "@/store/system/localeStore";
import { cdnCrossOrigin, cdnUrl } from "@/store/system/fileStorage";
import { invalidateMediaUrl, resolveMediaUrl } from "@/lib/media/mediaUrl";
import { addAutoplayVideo, type AutoplayVideoControl } from "@/lib/media/videoAutoplay";
import { PLACEHOLDER_FILE_ID } from "@/lib/media/mediaItem";
import { fitsChatAutoplay } from "@/lib/video/playerSettings";
import { formatDuration } from "@/lib/video/playerMath";

const props = withDefaults(
  defineProps<{
    video: MessageEntityVideo;
    /** One cell of several: plays only when opened (Telegram does not autoplay albums). */
    grouped?: boolean;
    /** `contain` for a lone video (its box may be wider than it), `cover` for a grid cell. */
    fit?: "contain" | "cover";
    /** Upload progress 0..1 while the message is being sent; null for "working on it". */
    progress?: number | null;
    /** What the upload is doing, already in the user's language. */
    stage?: string | null;
  }>(),
  { grouped: false, fit: "cover", progress: undefined, stage: null },
);

const emit = defineEmits<{
  (e: "open", video: MessageEntityVideo): void;
}>();

const { t } = useLocale();

/** How long a paused preview off screen keeps its element and buffers. */
const RELEASE_AFTER_MS = 30_000;
const RING = 2 * Math.PI * 20;

const rootRef = ref<HTMLElement | null>(null);
const placeholderRef = ref<HTMLCanvasElement | null>(null);
const playerRef = ref<InstanceType<typeof VideoPlayer> | null>(null);

/** The preview failed twice (a fresh address included): the bubble waits for a click instead. */
const inlineFailed = ref(false);

const pending = computed(
  () => props.video.fileId === PLACEHOLDER_FILE_ID || (props.progress !== undefined && props.progress !== null && props.progress < 1),
);
const progressValue = computed(() =>
  typeof props.progress === "number" && Number.isFinite(props.progress) ? Math.min(1, Math.max(0, props.progress)) : null,
);
// A video still being sent never plays by itself.
const autoplays = computed(() => !props.grouped && !pending.value && !inlineFailed.value && fitsChatAutoplay(props.video.fileSize));
const showPlayButton = computed(() => !autoplays.value && !pending.value);
const durationText = computed(() => formatDuration(props.video.durationMs));

// ── Poster and placeholder ──────────────────────────────────────────

/** The stored poster; a bubble still being sent has none yet, but carries an object URL of the local one. */
const posterFor = (video: MessageEntityVideo) => (video.posterFileId ? cdnUrl(video.posterFileId) : video.posterUrl || null);

const posterSrc = ref<string | null>(posterFor(props.video));
const posterLoaded = ref(false);

watch(
  () => [props.video.posterFileId, props.video.posterUrl],
  () => {
    posterLoaded.value = false;
    posterSrc.value = posterFor(props.video);
  },
);

/** No poster at all while sending: the local file's own first frame (an object URL, nothing fetched). */
const localStill = computed(() => {
  const url = props.video.downloadUrl;
  return pending.value && url?.startsWith("blob:") ? url : null;
});

function renderThumbHash() {
  const canvas = placeholderRef.value;
  if (!props.video.thumbHash || !canvas) return;
  try {
    const bytes = Uint8Array.from(atob(props.video.thumbHash), (c) => c.charCodeAt(0));
    const { w, h, rgba } = thumbHashToRGBA(bytes);
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  } catch {
    /* not a thumbhash: the muted background stays */
  }
}

watch(
  () => props.video.thumbHash,
  async () => {
    await nextTick();
    renderThumbHash();
  },
);

// ── Silent autoplay while on screen ─────────────────────────────────

const inlineSrc = ref<string | null>(null);
const inlineShown = ref(false);
const wantPlaying = ref(false);
/** Played fraction of the silent preview, 0..1; `progressReset` drops the width transition when it wraps on loop. */
const inlineProgress = ref(0);
const progressReset = ref(false);
let control: AutoplayVideoControl | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
let resolving = 0;
let disposed = false;

function onInlineTime(seconds: number) {
  const duration = props.video.durationMs / 1000;
  const next = duration > 0 ? Math.min(1, Math.max(0, seconds / duration)) : 0;
  progressReset.value = next < inlineProgress.value;
  inlineProgress.value = next;
}

function release() {
  clearTimeout(releaseTimer);
  resolving++;
  inlineSrc.value = null;
  inlineShown.value = false;
  inlineProgress.value = 0;
  progressReset.value = false;
}

function setPlaying(play: boolean) {
  wantPlaying.value = play;
  if (play) {
    clearTimeout(releaseTimer);
    if (inlineSrc.value) {
      void playerRef.value?.play();
      return;
    }
    const token = ++resolving;
    void resolveMediaUrl(props.video.fileId).then((url) => {
      if (disposed || token !== resolving || !wantPlaying.value) return;
      inlineSrc.value = url;
    });
    return;
  }
  playerRef.value?.pause();
  clearTimeout(releaseTimer);
  if (inlineSrc.value) releaseTimer = setTimeout(release, RELEASE_AFTER_MS);
}

function startAutoplay() {
  if (control || !rootRef.value) return;
  control = addAutoplayVideo(rootRef.value, setPlaying);
}

function stopAutoplay() {
  control?.remove();
  control = null;
  wantPlaying.value = false;
  release();
}

watch(autoplays, (on) => (on ? startAutoplay() : stopAutoplay()));

/** Whether the one fresh address this preview gets has been used. */
let inlineRetried = false;

function onInlineError() {
  // Most likely the direct URL went stale: ask for a fresh one, once. A second failure hands the
  // bubble back to its poster and play button.
  if (inlineRetried) {
    inlineFailed.value = true;
    return;
  }
  inlineRetried = true;
  invalidateMediaUrl(props.video.fileId);
  const play = wantPlaying.value;
  release();
  if (play) setPlaying(true);
}

watch(
  () => props.video.fileId,
  () => {
    inlineRetried = false;
    inlineFailed.value = false;
    if (!control) return;
    stopAutoplay();
    if (autoplays.value) startAutoplay();
  },
);

onMounted(async () => {
  await nextTick();
  renderThumbHash();
  if (autoplays.value) startAutoplay();
});

onBeforeUnmount(() => {
  disposed = true;
  control?.remove();
  control = null;
  clearTimeout(releaseTimer);
});

function onOpen() {
  if (pending.value) return;
  emit("open", props.video);
}
</script>

<style scoped>
.video-attachment {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  background: hsl(var(--muted));
  cursor: pointer;
  outline: none;
}

.video-attachment:focus-visible {
  box-shadow: inset 0 0 0 2px hsl(var(--ring));
}

.video-attachment.is-pending {
  cursor: default;
}

.va-placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(16px);
  transform: scale(1.1);
}

.va-poster,
.video-attachment > .va-inline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.va-poster {
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.video-attachment--contain .va-poster {
  object-fit: contain;
}

.va-poster.visible {
  opacity: 1;
}

.video-attachment > .va-inline {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.video-attachment > .va-inline.visible {
  opacity: 1;
}

.va-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  z-index: 2;
  background: rgba(255, 255, 255, 0.35);
  box-shadow: 0 -10px 14px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.va-progress-fill {
  height: 100%;
  background: #fff;
  transition: width 0.25s linear;
}

.va-progress--reset .va-progress-fill {
  transition: none;
}

/* Telegram's duration chip, top left; white on a dark pill in both themes. */
.va-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border-radius: 10px;
  background: rgb(0 0 0 / 0.45);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  user-select: none;
}

.va-badge-icon {
  width: 12px;
  height: 12px;
}

.va-play {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  width: 52px;
  height: 52px;
  margin: -26px 0 0 -26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
  backdrop-filter: blur(6px);
  color: #fff;
  pointer-events: none;
  transition: transform 0.15s ease, background 0.15s ease;
}

.video-attachment:hover .va-play {
  background: rgb(0 0 0 / 0.6);
  transform: scale(1.05);
}

.va-play-icon {
  width: 24px;
  height: 24px;
  margin-left: 3px;
  fill: currentColor;
}

.va-upload {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgb(0 0 0 / 0.25);
  color: #fff;
  pointer-events: none;
}

.va-ring {
  width: 52px;
  height: 52px;
  padding: 2px;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.45);
  transform: rotate(-90deg);
}

.va-ring-track {
  fill: none;
  stroke: rgb(255 255 255 / 0.2);
  stroke-width: 3;
}

.va-ring-fill {
  fill: none;
  stroke: #fff;
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.25s ease;
}

.va-ring-fill--spin {
  transform-origin: 24px 24px;
  animation: va-spin 1s linear infinite;
}

@keyframes va-spin {
  to {
    transform: rotate(360deg);
  }
}

.va-upload-stage {
  padding: 1px 8px;
  border-radius: 8px;
  background: rgb(0 0 0 / 0.45);
  font-size: 11px;
}
</style>
