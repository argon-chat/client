<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { ExpressionFormat, sameMedia, type ExpressionMedia } from "@/lib/expressions/types";
import { EXPRESSION_SIZES, fitSize } from "@/lib/expressions/sizes";
import { decodeOutline } from "@/lib/expressions/outline";
import { getPreview, loadExpressionBytes, putPreview } from "@/lib/expressions/files";
import { clampPixelRatio, getLottiePool, type LottiePlayerHandle } from "@/lib/expressions/lottie/LottiePool";
import { isLottieSupported } from "@/lib/expressions/lottie/support";
import { getAnimationIntersector, type AnimationControl } from "@/lib/expressions/animationIntersector";
import { prefersReducedMotion } from "@/lib/expressions/settings";
import { paintFrameTinted } from "@/lib/expressions/tint";
import { cdnCrossOrigin, cdnFetchUrl, cdnUrl } from "@/store/system/fileStorage";

/**
 * A sticker in a box of `size` css px (aspect-fit). Until something is drawn it shows the outline;
 * a cached first frame replaces the outline at once when there is one. Static files are an <img>,
 * video ones a muted looping <video>, Lottie ones a canvas drawn by the Lottie worker pool. Where the
 * format cannot be shown (no wasm, a video that fails), the thumbnail stands in, else the outline.
 */
const props = withDefaults(
  defineProps<{
    media: ExpressionMedia;
    size?: number;
    /** Default: on, unless the OS prefers reduced motion. */
    autoplay?: boolean;
    loop?: boolean;
    group?: string;
    toneIndex?: number | null;
  }>(),
  { size: EXPRESSION_SIZES.chatSticker, autoplay: undefined, loop: true, group: "", toneIndex: null },
);

const emit = defineEmits<{ ready: []; error: [error: Error] }>();

type Phase = "pending" | "ready" | "fallback";

/** A loaded Lottie whose frame never reports as shown (a hidden page) is taken as shown after this. */
const PRESENT_FALLBACK_MS = 2000;

const root = ref<HTMLElement | null>(null);
const lottieCanvas = ref<HTMLCanvasElement | null>(null);
const previewCanvas = ref<HTMLCanvasElement | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const phase = ref<Phase>("pending");
const hasPreview = ref(false);
const generation = ref(0);

// Parents often rebuild `media` on every render; only a change of value may restart the player.
const media = shallowRef(props.media);
watch(
  () => props.media,
  (next) => {
    if (!sameMedia(next, media.value)) media.value = next;
  },
);

const box = computed(() => fitSize(media.value.width, media.value.height, props.size));
const src = computed(() => cdnUrl(media.value.fileId));
const thumbSrc = computed(() =>
  media.value.thumbFileId ? cdnUrl(media.value.thumbFileId) : (media.value.thumbUrl ?? null),
);

const outlinePath = computed(() => (media.value.outline?.length ? decodeOutline(media.value.outline) : null));
// Outlines are drawn in the sticker's own pixel space, 512 on its longer side.
const outlineViewBox = computed(() => {
  const { width, height } = media.value;
  const longer = Math.max(width, height) || 1;
  return `0 0 ${Math.round((512 * (width || 1)) / longer)} ${Math.round((512 * (height || 1)) / longer)}`;
});

const kind = computed<"static" | "lottie" | "video" | "unsupported">(() => {
  switch (media.value.format) {
    case ExpressionFormat.Static:
      return "static";
    case ExpressionFormat.Lottie:
      return isLottieSupported() ? "lottie" : "unsupported";
    case ExpressionFormat.Video:
      return "video";
    default:
      return "unsupported";
  }
});

const showOutline = computed(() => !!outlinePath.value && phase.value !== "ready" && !hasPreview.value);
const thumbFailed = ref(false);
watch(thumbSrc, () => (thumbFailed.value = false));
// A thumb that cannot load leaves the outline in place instead of the browser's broken-image icon.
const showThumb = computed(
  () => (phase.value === "fallback" || kind.value === "unsupported") && !!thumbSrc.value && !thumbFailed.value,
);
const maskStyle = computed(() => ({
  "-webkit-mask-image": `url("${src.value}")`,
  "mask-image": `url("${src.value}")`,
}));

let player: LottiePlayerHandle | null = null;
let videoControl: AnimationControl | null = null;
let presentTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;

function tintColor(): string | null {
  return media.value.textColor && root.value ? getComputedStyle(root.value).color : null;
}

function drawPreview(bitmap: ImageBitmap) {
  const canvas = previewCanvas.value;
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const ratio = clampPixelRatio(devicePixelRatio);
  canvas.width = Math.round(box.value.width * ratio);
  canvas.height = Math.round(box.value.height * ratio);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  paintFrameTinted(ctx, bitmap, tintColor());
  hasPreview.value = true;
}

function stopPresentTimer() {
  clearTimeout(presentTimer);
  presentTimer = undefined;
}

function markReady() {
  stopPresentTimer();
  if (disposed || phase.value === "ready") return;
  phase.value = "ready";
  emit("ready");
}

function fail(error: Error) {
  stopPresentTimer();
  if (disposed || phase.value === "fallback") return;
  phase.value = "fallback";
  emit("error", error);
}

