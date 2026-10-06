<template>
  <div
    ref="rootRef"
    class="vp"
    :class="{
      'vp--full': full,
      'vp--inline': !full,
      'vp--cover': fillBox,
      'is-playing': playing,
      'show-controls': full && controlsVisible,
      'is-seeking': scrubbing,
      'is-buffering': buffering,
      'is-fullscreen': fullscreen,
      'is-pip': pip,
      'has-error': !!failure,
      'is-changing-speed': holdActive,
    }"
    :tabindex="full ? 0 : undefined"
    data-testid="video-player"
    @pointermove="onPointerActivity"
    @pointerleave="onPointerLeave"
    @keydown="onFocusKeydown"
  >
    <video
      ref="videoRef"
      class="vp-video"
      :poster="poster || undefined"
      preload="metadata"
      playsinline
      :disablepictureinpicture="!full || undefined"
      :loop="loop"
      @click="onVideoClick"
      @dblclick="onVideoDblClick"
      @pointerdown="onVideoPointerDown"
      @contextmenu="onVideoContextMenu"
    />

    <template v-if="full">
      <div v-if="pip" class="vp-note">{{ t("video_player_pip_active") }}</div>

      <div v-if="buffering" class="vp-spinner" data-testid="video-player-spinner" aria-hidden="true">
        <Loader2Icon class="vp-spinner-icon animate-spin" />
      </div>

      <div v-if="failure" class="vp-error" role="alert" @click.stop @dblclick.stop>
        <AlertCircleIcon class="w-7 h-7" />
        <span>{{ t("video_player_error") }}</span>
        <button type="button" class="vp-error-retry" data-testid="video-player-retry" @click="retry">
          <RotateCcwIcon class="w-4 h-4" />
          {{ t("video_player_retry") }}
        </button>
      </div>
      <div v-else class="vp-big-play" aria-hidden="true">
        <PlayIcon class="vp-big-play-icon" />
      </div>

      <div v-if="holdActive" class="vp-speed" data-testid="video-player-speed-badge" aria-live="polite">
        <span class="vp-speed-number">{{ formatRate(currentRate) }}×</span>
        <span class="vp-speed-arrows" :style="{ '--vp-speed': currentRate }">
          <PlayIcon class="vp-speed-arrow" /><PlayIcon class="vp-speed-arrow vp-speed-arrow--last" />
        </span>
      </div>
      <div v-if="holdTip" class="vp-speed-tip">{{ t("video_player_speed_drag_tip") }}</div>

      <div class="vp-gradient" aria-hidden="true" />

      <div
        class="vp-controls"
        data-testid="video-player-controls"
        @pointerenter="overControls = true"
        @pointerleave="overControls = false"
        @click.stop
        @dblclick.stop
      >
        <div
          ref="progressRef"
          class="vp-progress"
          role="slider"
          tabindex="-1"
          :aria-label="t('video_player_seek')"
          aria-valuemin="0"
          :aria-valuemax="Math.round(duration)"
          :aria-valuenow="elapsed"
          :aria-valuetext="`${formatTime(elapsed, longForm)} / ${formatTime(duration, longForm)}`"
          data-testid="video-player-progress"
          @pointerdown="onScrubStart"
          @pointermove="onProgressMove"
          @pointerup="onScrubEnd"
          @pointercancel="onScrubEnd"
          @pointerleave="onProgressLeave"
        >
          <div class="vp-progress-rail">
            <div class="vp-progress-buffered" :style="{ width: `${bufferedFraction * 100}%` }" />
            <div class="vp-progress-played" />
          </div>
          <div class="vp-progress-thumb" />
          <div
            v-show="hoverTime !== null"
            ref="tooltipRef"
            class="vp-tooltip"
            data-testid="video-player-tooltip"
            :style="{ left: `${tooltipLeft}px` }"
          >
            <canvas
              v-if="storyboard"
              ref="previewRef"
              class="vp-preview"
              data-testid="video-player-preview"
              :width="storyboard.map.frameWidth"
              :height="storyboard.map.frameHeight"
              :style="{ width: `${storyboard.map.frameWidth * 1.5}px`, height: `${storyboard.map.frameHeight * 1.5}px` }"
            />
            <span class="vp-tooltip-time">{{ formatTime(hoverTime ?? 0, longForm) }}</span>
          </div>
        </div>

        <div class="vp-bar">
          <div class="vp-bar-side">
            <button
              type="button"
              class="vp-btn"
              data-testid="video-player-toggle"
              :aria-label="playing ? t('video_player_pause') : t('video_player_play')"
              :title="playing ? t('video_player_pause') : t('video_player_play')"
              @click="togglePlay"
            >
              <PauseIcon v-if="playing" class="vp-icon vp-icon--filled" />
              <PlayIcon v-else class="vp-icon vp-icon--filled" />
            </button>

            <div class="vp-volume">
              <button
                type="button"
                class="vp-btn"
                data-testid="video-player-mute"
                :aria-label="audioMuted ? t('video_player_unmute') : t('video_player_mute')"
                :title="audioMuted ? t('video_player_unmute') : t('video_player_mute')"
                @click="toggleMute"
              >
                <VolumeXIcon v-if="audioMuted" class="vp-icon" />
                <Volume1Icon v-else-if="shownVolume < 0.5" class="vp-icon" />
                <Volume2Icon v-else class="vp-icon" />
              </button>
              <input
                class="vp-volume-slider vp-range"
                type="range"
                min="0"
                max="1"
                step="0.01"
                :value="audioMuted ? 0 : shownVolume"
                :style="{ '--vp-range': audioMuted ? 0 : shownVolume }"
                :aria-label="t('video_player_volume')"
                data-testid="video-player-volume"
                @input="onVolumeInput"
                @change="onVolumeChange"
              />
            </div>

            <span class="vp-time" data-testid="video-player-time">
              {{ formatTime(elapsed, longForm) }}<span class="vp-time-sep"> / </span>{{ formatTime(duration, longForm) }}
            </span>
          </div>

          <div class="vp-bar-side">
            <div ref="rateRef" class="vp-rate">
              <button
                type="button"
                class="vp-btn vp-rate-btn"
                data-testid="video-player-rate"
                :aria-label="t('video_player_speed')"
                :title="t('video_player_speed')"
                aria-haspopup="menu"
                :aria-expanded="menuOpen"
                @click="menuOpen = !menuOpen"
              >
                {{ formatRate(currentRate) }}×
              </button>
              <div
                v-if="menuOpen"
                class="vp-menu"
                role="menu"
                data-testid="video-player-rate-menu"
                :style="{ maxHeight: `${menuMaxHeight}px` }"
              >
                <button
                  v-for="rate in PLAYBACK_RATES"
                  :key="rate"
                  type="button"
                  role="menuitemradio"
                  class="vp-menu-item"
                  :aria-checked="sameRate(rate, currentRate)"
                  :data-rate="rate"
                  @click="chooseRate(rate)"
                >
                  <CheckIcon class="vp-menu-check" :class="{ invisible: !sameRate(rate, currentRate) }" />
                  {{ rate === 1 ? t("video_player_speed_normal") : `${formatRate(rate)}×` }}
                </button>
                <div class="vp-menu-custom">
                  <div class="vp-menu-custom-head">
                    <span>{{ t("video_player_speed_custom") }}</span>
                    <span class="tabular-nums">{{ formatRate(currentRate) }}×</span>
                  </div>
                  <input
                    class="vp-range"
                    type="range"
                    :min="MIN_PLAYBACK_RATE"
                    :max="MAX_PLAYBACK_RATE"
                    step="0.05"
                    :value="currentRate"
                    :style="{ '--vp-range': (currentRate - MIN_PLAYBACK_RATE) / (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE) }"
                    :aria-label="t('video_player_speed_custom')"
                    data-testid="video-player-rate-custom"
                    @input="onCustomRateInput"
                    @change="onCustomRateChange"
                  />
                </div>
              </div>
            </div>

            <button
              v-if="pipSupported"
              type="button"
              class="vp-btn"
              data-testid="video-player-pip"
              :aria-label="t('video_player_pip')"
              :title="t('video_player_pip')"
              @click="togglePictureInPicture"
            >
              <PictureInPicture2Icon class="vp-icon" />
            </button>

            <button
              type="button"
              class="vp-btn"
              data-testid="video-player-fullscreen"
              :aria-label="fullscreen ? t('video_player_exit_fullscreen') : t('video_player_fullscreen')"
              :title="fullscreen ? t('video_player_exit_fullscreen') : t('video_player_fullscreen')"
              @click="toggleFullscreen"
            >
              <MinimizeIcon v-if="fullscreen" class="vp-icon" />
              <MaximizeIcon v-else class="vp-icon" />
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  AlertCircleIcon,
  CheckIcon,
  Loader2Icon,
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PictureInPicture2Icon,
  PlayIcon,
  RotateCcwIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-vue-next";
