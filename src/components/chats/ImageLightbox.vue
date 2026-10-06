<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div v-if="isOpen" class="lightbox-overlay" @click.self="close" @keydown="onKeydown" tabindex="0" ref="overlayRef">
        <!-- Close button -->
        <button class="lightbox-btn lightbox-close icon-motion icon-motion--pop" @click="close">
          <XIcon class="w-5 h-5" />
        </button>

        <!-- Navigation: prev -->
        <button v-if="images.length > 1" class="lightbox-btn lightbox-prev" @click.stop="prev">
          <ChevronLeftIcon class="w-6 h-6" />
        </button>

        <!-- Main image or video -->
        <div class="lightbox-content" @click.stop>
          <div v-if="currentVideo" class="lightbox-video" :style="videoBox" data-testid="lightbox-video">
            <VideoPlayer
              :key="`${currentIndex}:${currentVideo.fileId}`"
              :src="videoSrc ?? ''"
              :poster="videoPoster"
              :width="currentVideo.width"
              :height="currentVideo.height"
              :duration-ms="currentVideo.durationMs"
              :storyboard="videoStoryboard"
              :loop="loopsInViewer(currentVideo.durationMs)"
              :seek-arrows="images.length <= 1"
              :refresh-src="refreshVideoSrc"
              controls="full"
              listen-keyboard="always"
              autoplay
              @pip="onPip"
            />
          </div>
          <template v-else>
            <img
              :crossorigin="cdnCrossOrigin(currentSrc)" :src="currentSrc ?? ''"
              :alt="currentItem?.fileName ?? ''"
              class="lightbox-image"
              :class="{ loaded: imageLoaded }"
              @load="imageLoaded = true"
              draggable="false"
            />
            <div v-if="!currentSrc" class="lightbox-loading">
              <Loader2Icon class="w-8 h-8 animate-spin lightbox-spinner" />
            </div>
          </template>
        </div>

        <!-- Bottom info bar -->
        <div class="lightbox-info" :class="{ 'lightbox-info--top': !!currentVideo }">
          <span v-if="images.length > 1" class="lightbox-counter">{{ currentIndex + 1 }} / {{ images.length }}</span>
          <span v-if="currentItem" class="lightbox-meta">
            <template v-if="formattedSize">{{ formattedSize }}</template>
            <template v-if="formattedSize && currentItem.contentType"> · </template>
            <template v-if="currentItem.contentType">{{ currentItem.contentType }}</template>
            <template v-if="formattedDate"> · {{ formattedDate }}</template>
          </span>
        </div>

        <!-- Navigation: next -->
        <button v-if="images.length > 1" class="lightbox-btn lightbox-next" @click.stop="next">
          <ChevronRightIcon class="w-6 h-6" />
        </button>

        <!-- Copy: a picture for other apps, a reference for a paste back into a chat -->
        <button
          class="lightbox-btn lightbox-copy icon-motion icon-motion--pop"
          :class="{ 'lightbox-btn--top': !!currentVideo }"
          :title="currentVideo ? t('copy_file') : t('copy_image')"
          @click.stop="copy"
        >
          <CopyIcon class="w-5 h-5" />
        </button>

        <!-- Download button -->
        <button
          class="lightbox-btn lightbox-download icon-motion icon-motion--pop"
          :class="{ 'lightbox-btn--top': !!currentVideo }"
          @click.stop="download"
        >
          <DownloadIcon class="w-5 h-5" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { XIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, CopyIcon, Loader2Icon } from "lucide-vue-next";
import type { MessageEntityVideo } from "@argon/glue";
import VideoPlayer, { type VideoPlayerStoryboard } from "@/components/media/VideoPlayer.vue";
import { cdnCrossOrigin, cdnFetchUrl, cdnUrl, resolveAttachmentUrl } from "@/store/system/fileStorage";
import { copyAttachmentToClipboard } from "@/lib/attachments/clipboard";
import { useLocale } from "@/store/system/localeStore";
import { isVideoEntity, type ChatMediaItem } from "@/lib/media/mediaItem";
import { invalidateMediaUrl, resolveMediaUrl } from "@/lib/media/mediaUrl";
import { loopsInViewer } from "@/lib/video/playerSettings";
import { suspendChatVideos } from "@/lib/media/videoAutoplay";

