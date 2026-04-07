<template>
  <!-- Single image: Telegram-style adaptive container, no cropping -->
  <div
    v-if="isSingle"
    class="single-image-wrapper"
    :style="singleImageStyle"
    @click="emit('open-lightbox', 0)"
  >
    <AttachmentImage
      :file-id="images[0].fileId"
      :file-name="images[0].fileName"
      :width="images[0].width"
      :height="images[0].height"
      :thumb-hash="images[0].thumbHash"
    />
  </div>

  <!-- Multi-image grid -->
  <div v-else class="image-grid">
    <div
      v-for="(row, ri) in rows"
      :key="ri"
      class="grid-row"
      :style="{ height: rowHeight + 'px' }"
    >
      <div
        v-for="(img, ci) in row"
        :key="ci"
        class="grid-cell"
        :style="{ flex: cellFlex(img) }"
        @click="emit('open-lightbox', flatIndex(ri, ci))"
      >
        <AttachmentImage
          :file-id="img.fileId"
          :file-name="img.fileName"
          :width="img.width"
          :height="img.height"
          :thumb-hash="img.thumbHash"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { MessageEntityAttachment } from "@argon/glue";
import AttachmentImage from "./AttachmentImage.vue";

const props = defineProps<{
  images: MessageEntityAttachment[];
}>();

const emit = defineEmits<{
  (e: "open-lightbox", index: number): void;
}>();

const isSingle = computed(() => props.images.length === 1);

// ─── Single image: Telegram-style sizing ───
// Container adapts to the image's natural aspect ratio, constrained by max bounds.
const MAX_SINGLE_HEIGHT = 550;

const singleImageStyle = computed(() => {
  if (!isSingle.value) return {} as Record<string, string>;
  const img = props.images[0];
  const natW = img.width || 300;
  const natH = img.height || 200;
  const ar = natW / natH;

  // Compute width so that height stays within MAX_SINGLE_HEIGHT.
  // Parent already constrains horizontal size (80 % of chat via max-width),
  // so we only need to handle the height overflow here.
  let w = natW;
  let h = w / ar;

  if (h > MAX_SINGLE_HEIGHT) {
    h = MAX_SINGLE_HEIGHT;
    w = h * ar;
  }

  return {
    width: Math.round(w) + 'px',
    maxWidth: '100%',
    aspectRatio: `${natW} / ${natH}`,
    maxHeight: MAX_SINGLE_HEIGHT + 'px',
  };
});

/* ─── Multi-image grid ───
 * Split images into rows.
 * Strategy: distribute N images into rows of 2-3 to keep cells roughly square.
 * 1 → [1], 2 → [2], 3 → [3], 4 → [2,2], 5 → [3,2], 6 → [3,3],
 * 7 → [3,2,2], 8 → [3,3,2], 9 → [3,3,3], 10 → [3,3,4]
 */
function layoutRows(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [1];
  if (n === 2) return [2];
  if (n === 3) return [3];
  if (n === 4) return [2, 2];

  // For 5+: fill rows of 3, handle remainder
  const result: number[] = [];
  let remaining = n;
  while (remaining > 0) {
    if (remaining === 2) { result.push(2); remaining = 0; }
    else if (remaining === 4) { result.push(2, 2); remaining = 0; }
    else { result.push(Math.min(3, remaining)); remaining -= Math.min(3, remaining); }
  }
  return result;
}

const rowLayout = computed(() => layoutRows(props.images.length));

const rows = computed(() => {
  const result: MessageEntityAttachment[][] = [];
  let offset = 0;
  for (const count of rowLayout.value) {
    result.push(props.images.slice(offset, offset + count));
    offset += count;
  }
  return result;
});

const ROW_HEIGHT_SINGLE = 300;
const ROW_HEIGHT_DEFAULT = 160;
const ROW_HEIGHT_MANY = 120;

const rowHeight = computed(() => {
  const n = props.images.length;
  if (n === 1) return ROW_HEIGHT_SINGLE;
  if (n <= 4) return ROW_HEIGHT_DEFAULT;
  return ROW_HEIGHT_MANY;
});

function cellFlex(img: MessageEntityAttachment): string {
  const w = img.width ?? 1;
  const h = img.height ?? 1;
  // Use aspect ratio as flex basis so wider images take more space
  return `${Math.max(0.5, Math.min(3, w / h))} 1 0%`;
}

function flatIndex(rowIndex: number, colIndex: number): number {
  let idx = 0;
  for (let r = 0; r < rowIndex; r++) {
    idx += rows.value[r].length;
  }
  return idx + colIndex;
}
</script>

<style scoped>
/* ─── Single image: adaptive, no crop ─── */
.single-image-wrapper {
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  position: relative;
}

.single-image-wrapper:hover::after {
  content: "";
  position: absolute;
  inset: 0;
  background: hsl(0 0% 100% / 0.08);
  pointer-events: none;
  z-index: 1;
}

.single-image-wrapper :deep(.attachment-image) {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  border-radius: 0;
  min-height: auto;
}

.single-image-wrapper :deep(.actual-image) {
  object-fit: contain;
}

/* ─── Multi-image grid ─── */
.image-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  max-width: calc(var(--chat-width, 600px) * 0.8);
  border-radius: 8px;
  overflow: hidden;
}

.grid-row {
  display: flex;
  gap: 2px;
}

.grid-cell {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  min-width: 0;
}

.grid-cell:hover::after {
  content: "";
  position: absolute;
  inset: 0;
  background: hsl(0 0% 100% / 0.08);
  pointer-events: none;
}

.grid-cell :deep(.attachment-image) {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  border-radius: 0;
  min-height: 100%;
}
</style>