import type { VideoStoryboard } from "@argon/glue";
import { useLocale } from "@/store/system/localeStore";
import { metrics, errorKind, type MetricTimer } from "@/lib/telemetry/metrics";
import { playerMuted, playerPlaybackRate, playerVolume } from "@/lib/video/playerSettings";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  PLAYBACK_RATES,
  bufferedEnd,
  clampPlaybackRate,
  estimateFrameDuration,
  formatRate,
  formatTime,
  fraction,
  holdStartRate,
  isTextEntryTarget,
  pointerFraction,
  pressesOnSpace,
  sameRate,
  scrubTime,
  speedFromDrag,
  stepPlaybackRate,
  stepVolume,
  storyboardFrameAt,
  tooltipCentre,
  DEFAULT_FRAME_SECONDS,
} from "@/lib/video/playerMath";
import { continueInPictureInPicture, stopContinuedPictureInPicture } from "@/lib/media/pipHost";

export interface VideoPlayerStoryboard {
  url: string;
  map: VideoStoryboard;
  /** For a sprite served with CORS (the web's file endpoint); leave out for `app://`. */
  crossOrigin?: "anonymous";
}

const props = withDefaults(
  defineProps<{
    src: string;
    poster?: string | null;
    width?: number;
    height?: number;
    durationMs?: number;
    storyboard?: VideoPlayerStoryboard | null;
    autoplay?: boolean;
    /** Always muted (the chat's silent preview); otherwise the remembered volume and mute apply. */
    muted?: boolean;
    loop?: boolean;
    /** Seconds to start from. */
    startAt?: number;
    /** Cover the box instead of fitting into it. */
    fillBox?: boolean;
    /** `inline`: the bare picture, no chrome, no keys, no picture-in-picture. */
    controls?: "full" | "inline";
    /** `always`: keys work while the player is mounted (the viewer); `focus`: only while it has focus. */
    listenKeyboard?: "focus" | "always";
    /** ←/→ seek. Off where they belong to something else (the viewer's navigation), except in full screen. */
    seekArrows?: boolean;
    /** A fresh address for the same video, for a retry after its URL went stale. */
    refreshSrc?: (() => Promise<string>) | null;
  }>(),
  {
    poster: null,
    width: 0,
    height: 0,
    durationMs: 0,
    storyboard: null,
    autoplay: false,
    muted: false,
    loop: false,
    startAt: 0,
    fillBox: false,
    controls: "full",
    listenKeyboard: "focus",
    seekArrows: true,
    refreshSrc: null,
  },
);

