<template>
  <!-- Single image: explicit pixel dimensions, no layout shift -->
  <div
    v-if="isSingle"
    class="single-image-wrapper"
    :style="singleDims"
    @click="emit('open-lightbox', 0)"
  >
    <AttachmentImage
      :file-id="images[0].fileId"
      :file-name="images[0].fileName"
      :width="images[0].width"
      :height="images[0].height"
      :thumb-hash="images[0].thumbHash"
      :download-url="images[0].downloadUrl"
    />
  </div>

  <!-- Multi-image grid: rows with fixed height, cells with explicit width -->
  <div v-else class="image-grid" :style="{ width: gridWidth + 'px', maxWidth: '100%' }">
    <div
      v-for="(row, ri) in gridLayout"
      :key="ri"
      class="grid-row"
      :style="{ height: row.height + 'px' }"
    >
      <div
        v-for="(cell, ci) in row.cells"
        :key="ci"
        class="grid-cell"
        :style="{ width: cell.w + 'px' }"
        @click="emit('open-lightbox', cell.flatIdx)"
      >
        <AttachmentImage
          :file-id="cell.img.fileId"
          :file-name="cell.img.fileName"
          :width="cell.img.width"
          :height="cell.img.height"
          :thumb-hash="cell.img.thumbHash"
          :download-url="cell.img.downloadUrl"
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

// ─── Sizing constants (inspired by Telegram Desktop's setAttachmentSize) ───
const MAX_WIDTH = 420;
const MAX_HEIGHT = 550;
const MIN_WIDTH = 120;
const GAP = 2;

const isSingle = computed(() => props.images.length === 1);

// ─── Single image: fit into bounding box, explicit px dims ───

function fitInBox(imgW: number, imgH: number, boxW: number, boxH: number) {
  if (imgW <= boxW && imgH <= boxH) return { w: imgW, h: imgH };
  const scale = Math.min(boxW / imgW, boxH / imgH);
  return { w: Math.round(imgW * scale), h: Math.round(imgH * scale) };
}

const singleDims = computed(() => {
  const img = props.images[0];
  const natW = img.width || 300;
  const natH = img.height || 200;
  const { w, h } = fitInBox(natW, natH, MAX_WIDTH, MAX_HEIGHT);
  return {
    width: w + 'px',
    height: h + 'px',
    maxWidth: '100%',
  };
});

// ─── Multi-image grid: explicit geometry ───
// Each row has a fixed height; cells split the row width proportionally by aspect ratio.

const GRID_MAX_W = MAX_WIDTH;
const ROW_H_2_4 = 160;
const ROW_H_5_PLUS = 120;

interface GridCell {
  img: MessageEntityAttachment;
  w: number;
  flatIdx: number;
}
interface GridRow {
  height: number;
  cells: GridCell[];
}

function distributeToRows(n: number): number[] {
  if (n <= 0) return [];
  if (n <= 3) return [n];
  if (n === 4) return [2, 2];
  const rows: number[] = [];
  let rem = n;
  while (rem > 0) {
    if (rem === 2) { rows.push(2); rem = 0; }
    else if (rem === 4) { rows.push(2, 2); rem = 0; }
    else { rows.push(Math.min(3, rem)); rem -= Math.min(3, rem); }
  }
  return rows;
}

const gridWidth = computed(() => GRID_MAX_W);

const gridLayout = computed((): GridRow[] => {
  const imgs = props.images;
  const n = imgs.length;
  const rowCounts = distributeToRows(n);
  const rowH = n <= 4 ? ROW_H_2_4 : ROW_H_5_PLUS;

  const result: GridRow[] = [];
  let offset = 0;

  for (const count of rowCounts) {
    const rowImgs = imgs.slice(offset, offset + count);
    const totalGap = GAP * (count - 1);
    const available = GRID_MAX_W - totalGap;

    // Compute aspect ratios; use ratio to divide available width
    const ratios = rowImgs.map((img) => {
      const w = img.width ?? 1;
      const h = img.height ?? 1;
      return Math.max(0.5, Math.min(3, w / h));
    });
    const sumRatios = ratios.reduce((s, r) => s + r, 0);

    const cells: GridCell[] = rowImgs.map((img, ci) => ({
      img,
      w: Math.round((ratios[ci] / sumRatios) * available),
      flatIdx: offset + ci,
    }));

    result.push({ height: rowH, cells });
    offset += count;
  }

  return result;
});
</script>

<style scoped>
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
  border-radius: 0;
  min-height: 0;
}

.single-image-wrapper :deep(.actual-image) {
  object-fit: contain;
}

/* ─── Grid ─── */
.image-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  flex-shrink: 0;
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
  border-radius: 0;
  min-height: 0;
}

.grid-cell :deep(.actual-image) {
  object-fit: cover;
}
</style>