const { t } = useLocale();

const props = defineProps<{
  /** Pictures and videos; the name stayed from when it showed pictures only. */
  images: ChatMediaItem[];
  initialIndex?: number;
  isOpen: boolean;
  timeSent?: Date | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

/** A video up to this size downloads through a blob; a bigger one opens in a new window instead. */
const BLOB_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
/** Room for the player's controls, however small the clip. */
const MIN_VIDEO_WIDTH = 360;

const overlayRef = ref<HTMLElement | null>(null);
const currentIndex = ref(props.initialIndex ?? 0);
const imageLoaded = ref(false);
const currentSrc = ref<string | null>(null);
const srcCache = new Map<string, string>();

const currentItem = computed<ChatMediaItem | undefined>(() => props.images[currentIndex.value]);
const currentVideo = computed<MessageEntityVideo | null>(() => {
  const item = currentItem.value;
  return item && isVideoEntity(item) ? item : null;
});

const formattedSize = computed(() => {
  const size = currentItem.value?.fileSize;
  if (!size) return null;
  const bytes = Number(size);
  if (bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

const formattedDate = computed(() => {
  if (!props.timeSent) return null;
  const d = props.timeSent;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

async function loadImage(fileId: string) {
  if (srcCache.has(fileId)) {
    currentSrc.value = srcCache.get(fileId)!;
    return;
  }
  currentSrc.value = null;
  imageLoaded.value = false;
  const url = resolveAttachmentUrl(fileId, currentItem.value?.downloadUrl ?? null);
  srcCache.set(fileId, url);
  currentSrc.value = url;
}

// ── Video slide ─────────────────────────────────────────────────────

const videoSrc = ref<string | null>(null);
let videoToken = 0;

/** Plays from the file's direct storage URL (byte ranges), never through the redirect or app://. */
function loadVideo(video: MessageEntityVideo) {
  const token = ++videoToken;
  videoSrc.value = null;
  void resolveMediaUrl(video.fileId).then((url) => {
    if (token === videoToken) videoSrc.value = url;
  });
}

async function refreshVideoSrc(): Promise<string> {
  const video = currentVideo.value;
  if (!video) return videoSrc.value ?? "";
  invalidateMediaUrl(video.fileId);
  const url = await resolveMediaUrl(video.fileId);
  if (currentVideo.value === video) videoSrc.value = url;
  return url;
}

const videoPoster = computed(() => (currentVideo.value?.posterFileId ? cdnUrl(currentVideo.value.posterFileId) : null));

const videoStoryboard = computed<VideoPlayerStoryboard | null>(() => {
  const video = currentVideo.value;
  if (!video?.storyboardFileId || !video.storyboard) return null;
  const url = cdnUrl(video.storyboardFileId);
  return { url, map: video.storyboard, crossOrigin: cdnCrossOrigin(url) };
});

/**
 * The video's box: its own size, within 90 % × 85 % of the window, and at least wide enough for its
 * controls. Plain CSS, so nothing listens to the window while the viewer is closed.
 */
const videoBox = computed(() => {
  const video = currentVideo.value;
  const w = video?.width && video.width > 0 ? video.width : 16;
  const h = video?.height && video.height > 0 ? video.height : 9;
  return {
    aspectRatio: `${w} / ${h}`,
    width: `min(${Math.max(w, MIN_VIDEO_WIDTH)}px, 90vw, calc(85vh * ${w / h}))`,
  };
});

/** Into picture-in-picture: the viewer closes and the video plays on in its window. */
function onPip(active: boolean) {
  if (active) close();
}

function loadCurrent() {
  imageLoaded.value = false;
  const item = currentItem.value;
  if (!item) return;
  if (isVideoEntity(item)) {
    currentSrc.value = null;
    loadVideo(item);
  } else {
    videoToken++;
    videoSrc.value = null;
    void loadImage(item.fileId);
  }
}

watch(() => props.isOpen, async (open) => {
  // The chat's silent previews hold still behind the viewer.
  suspendChatVideos(open);
  if (open) {
    const index = props.initialIndex ?? 0;
    // A changed index loads through the watcher below; the same one has to be loaded here.
    if (currentIndex.value !== index) currentIndex.value = index;
    else loadCurrent();
    await nextTick();
    overlayRef.value?.focus();
  } else {
    videoToken++;
    videoSrc.value = null;
  }
});

watch(currentIndex, () => {
  if (props.isOpen) loadCurrent();
});

function close() {
  emit("close");
}

function prev() {
  if (currentIndex.value > 0) currentIndex.value--;
  else currentIndex.value = props.images.length - 1;
}

function next() {
  if (currentIndex.value < props.images.length - 1) currentIndex.value++;
  else currentIndex.value = 0;
}

function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  if (e.key === "Escape") {
    // In full screen Esc is the browser's: it leaves full screen, not the viewer.
    if (document.fullscreenElement) return;
    // Taken here, so the composer underneath does not also drop its reply or edit.
    e.preventDefault();
    close();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    prev();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    next();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
    e.preventDefault();
    void copy();
  }
}

async function copy() {
  if (currentItem.value) await copyAttachmentToClipboard(currentItem.value);
}

/**
 * Downloads go through a same-origin blob: URL, never by navigating. A cross-origin CDN href with
 * `download` is ignored by the browser, which then *navigates* to it — that fires
 * pagehide/beforeunload and LiveKit tears down the active voice call ("Page leave detected,
 * disconnecting"). A blob: URL never navigates. A video too big to hold in memory opens its direct
 * URL in a new window instead, which leaves this page alone just the same.
 */
async function download() {
  const item = currentItem.value;
  if (!item) return;
  if (isVideoEntity(item)) {
    const size = Number(item.fileSize);
    if (!(size > 0 && size <= BLOB_DOWNLOAD_MAX_BYTES)) {
      const url = await resolveMediaUrl(item.fileId);
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
  } else if (!currentSrc.value) {
    return;
  }
  try {
    const resp = await fetch(cdnFetchUrl(item.fileId));
    if (!resp.ok) return;
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = item.fileName || (isVideoEntity(item) ? "video" : "image");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    /* download failed — leave the call untouched */
  }
}

onBeforeUnmount(() => {
  srcCache.clear();
  videoToken++;
  if (props.isOpen) suspendChatVideos(false);
});
</script>

<style scoped>
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: hsl(0 0% 0% / 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  outline: none;
  -webkit-app-region: no-drag;
}

.lightbox-content {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-image {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  user-select: none;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.lightbox-image.loaded {
  opacity: 1;
}

.lightbox-video {
  position: relative;
  max-width: 90vw;
  max-height: 85vh;
  border-radius: 10px;
  overflow: hidden;
  background: #000;
}

.lightbox-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lightbox-spinner {
  color: #fff;
}

.lightbox-btn {
  position: absolute;
  z-index: 10;
  background: hsl(0 0% 100% / 0.1);
  border: none;
  color: white;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}

.lightbox-btn:hover {
  background: hsl(0 0% 100% / 0.25);
}

.lightbox-close {
  top: 16px;
  right: 16px;
}

.lightbox-prev {
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
}

.lightbox-next {
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
}

.lightbox-download {
  bottom: 16px;
  right: 16px;
}

.lightbox-copy {
  bottom: 16px;
  right: 64px;
}

/* A video's controls own the bottom edge: copy and download move up beside the close button. */
.lightbox-download.lightbox-btn--top {
  bottom: auto;
  top: 16px;
  right: 64px;
}

.lightbox-copy.lightbox-btn--top {
  bottom: auto;
  top: 16px;
  right: 112px;
}

.lightbox-info {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  color: hsl(0 0% 100% / 0.5);
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
}

.lightbox-info--top {
  bottom: auto;
  top: 26px;
}

.lightbox-counter {
  font-variant-numeric: tabular-nums;
}

.lightbox-meta {
  opacity: 0.8;
}

/* Transitions */
.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.2s ease;
}
.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}
</style>