const emit = defineEmits<{
  (e: "play"): void;
  (e: "pause"): void;
  /** The first frame is on screen. */
  (e: "playing"): void;
  (e: "ended"): void;
  (e: "timeupdate", currentTime: number): void;
  (e: "pip", active: boolean): void;
  (e: "fullscreen", active: boolean): void;
  (e: "error", kind: string): void;
}>();

const { t } = useLocale();

/** Telegram's beat: chrome hides after this long without the pointer moving. */
const HIDE_CONTROLS_MS = 2000;
const HOLD_DELAY_MS = 200;
const HOLD_TIP_MS = 1500;
const HOLD_MOVE_PX = 2;
const SEEK_STEP = 5;
const SEEK_JUMP = 10;
const VOLUME_STEP = 0.05;

const full = computed(() => props.controls === "full");
const source = computed(() => (full.value ? "viewer" : "inline"));
const pipSupported =
  props.controls === "full" && typeof document !== "undefined" && document.pictureInPictureEnabled === true;

const rootRef = ref<HTMLElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const progressRef = ref<HTMLElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);
const previewRef = ref<HTMLCanvasElement | null>(null);
const rateRef = ref<HTMLElement | null>(null);

const currentSrc = ref(props.src);
const playing = ref(false);
/** Asked to play and not paused since: what the buffering spinner keys on. */
const wantsPlay = ref(false);
const readyState = ref(0);
const duration = ref(props.durationMs > 0 ? props.durationMs / 1000 : 0);
const elapsed = ref(Math.floor(props.startAt || 0));
const bufferedFraction = ref(0);
const scrubbing = ref(false);
const hoverTime = ref<number | null>(null);
const tooltipLeft = ref(0);
const fullscreen = ref(false);
const pip = ref(false);
const failure = ref<string | null>(null);
const menuOpen = ref(false);
const activity = ref(true);
const overControls = ref(false);
const currentRate = ref(full.value ? playerPlaybackRate.value : 1);
const holdActive = ref(false);
const holdTip = ref(false);
/** The browser refused sound without a gesture; muted to play anyway until the user unmutes. */
const autoMuted = ref(false);

/** The volume slider's value while it is dragged: live on the video, stored when it is let go. */
const volumeDraft = ref<number | null>(null);
const shownVolume = computed(() => volumeDraft.value ?? playerVolume.value);

const longForm = computed(() => duration.value >= 3600);
const audioMuted = computed(
  () =>
    props.muted ||
    autoMuted.value ||
    (volumeDraft.value !== null ? volumeDraft.value === 0 : playerMuted.value || playerVolume.value === 0),
);
/** HTMLMediaElement.HAVE_FUTURE_DATA: below it, playing means waiting. */
const HAVE_FUTURE_DATA = 3;
const buffering = computed(
  () => full.value && !failure.value && !pip.value && (!currentSrc.value || (wantsPlay.value && readyState.value < HAVE_FUTURE_DATA)),
);
const controlsVisible = computed(
  () =>
    !holdActive.value &&
    (!playing.value || menuOpen.value || scrubbing.value || overControls.value || activity.value || !!failure.value),
);

// ── Loading ─────────────────────────────────────────────────────────

let autoplayPending = props.autoplay;
let pendingSeek: number | null = props.startAt > 0 ? props.startAt : null;
let resumeAfterLoad = false;
let hadData = false;
/**
 * One quiet refresh of a stale address per player — a player shows one video, so this is per file.
 * Not reset by the parent handing the refreshed address back as `src`.
 */
let quietRefreshUsed = false;
/** A retry is fetching a fresh address: `src` changing meanwhile is that address, loaded by the retry. */
let refreshing = false;

function load(src: string) {
  const video = videoRef.value;
  if (!video) return;
  hadData = false;
  readyState.value = 0;
  failure.value = null;
  stalled = false;
  // Setting src (even to the same address) starts the load algorithm on its own.
  if (src) video.src = src;
  else {
    video.removeAttribute("src");
    video.load();
  }
  applyAudio();
  applyRate();
  if (src && autoplayPending) {
    autoplayPending = false;
    void play();
  } else if (src && resumeAfterLoad) {
    resumeAfterLoad = false;
    void play();
  }
}

/** The same video from another address, at the same moment and in the same state (or playing, for a retry). */
function reloadAt(src: string, resume = wantsPlay.value || !videoRef.value?.paused) {
  const video = videoRef.value;
  if (!video) return;
  if (hadData) pendingSeek = video.currentTime;
  resumeAfterLoad = resume;
  currentSrc.value = src;
  load(src);
}

watch(
  () => props.src,
  (src) => {
    if (refreshing || src === currentSrc.value) return;
    if (currentSrc.value) reloadAt(src);
    else {
      currentSrc.value = src;
      load(src);
    }
  },
);

/** Reloads where it was and plays, from a fresh address when the parent can give one. Loads once. */
async function retry() {
  failure.value = null;
  let src = currentSrc.value;
  if (props.refreshSrc) {
    refreshing = true;
    try {
      src = await props.refreshSrc();
    } catch {
      /* the old address it is */
    } finally {
      refreshing = false;
    }
  }
  reloadAt(src, true);
}

// ── Metrics: one play per player (a retry or a refreshed URL is the same play) ──

let startTimer: MetricTimer | null = null;
let started = false;
let failedStart = false;
let stalled = false;

function failStart(kind: string) {
  if (started || failedStart) return;
  failedStart = true;
  startTimer = null;
  metrics.count("video.play", { source: source.value, result: "failed", error: kind });
}

function mediaErrorKind(error: MediaError | null): string {
  switch (error?.code) {
    case 1:
      return "media_aborted";
    case 2:
      return "media_network";
    case 3:
      return "media_decode";
    case 4:
      return "media_src_not_supported";
    default:
      return "media_unknown";
  }
}