function startLottie() {
  const canvas = lottieCanvas.value;
  if (!canvas) return;
  const { fileId } = media.value;
  const tone = props.toneIndex ?? null;
  const url = src.value;

  const cached = getPreview(fileId, tone);
  if (cached) drawPreview(cached);

  const handle = getLottiePool().createPlayer({
    canvas,
    fileId,
    load: () => loadExpressionBytes(fileId, url, cdnFetchUrl(fileId)),
    width: box.value.width,
    height: box.value.height,
    loop: props.loop,
    autoplay: props.autoplay,
    group: props.group,
    toneIndex: tone,
    textColor: tintColor(),
    onFirstFrame: (bitmap) => putPreview(fileId, tone, bitmap),
    // The underlay goes once the frame is on the canvas, not when the worker has merely drawn it.
    onFirstPresent: () => player === handle && markReady(),
    onError: fail,
  });
  player = handle;
  handle.ready.then(
    () => {
      if (player !== handle || phase.value !== "pending") return;
      presentTimer = setTimeout(() => player === handle && markReady(), PRESENT_FALLBACK_MS);
    },
    () => {},
  );
}

function startVideo() {
  const element = video.value;
  if (!element) return;
  const cached = getPreview(media.value.fileId, null);
  if (cached) drawPreview(cached);
  videoControl = getAnimationIntersector().add({
    el: element,
    group: props.group,
    autoplay: props.autoplay ?? !prefersReducedMotion(),
    setPlaying: (playing) => {
      if (playing) element.play().catch(() => {});
      else element.pause();
    },
  });
}

function startStatic() {
  if (!media.value.textColor) return; // the <img> reports its own load
  const probe = new Image();
  const co = cdnCrossOrigin(src.value);
  if (co) probe.crossOrigin = co;
  probe.onload = () => markReady();
  probe.onerror = () => fail(new Error("sticker image failed to load"));
  probe.src = src.value;
}

let alive = true;
/** The generation last started: each canvas is handed to a worker at most once. */
let startedGeneration = -1;

function start() {
  if (!alive || startedGeneration === generation.value) return;
  startedGeneration = generation.value;
  disposed = false;
  if (kind.value === "lottie") startLottie();
  else if (kind.value === "video") startVideo();
  else if (kind.value === "static") startStatic();
}

function teardown() {
  disposed = true;
  stopPresentTimer();
  player?.destroy();
  player = null;
  videoControl?.remove();
  videoControl = null;
}

function onVideoData() {
  const element = video.value;
  if (element && typeof createImageBitmap === "function") {
    const fileId = media.value.fileId;
    createImageBitmap(element).then(
      (bitmap) => putPreview(fileId, null, bitmap),
      () => {},
    );
  }
  markReady();
}

onMounted(start);
onBeforeUnmount(() => {
  alive = false;
  teardown();
});

// A different file or box needs a fresh canvas: one handed to a worker cannot be taken back. The
// canvas and the video are keyed by `generation`, so each restart renders new ones; restarts that
// pile up before that render (two parent updates in one flush) start once, on the last.
watch(
  [media, () => box.value.width, () => box.value.height, () => props.toneIndex, () => props.group],
  async () => {
    teardown();
    phase.value = "pending";
    hasPreview.value = false;
    const mine = ++generation.value;
    await nextTick();
    if (mine === generation.value) start();
  },
);

watch(
  () => props.autoplay,
  (autoplay) => {
    const value = autoplay ?? !prefersReducedMotion();
    player?.setAutoplay(value);
    videoControl?.setAutoplay(value);
  },
);

watch(
  () => props.loop,
  (loop) => player?.setLoop(loop),
);

defineExpose({
  play: () => {
    player?.play();
    videoControl?.play();
  },
  pause: () => {
    player?.pause();
    videoControl?.pause();
  },
});
</script>

<template>
  <div
    ref="root"
    class="sticker-view"
    :style="{ width: `${box.width}px`, height: `${box.height}px` }"
    :data-phase="phase"
  >
    <svg
      v-if="showOutline"
      class="sticker-view__outline"
      :viewBox="outlineViewBox"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <path :d="outlinePath!" />
    </svg>
    <img
      v-if="showThumb"
      class="sticker-view__layer"
      :src="thumbSrc!"
      :crossorigin="cdnCrossOrigin(thumbSrc)"
      alt=""
      draggable="false"
      @error="thumbFailed = true"
    />
    <canvas v-show="hasPreview && phase !== 'ready'" ref="previewCanvas" class="sticker-view__layer" aria-hidden="true" />
    <template v-if="phase !== 'fallback'">
      <template v-if="kind === 'static'">
        <span v-if="media.textColor" class="sticker-view__layer sticker-view__mask" :style="maskStyle" />
        <img
          v-else
          class="sticker-view__layer"
          :src="src"
          :crossorigin="cdnCrossOrigin(src)"
          alt=""
          draggable="false"
          decoding="async"
          @load="markReady"
          @error="fail(new Error('sticker image failed to load'))"
        />
      </template>
      <video
        v-else-if="kind === 'video'"
        :key="`v${generation}`"
        ref="video"
        class="sticker-view__layer"
        :src="src"
        :crossorigin="cdnCrossOrigin(src)"
        :loop="loop"
        muted
        playsinline
        preload="auto"
        disablepictureinpicture
        @loadeddata="onVideoData"
        @error="fail(new Error('sticker video cannot play'))"
      />
      <canvas v-else-if="kind === 'lottie'" :key="`c${generation}`" ref="lottieCanvas" class="sticker-view__layer" />
    </template>
  </div>
</template>

<style scoped>
.sticker-view {
  position: relative;
  display: inline-block;
  flex: none;
}

.sticker-view__outline {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: currentColor;
  opacity: 0.12;
}

.sticker-view__layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.sticker-view__mask {
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
</style>
