<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div v-if="isOpen" class="lightbox-overlay" @click.self="close" @keydown="onKeydown" tabindex="0" ref="overlayRef">
        <!-- Close button -->
        <button class="lightbox-btn lightbox-close" @click="close">
          <XIcon class="w-5 h-5" />
        </button>

        <!-- Navigation: prev -->
        <button v-if="images.length > 1" class="lightbox-btn lightbox-prev" @click.stop="prev">
          <ChevronLeftIcon class="w-6 h-6" />
        </button>

        <!-- Main image -->
        <div class="lightbox-content" @click.stop>
          <img
            :src="currentSrc ?? ''"
            :alt="currentImage?.fileName ?? ''"
            class="lightbox-image"
            :class="{ loaded: imageLoaded }"
            @load="imageLoaded = true"
            draggable="false"
          />
          <div v-if="!currentSrc" class="lightbox-loading">
            <Loader2Icon class="w-8 h-8 animate-spin text-white" />
          </div>
        </div>

        <!-- Bottom info bar -->
        <div class="lightbox-info">
          <span v-if="images.length > 1" class="lightbox-counter">{{ currentIndex + 1 }} / {{ images.length }}</span>
          <span v-if="currentImage" class="lightbox-meta">
            <template v-if="formattedSize">{{ formattedSize }}</template>
            <template v-if="formattedSize && currentImage.contentType"> · </template>
            <template v-if="currentImage.contentType">{{ currentImage.contentType }}</template>
            <template v-if="formattedDate"> · {{ formattedDate }}</template>
          </span>
        </div>

        <!-- Navigation: next -->
        <button v-if="images.length > 1" class="lightbox-btn lightbox-next" @click.stop="next">
          <ChevronRightIcon class="w-6 h-6" />
        </button>

        <!-- Download button -->
        <button class="lightbox-btn lightbox-download" @click.stop="download">
          <DownloadIcon class="w-5 h-5" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { XIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, Loader2Icon } from "lucide-vue-next";
import type { MessageEntityAttachment } from "@argon/glue";
import { cdnUrl } from "@/store/system/fileStorage";

const props = defineProps<{
  images: MessageEntityAttachment[];
  initialIndex?: number;
  isOpen: boolean;
  timeSent?: Date | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const overlayRef = ref<HTMLElement | null>(null);
const currentIndex = ref(props.initialIndex ?? 0);
const imageLoaded = ref(false);
const currentSrc = ref<string | null>(null);
const srcCache = new Map<string, string>();

const currentImage = computed(() => props.images[currentIndex.value]);

const formattedSize = computed(() => {
  const size = currentImage.value?.fileSize;
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
  const url = cdnUrl(fileId);
  srcCache.set(fileId, url);
  currentSrc.value = url;
}

watch(() => props.isOpen, async (open) => {
  if (open) {
    currentIndex.value = props.initialIndex ?? 0;
    imageLoaded.value = false;
    if (currentImage.value) await loadImage(currentImage.value.fileId);
    await nextTick();
    overlayRef.value?.focus();
  }
});

watch(currentIndex, async () => {
  imageLoaded.value = false;
  if (currentImage.value) await loadImage(currentImage.value.fileId);
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
  if (e.key === "Escape") close();
  else if (e.key === "ArrowLeft") prev();
  else if (e.key === "ArrowRight") next();
}

async function download() {
  if (!currentSrc.value || !currentImage.value) return;
  const a = document.createElement("a");
  a.href = currentSrc.value;
  a.download = currentImage.value.fileName || "image";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

onBeforeUnmount(() => {
  srcCache.clear();
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

.lightbox-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
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