// ── Playback ────────────────────────────────────────────────────────

async function play(): Promise<void> {
  const video = videoRef.value;
  if (!video) return;
  if (!currentSrc.value) {
    autoplayPending = true;
    return;
  }
  wantsPlay.value = true;
  if (full.value) stopContinuedPictureInPicture();
  if (!started && !failedStart && !startTimer) startTimer = metrics.startTimer("video.playback.start", { source: source.value });
  try {
    await video.play();
  } catch (e) {
    const kind = errorKind(e);
    // A pause() or a new source interrupted it: not a failure.
    if (kind === "AbortError") return;
    if (kind === "NotAllowedError" && !video.muted) {
      autoMuted.value = true;
      video.muted = true;
      try {
        await video.play();
        return;
      } catch (again) {
        if (errorKind(again) === "AbortError") return;
        wantsPlay.value = false;
        failStart(errorKind(again));
        return;
      }
    }
    wantsPlay.value = false;
    failStart(kind);
  }
}

function pause() {
  autoplayPending = false;
  resumeAfterLoad = false;
  wantsPlay.value = false;
  videoRef.value?.pause();
}

function togglePlay() {
  const video = videoRef.value;
  if (!video) return;
  if (video.paused || video.ended) void play();
  else pause();
  bumpActivity();
}

function seek(time: number) {
  const video = videoRef.value;
  if (!video) return;
  const total = video.duration || duration.value;
  const target = Math.max(0, total > 0 ? Math.min(time, total) : time);
  if (!hadData) {
    pendingSeek = target;
    return;
  }
  video.currentTime = target;
  renderProgress();
}

function seekBy(delta: number) {
  const video = videoRef.value;
  if (video) seek(video.currentTime + delta);
}

// ── Audio and speed ─────────────────────────────────────────────────

function applyAudio() {
  const video = videoRef.value;
  if (!video) return;
  const muted = volumeDraft.value !== null ? volumeDraft.value === 0 : playerMuted.value;
  video.muted = props.muted || autoMuted.value || muted;
  if (!props.muted) video.volume = shownVolume.value;
}

watch([playerVolume, playerMuted, () => props.muted], applyAudio);

function toggleMute() {
  if (props.muted) return;
  if (audioMuted.value) {
    autoMuted.value = false;
    playerMuted.value = false;
    if (playerVolume.value === 0) playerVolume.value = 0.5;
  } else {
    playerMuted.value = true;
  }
  applyAudio();
  bumpActivity();
}

/** Sets and stores the volume (a key press, a released slider). */
function setVolume(volume: number) {
  volumeDraft.value = null;
  autoMuted.value = false;
  playerVolume.value = volume;
  playerMuted.value = volume === 0;
  applyAudio();
}

// Dragging moves the volume live and stores it once, when the slider is let go (`change`).
function onVolumeInput(e: Event) {
  autoMuted.value = false;
  volumeDraft.value = Number((e.target as HTMLInputElement).value);
  applyAudio();
}

function onVolumeChange(e: Event) {
  setVolume(Number((e.target as HTMLInputElement).value));
}

function applyRate() {
  const video = videoRef.value;
  if (!video) return;
  video.defaultPlaybackRate = currentRate.value;
  video.playbackRate = currentRate.value;
}

/** The custom-speed slider moved and has not been let go yet. */
let rateUnstored = false;

/** A chosen speed is remembered for the next video; a held one (or one mid-drag) is not. */
function setRate(rate: number, remember = true) {
  currentRate.value = remember ? clampPlaybackRate(rate) : rate;
  applyRate();
  if (remember) {
    rateUnstored = false;
    playerPlaybackRate.value = currentRate.value;
  }
}

function chooseRate(rate: number) {
  setRate(rate);
  menuOpen.value = false;
}

function onCustomRateInput(e: Event) {
  rateUnstored = true;
  setRate(clampPlaybackRate(Number((e.target as HTMLInputElement).value)), false);
}

function onCustomRateChange(e: Event) {
  setRate(Number((e.target as HTMLInputElement).value));
}

// ── Progress ────────────────────────────────────────────────────────

let raf = 0;

function renderProgress() {
  const video = videoRef.value;
  const root = rootRef.value;
  if (!video || !root) return;
  const total = video.duration || duration.value;
  const at = video.currentTime;
  root.style.setProperty("--vp-progress", String(fraction(at, total)));
  const whole = Math.floor(at);
  if (whole !== elapsed.value) elapsed.value = whole;
}

function startProgressLoop() {
  if (!full.value) return;
  cancelAnimationFrame(raf);
  const tick = () => {
    renderProgress();
    raf = videoRef.value && !videoRef.value.paused ? requestAnimationFrame(tick) : 0;
  };
  tick();
}

function updateBuffered() {
  const video = videoRef.value;
  if (!video || !full.value) return;
  const total = video.duration || duration.value;
  bufferedFraction.value = fraction(bufferedEnd(video.buffered, video.currentTime), total);
}

// ── Scrubbing and the hover preview ─────────────────────────────────

let wasPlayingBeforeScrub = false;

function progressAt(e: PointerEvent): number {
  const rect = progressRef.value!.getBoundingClientRect();
  return pointerFraction(e.clientX, rect.left, rect.width);
}

function onScrubStart(e: PointerEvent) {
  const video = videoRef.value;
  if (!video || e.button !== 0 || !progressRef.value) return;
  e.preventDefault();
  try {
    progressRef.value.setPointerCapture(e.pointerId);
  } catch {
    /* a synthetic pointer has nothing to capture */
  }
  scrubbing.value = true;
  wasPlayingBeforeScrub = !video.paused;
  if (wasPlayingBeforeScrub) video.pause();
  scrubTo(e);
}

