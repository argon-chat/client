<template>
  <div class="image-grid" :class="gridClass">
    <template v-for="(img, i) in visibleImages" :key="i">
      <div class="grid-cell" :class="cellClass(i)">
        <AttachmentImage
          :file-id="img.fileId"
          :file-name="img.fileName"
          :width="img.width"
          :height="img.height"
          :thumb-hash="img.thumbHash"
        />
        <!-- "+N more" overlay on last visible cell -->
        <div v-if="i === visibleImages.length - 1 && overflowCount > 0" class="overflow-overlay">
          <span class="overflow-count">+{{ overflowCount }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { MessageEntityAttachment } from "@argon/glue";
import AttachmentImage from "./AttachmentImage.vue";

const props = defineProps<{
  images: MessageEntityAttachment[];
}>();

const MAX_VISIBLE = 4;

const visibleImages = computed(() => props.images.slice(0, MAX_VISIBLE));
const overflowCount = computed(() =>
  Math.max(0, props.images.length - MAX_VISIBLE),
);

const gridClass = computed(() => {
  const count = Math.min(props.images.length, MAX_VISIBLE);
  return `grid-${count}`;
});

function cellClass(index: number): string {
  const count = Math.min(props.images.length, MAX_VISIBLE);
  if (count === 3 && index === 0) return "cell-tall";
  return "";
}
</script>

<style scoped>
.image-grid {
  display: grid;
  gap: 2px;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
}

/* 1 image — single column, natural aspect ratio, max 340px tall */
.grid-1 {
  grid-template-columns: 1fr;
}

.grid-1 .grid-cell :deep(.attachment-image) {
  max-height: 340px;
}

/* 2 images — side by side, fixed ~200px tall */
.grid-2 {
  grid-template-columns: 1fr 1fr;
  height: 200px;
}

.grid-2 .grid-cell {
  height: 100%;
}

.grid-2 .grid-cell :deep(.attachment-image) {
  aspect-ratio: auto;
  height: 100%;
}

/* 3 images — left large + right column of 2 small */
.grid-3 {
  grid-template-columns: 2fr 1fr;
  grid-template-rows: 1fr 1fr;
  height: 300px;
}

.grid-3 .cell-tall {
  grid-row: 1 / -1;
}

.grid-3 .grid-cell {
  height: 100%;
}

.grid-3 .grid-cell :deep(.attachment-image) {
  aspect-ratio: auto;
  height: 100%;
}

/* 4+ images — 2×2 grid */
.grid-4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  height: 300px;
}

.grid-4 .grid-cell {
  height: 100%;
}

.grid-4 .grid-cell :deep(.attachment-image) {
  aspect-ratio: auto;
  height: 100%;
}

.grid-cell {
  position: relative;
  overflow: hidden;
}

.grid-cell :deep(.attachment-image) {
  max-width: none;
  width: 100%;
  border-radius: 0;
  min-height: 100%;
}

.overflow-overlay {
  position: absolute;
  inset: 0;
  background: hsl(0 0% 0% / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.overflow-count {
  font-size: 24px;
  font-weight: 600;
  color: white;
}
</style>