function scrubTo(e: PointerEvent) {
  const video = videoRef.value;
  if (!video) return;
  const total = video.duration || duration.value;
  seek(scrubTime(progressAt(e), total));
  updateHover(e);
}

function onProgressMove(e: PointerEvent) {
  if (scrubbing.value) scrubTo(e);
  else updateHover(e);
}

function onScrubEnd(e: PointerEvent) {
  if (!scrubbing.value) return;
  try {
    progressRef.value?.releasePointerCapture(e.pointerId);
  } catch {
    /* not captured */
  }
  scrubbing.value = false;
  if (wasPlayingBeforeScrub) void play();
  wasPlayingBeforeScrub = false;
  if (e.type === "pointercancel") hoverTime.value = null;
}

function onProgressLeave() {
  if (!scrubbing.value) hoverTime.value = null;
}

function updateHover(e: PointerEvent) {
  const bar = progressRef.value;
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const f = pointerFraction(e.clientX, rect.left, rect.width);
  const total = videoRef.value?.duration || duration.value;
  hoverTime.value = f * total;
  const width = tooltipRef.value?.offsetWidth || (props.storyboard ? props.storyboard.map.frameWidth * 1.5 : 48);
  tooltipLeft.value = tooltipCentre(f * rect.width, rect.width, width);
  drawPreview(hoverTime.value);
}

let sprite: HTMLImageElement | null = null;
let spriteReady = false;
let drawnFrame = -1;

function ensureSprite() {
  const board = props.storyboard;
  if (sprite || !board) return;
  sprite = new Image();
  if (board.crossOrigin) sprite.crossOrigin = board.crossOrigin;
  sprite.decoding = "async";
  sprite.onload = () => {
    spriteReady = true;
    drawnFrame = -1;
    if (hoverTime.value !== null) drawPreview(hoverTime.value);
  };
  sprite.src = board.url;
}

function drawPreview(time: number) {
  const board = props.storyboard;
  const canvas = previewRef.value;
  if (!board || !canvas) return;
  ensureSprite();
  if (!spriteReady || !sprite) return;
  const cell = storyboardFrameAt(board.map, time * 1000);
  if (!cell || cell.index === drawnFrame) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sprite, cell.x, cell.y, cell.width, cell.height, 0, 0, canvas.width, canvas.height);
  drawnFrame = cell.index;
}

function releaseSprite() {
  if (sprite) {
    sprite.onload = null;
    sprite.src = "";
  }
  sprite = null;
  spriteReady = false;
  drawnFrame = -1;
}

watch(
  () => props.storyboard?.url,
  () => releaseSprite(),
);

// ── Frame stepping ──────────────────────────────────────────────────

let frameSeconds = DEFAULT_FRAME_SECONDS;
const frameGaps: number[] = [];
let lastMediaTime = -1;
let frameCallback = 0;

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** Learns the frame length from a few frames while playing, for `,` and `.` later. */
function sampleFrames() {
  const video = videoRef.value as FrameCallbackVideo | null;
  if (!video?.requestVideoFrameCallback || frameGaps.length >= 12 || frameCallback) return;
  frameCallback = video.requestVideoFrameCallback((_, meta) => {
    frameCallback = 0;
    if (lastMediaTime >= 0 && meta.mediaTime > lastMediaTime) frameGaps.push(meta.mediaTime - lastMediaTime);
    lastMediaTime = meta.mediaTime;
    if (frameGaps.length >= 12) frameSeconds = estimateFrameDuration(frameGaps);
    else if (!video.paused) sampleFrames();
  });
}

function stepFrame(direction: 1 | -1) {
  const video = videoRef.value;
  if (!video) return;
  if (frameGaps.length) frameSeconds = estimateFrameDuration(frameGaps);
  seek(video.currentTime + direction * frameSeconds);
}

// ── Picture-in-picture and full screen ──────────────────────────────

async function togglePictureInPicture() {
  const video = videoRef.value;
  if (!video || !pipSupported) return;
  try {
    if (document.pictureInPictureElement === video) {
      await document.exitPictureInPicture();
    } else {
      if (document.fullscreenElement) await document.exitFullscreen();
      await video.requestPictureInPicture();
    }
  } catch {
    /* refused (no metadata yet, or the browser said no) */
  }
}

async function requestFullscreen() {
  const root = rootRef.value;
  if (!root || document.fullscreenElement === root) return;
  try {
    await root.requestFullscreen();
  } catch {
    /* refused */
  }
}

async function toggleFullscreen() {
  if (document.fullscreenElement === rootRef.value) {
    try {
      await document.exitFullscreen();
    } catch {
      /* already out */
    }
  } else {
    await requestFullscreen();
  }
  bumpActivity();
}

function onFullscreenChange() {
  const on = !!rootRef.value && document.fullscreenElement === rootRef.value;
  if (on === fullscreen.value) return;
  fullscreen.value = on;
  emit("fullscreen", on);
}

// ── Pointer: click, double-click, hold for speed, auto-hide ─────────

let activityTimer: ReturnType<typeof setTimeout> | undefined;

function bumpActivity() {
  if (!full.value) return;
  activity.value = true;
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => {
    activity.value = false;
  }, HIDE_CONTROLS_MS);
}

function onPointerActivity() {
  bumpActivity();
}

function onPointerLeave() {
  if (!full.value) return;
  clearTimeout(activityTimer);
  activity.value = false;
}

let suppressClick = false;

function onVideoClick() {
  if (!full.value) return;
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  togglePlay();
}

function onVideoDblClick() {
  if (full.value) void toggleFullscreen();
}

function onVideoContextMenu(e: MouseEvent) {
  // The chat's own menu handles a right-click on the inline preview.
  if (full.value) e.preventDefault();
}

interface Hold {
  x: number;
  y: number;
  start: number;
  from: number;
  timer: ReturnType<typeof setTimeout>;
  tipTimer?: ReturnType<typeof setTimeout>;
  abort: AbortController;
}
let hold: Hold | null = null;

function onVideoPointerDown(e: PointerEvent) {
  const video = videoRef.value;
  if (!full.value || !video || video.paused || e.button !== 0 || hold) return;
  const abort = new AbortController();
  hold = {
    x: e.clientX,
    y: e.clientY,
    from: currentRate.value,
    start: holdStartRate(currentRate.value),
    timer: setTimeout(() => activateHold(true), HOLD_DELAY_MS),
    abort,
  };
  window.addEventListener("pointermove", onHoldMove, { signal: abort.signal });
  window.addEventListener("pointerup", endHold, { signal: abort.signal });
  window.addEventListener("pointercancel", endHold, { signal: abort.signal });
  window.addEventListener("blur", () => endHold(), { signal: abort.signal });
}

function activateHold(showTip: boolean) {
  if (!hold || holdActive.value) return;
  holdActive.value = true;
  setRate(hold.start, false);
  if (showTip) {
    holdTip.value = true;
    hold.tipTimer = setTimeout(() => (holdTip.value = false), HOLD_TIP_MS);
  }
}

function onHoldMove(e: PointerEvent) {
  if (!hold) return;
  const dx = e.clientX - hold.x;
  if (!holdActive.value) {
    if (Math.hypot(dx, e.clientY - hold.y) <= HOLD_MOVE_PX) return;
    clearTimeout(hold.timer);
    activateHold(false);
  }
  holdTip.value = false;
  setRate(speedFromDrag(hold.start, dx), false);
}

function endHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  clearTimeout(hold.tipTimer);
  hold.abort.abort();
  if (holdActive.value) {
    suppressClick = true;
    setRate(hold.from, false);
    // The click that ends a hold is not a pause; nothing else waits on it.
    setTimeout(() => (suppressClick = false), 0);
  }
  holdActive.value = false;
  holdTip.value = false;
  hold = null;
}

// ── Keyboard ────────────────────────────────────────────────────────

function handleKey(e: KeyboardEvent): boolean {
  const video = videoRef.value;
  if (!video || !full.value || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey) return false;
  if (isTextEntryTarget(e.target)) return false;
  // Space presses a focused button (the viewer's close or download, or one of ours) instead.
  if (e.code === "Space" && pressesOnSpace(e.target)) return false;
  if (e.key === "Escape") {
    if (!menuOpen.value) return false;
    menuOpen.value = false;
    return true;
  }
  if (e.altKey) {
    if (e.code === "Equal" || e.code === "NumpadAdd") setRate(stepPlaybackRate(currentRate.value, 1));
    else if (e.code === "Minus" || e.code === "NumpadSubtract") setRate(stepPlaybackRate(currentRate.value, -1));
    else return false;
    bumpActivity();
    return true;
  }
  if (e.shiftKey) return false;
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (digit) {
    seek(((video.duration || duration.value) * Number(digit[1])) / 10);
  } else {
    switch (e.code) {
      case "Space":
      case "KeyK":
        togglePlay();
        break;
      case "KeyF":
        void toggleFullscreen();
        break;
      case "KeyM":
        toggleMute();
        break;
      case "KeyJ":
        seekBy(-SEEK_JUMP);
        break;
      case "KeyL":
        seekBy(SEEK_JUMP);
        break;
      case "Comma":
      case "Period":
        if (!video.paused) return false;
        stepFrame(e.code === "Period" ? 1 : -1);
        break;
      default:
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          if (!props.seekArrows && !fullscreen.value) return false;
          seekBy(e.key === "ArrowRight" ? SEEK_STEP : -SEEK_STEP);
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          if (props.muted) return false;
          setVolume(stepVolume(audioMuted.value ? 0 : shownVolume.value, e.key === "ArrowUp" ? VOLUME_STEP : -VOLUME_STEP));
        } else {
          return false;
        }
    }
  }
  bumpActivity();
  return true;
}

function onKey(e: KeyboardEvent) {
  if (!handleKey(e)) return;
  e.preventDefault();
  e.stopPropagation();
}

function onFocusKeydown(e: KeyboardEvent) {
  if (props.listenKeyboard === "focus") onKey(e);
}

// ── Media events ────────────────────────────────────────────────────

let listeners: AbortController | null = null;

function syncReady() {
  const video = videoRef.value;
  if (video) readyState.value = video.readyState;
}

function wire(video: HTMLVideoElement) {
  listeners = new AbortController();
  const signal = listeners.signal;
  const on = (type: string, fn: (e: Event) => void) => video.addEventListener(type, fn, { signal });

  on("loadedmetadata", () => {
    hadData = true;
    if (Number.isFinite(video.duration) && video.duration > 0) duration.value = video.duration;
    if (pendingSeek !== null) {
      video.currentTime = Math.min(pendingSeek, video.duration || pendingSeek);
      pendingSeek = null;
    }
    applyRate();
    renderProgress();
    syncReady();
  });
  on("durationchange", () => {
    if (Number.isFinite(video.duration) && video.duration > 0) duration.value = video.duration;
  });
  for (const type of ["loadeddata", "canplay", "canplaythrough", "seeking", "seeked", "stalled", "emptied"]) on(type, syncReady);
  on("play", () => {
    playing.value = true;
    wantsPlay.value = true;
    syncReady();
    startProgressLoop();
    bumpActivity();
    emit("play");
  });
  on("pause", () => {
    playing.value = false;
    wantsPlay.value = false;
    cancelAnimationFrame(raf);
    renderProgress();
    syncReady();
    emit("pause");
  });
  on("playing", () => {
    syncReady();
    failure.value = null;
    stalled = false;
    if (!started) {
      started = true;
      startTimer?.end();
      startTimer = null;
      metrics.count("video.play", { source: source.value, result: "ok" });
      emit("playing");
    }
    if (full.value) sampleFrames();
  });
  on("waiting", () => {
    syncReady();
    if (started && !stalled && !video.seeking && !video.paused) {
      stalled = true;
      metrics.count("video.playback.stall", { source: source.value });
    }
  });
  on("timeupdate", () => {
    if (video.paused) renderProgress();
    updateBuffered();
    emit("timeupdate", video.currentTime);
  });
  on("progress", updateBuffered);
  on("seeked", () => {
    renderProgress();
    updateBuffered();
  });
  on("ended", () => {
    playing.value = false;
    wantsPlay.value = false;
    renderProgress();
    emit("ended");
  });
  on("error", () => {
    if (!video.error) return;
    const kind = mediaErrorKind(video.error);
    // A URL that went stale after playing for a while: one quiet refresh before saying anything.
    if (hadData && props.refreshSrc && !quietRefreshUsed && kind === "media_network") {
      quietRefreshUsed = true;
      void retry();
      return;
    }
    wantsPlay.value = false;
    failStart(kind);
    if (full.value) failure.value = kind;
    emit("error", kind);
  });

  if (!full.value) return;
  on("enterpictureinpicture", () => {
    pip.value = true;
    emit("pip", true);
  });
  on("leavepictureinpicture", () => {
    pip.value = false;
    emit("pip", false);
  });
  document.addEventListener("fullscreenchange", onFullscreenChange, { signal });
  if (props.listenKeyboard === "always") window.addEventListener("keydown", onKey, { capture: true, signal });
}

// The speed menu fits inside the player (it scrolls in a short one) and closes on a press anywhere
// outside it.
const menuMaxHeight = ref(320);
let menuAbort: AbortController | null = null;
watch(menuOpen, (open) => {
  menuAbort?.abort();
  menuAbort = null;
  if (!open) return;
  menuMaxHeight.value = Math.max(120, (rootRef.value?.clientHeight ?? 360) - 60);
  menuAbort = new AbortController();
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (rateRef.value?.contains(e.target as Node)) return;
      menuOpen.value = false;
      // A press on the picture only closes the menu; it does not also pause.
      if (e.target === videoRef.value) suppressClick = true;
    },
    { capture: true, signal: menuAbort.signal },
  );
});

onMounted(() => {
  const video = videoRef.value!;
  wire(video);
  applyAudio();
  applyRate();
  if (currentSrc.value) load(currentSrc.value);
  bumpActivity();
});

onBeforeUnmount(() => {
  listeners?.abort();
  menuAbort?.abort();
  cancelAnimationFrame(raf);
  clearTimeout(activityTimer);
  endHold();
  releaseSprite();
  // A slider closed mid-drag still keeps what it was moved to.
  if (volumeDraft.value !== null) setVolume(volumeDraft.value);
  if (rateUnstored) setRate(currentRate.value);
  const video = videoRef.value as FrameCallbackVideo | null;
  if (!video) return;
  if (frameCallback) video.cancelVideoFrameCallback?.(frameCallback);
  // In picture-in-picture it plays on after the viewer is gone; leaving PiP stops it.
  if (continueInPictureInPicture(video)) return;
  video.pause();
  video.removeAttribute("src");
  video.load();
});

defineExpose({
  play,
  pause,
  seek,
  togglePictureInPicture,
  requestFullscreen,
  /** The element, for tests and for whoever needs to read its state. */
  video: videoRef,
});
</script>

<style scoped>
.vp {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  color: #fff;
  outline: none;
  user-select: none;
  -webkit-user-select: none;
  --vp-progress: 0;
  --vp-accent: hsl(var(--primary));
}

.vp--inline {
  background: transparent;
}

.vp-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.vp--cover .vp-video {
  object-fit: cover;
}

.vp--full .vp-video {
  cursor: pointer;
}

.vp.vp--full.is-playing:not(.show-controls):not(.is-changing-speed) {
  cursor: none;
}

.vp.vp--full.is-playing:not(.show-controls) .vp-video {
  cursor: none;
}

.vp.is-fullscreen {
  border-radius: 0 !important;
}

/* ── Centre play, spinner, error, PiP note ── */

.vp-big-play {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 64px;
  height: 64px;
  margin: -32px 0 0 -32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
  backdrop-filter: blur(6px);
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
  z-index: 3;
}

.vp-big-play-icon {
  width: 28px;
  height: 28px;
  margin-left: 4px;
  fill: currentColor;
}

.vp.is-playing .vp-big-play,
.vp.is-seeking .vp-big-play,
.vp.is-buffering .vp-big-play,
.vp.is-pip .vp-big-play {
  opacity: 0;
  transform: scale(0.85);
}

.vp-spinner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 4;
  animation: vp-fade-in 0.2s ease 0.25s both;
}

.vp-spinner-icon {
  width: 44px;
  height: 44px;
  padding: 8px;
  border-radius: 50%;
  background: rgb(0 0 0 / 0.45);
  color: #fff;
}

@keyframes vp-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.vp-error {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgb(0 0 0 / 0.6);
  font-size: 14px;
  text-align: center;
  padding: 16px;
}

.vp-error-retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgb(255 255 255 / 0.16);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.vp-error-retry:hover {
  background: rgb(255 255 255 / 0.26);
}

.vp-note {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: rgb(255 255 255 / 0.7);
  z-index: 2;
  pointer-events: none;
}

/* ── Press-and-hold speed ── */

.vp-speed {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(6px);
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  z-index: 6;
}

.vp-speed-arrows {
  display: inline-flex;
}

.vp-speed-arrow {
  width: 11px;
  height: 11px;
  fill: currentColor;
  opacity: 0.35;
  animation: vp-speed-arrow calc(1.2s / var(--vp-speed, 1)) linear infinite;
}

.vp-speed-arrow--last {
  margin-left: -3px;
  animation-delay: calc(0.3s / var(--vp-speed, 1));
}

@keyframes vp-speed-arrow {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

.vp-speed-tip {
  position: absolute;
  top: 54px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 10px;
  border-radius: 8px;
  background: rgb(0 0 0 / 0.55);
  font-size: 12px;
  color: rgb(255 255 255 / 0.85);
  white-space: nowrap;
  pointer-events: none;
  z-index: 6;
}

/* ── Chrome: gradient and controls ── */

.vp-gradient,
.vp-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
  opacity: 0;
  transform: translateY(12px);
  pointer-events: none;
}

.vp-gradient {
  height: 96px;
  background: linear-gradient(to bottom, transparent, rgb(0 0 0 / 0.72));
  z-index: 4;
}

.vp-controls {
  z-index: 5;
  padding: 0 12px 6px;
}

.vp.show-controls .vp-gradient,
.vp.show-controls .vp-controls {
  opacity: 1;
  transform: none;
}

.vp.show-controls .vp-controls {
  pointer-events: auto;
}

/* ── Progress line: 4 px, taller under the pointer ── */

.vp-progress {
  position: relative;
  height: 16px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
  outline: none;
}

.vp-progress-rail {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 4px;
  background: rgb(255 255 255 / 0.22);
  overflow: hidden;
  transition: height 0.12s ease;
}

.vp-progress:hover .vp-progress-rail,
.vp.is-seeking .vp-progress-rail {
  height: 6px;
}

.vp-progress-buffered,
.vp-progress-played {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
}

.vp-progress-buffered {
  background: rgb(255 255 255 / 0.3);
}

.vp-progress-played {
  width: calc(var(--vp-progress) * 100%);
  background: var(--vp-accent);
}

.vp-progress-thumb {
  position: absolute;
  top: 50%;
  left: calc(var(--vp-progress) * 100%);
  width: 13px;
  height: 13px;
  margin: -6.5px 0 0 -6.5px;
  border-radius: 50%;
  background: var(--vp-accent);
  transform: scale(0);
  transition: transform 0.12s ease;
  pointer-events: none;
}

.vp-progress:hover .vp-progress-thumb,
.vp.is-seeking .vp-progress-thumb {
  transform: scale(1);
}

.vp-tooltip {
  position: absolute;
  bottom: 22px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  pointer-events: none;
}

.vp-preview {
  display: block;
  border-radius: 10px;
  border: 2px solid rgb(255 255 255 / 0.15);
  background: #000;
}

.vp-tooltip-time {
  padding: 2px 8px;
  border-radius: 6px;
  background: rgb(0 0 0 / 0.65);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ── Buttons row ── */

.vp-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  gap: 8px;
}

.vp-bar-side {
  display: flex;
  align-items: center;
  min-width: 0;
}

.vp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 6px;
  border-radius: 8px;
  color: #fff;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;
}

.vp-btn:hover {
  background: rgb(255 255 255 / 0.12);
}

.vp-btn:focus-visible,
.vp-menu-item:focus-visible,
.vp-error-retry:focus-visible {
  outline: 2px solid rgb(255 255 255 / 0.8);
  outline-offset: -2px;
}

.vp-icon {
  width: 20px;
  height: 20px;
}

.vp-icon--filled {
  fill: currentColor;
}

.vp-time {
  margin-left: 6px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.vp-time-sep {
  opacity: 0.6;
}

/* ── Volume: a slider that opens on hover ── */

.vp-volume {
  display: flex;
  align-items: center;
  width: 36px;
  overflow: hidden;
  transition: width 0.2s ease;
}

.vp-volume:hover,
.vp-volume:focus-within {
  width: 112px;
}

.vp-volume-slider {
  width: 64px;
  min-width: 64px;
  margin: 0 8px 0 4px;
}

.vp-range {
  --vp-range: 0;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 4px;
  background: linear-gradient(
    to right,
    #fff calc(var(--vp-range) * 100%),
    rgb(255 255 255 / 0.3) calc(var(--vp-range) * 100%)
  );
  cursor: pointer;
  outline: none;
}

.vp-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: none;
}

.vp-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  border: none;
}

/* ── Speed button and menu ── */

.vp-rate {
  position: relative;
}

.vp-rate-btn {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.vp-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  min-width: 172px;
  padding: 6px;
  border-radius: 12px;
  background: rgb(24 24 27 / 0.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
  z-index: 8;
}

.vp-menu-item {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  height: 30px;
  padding: 0 10px 0 6px;
  border-radius: 8px;
  font-size: 13px;
  color: #fff;
  text-align: left;
  cursor: pointer;
}

.vp-menu-item:hover {
  background: rgb(255 255 255 / 0.1);
}

.vp-menu-check {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.vp-menu-custom {
  flex-shrink: 0;
  margin-top: 4px;
  padding: 8px 8px 6px;
  border-top: 1px solid rgb(255 255 255 / 0.1);
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: rgb(255 255 255 / 0.75);
}

.vp-menu-custom-head {
  display: flex;
  justify-content: space-between;
}

@media (prefers-reduced-motion: reduce) {
  .vp-gradient,
  .vp-controls,
  .vp-big-play,
  .vp-volume,
  .vp-progress-rail,
  .vp-progress-thumb {
    transition: none;
  }
  .vp-speed-arrow {
    animation: none;
    opacity: 0.8;
  }
}
</style>
