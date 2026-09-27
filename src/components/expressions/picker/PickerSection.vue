<script setup lang="ts">
import { computed } from "vue";
import { spriteResolver } from "@argon-chat/emojix";
import StickerView from "@/components/expressions/StickerView.vue";
import CustomEmojiInline from "@/components/expressions/CustomEmojiInline.vue";
import CustomEmojiOverlay from "@/components/expressions/CustomEmojiOverlay.vue";
import { toMedia } from "@/store/data/expressionsStore";
import { rowPitch, type GridMetrics, type PickerCell, type PickerSectionData, type SectionLayout } from "./pickerModel";
import type { GridPos } from "./useGridKeyboardNav";

/**
 * One section of the picker grid. Its height is reserved up front (header + rows); only the rows in
 * `range` are mounted, each absolutely placed at its own offset, so scrolling never moves the layout.
 */
const props = defineProps<{
  section: PickerSectionData;
  layout: SectionLayout;
  metrics: GridMetrics;
  columns: number;
  gapX: number;
  /** Mounted rows, [first, end). */
  range: readonly [number, number];
  tabStop: GridPos | null;
}>();

const UNICODE_SIZE = 34;
const CUSTOM_EMOJI_SIZE = 36;
const STICKER_SIZE = 64;

const rows = computed(() => {
  const out: number[] = [];
  for (let r = props.range[0]; r < props.range[1]; r++) out.push(r);
  return out;
});

const cellsOf = (row: number) => props.section.cells.slice(row * props.columns, (row + 1) * props.columns);
const rowHasCustom = (row: number) => cellsOf(row).some((c) => c.type === "custom");

const rowStyle = (row: number) => ({
  top: `${row * rowPitch(props.metrics)}px`,
  height: `${props.metrics.cell}px`,
  columnGap: `${props.gapX}px`,
});

const cellStyle = computed(() => ({ width: `${props.metrics.cell}px`, height: `${props.metrics.cell}px` }));
const itemsHeight = computed(() => props.layout.height - props.metrics.header - props.metrics.sectionGap);

function isTabStop(index: number): boolean {
  const stop = props.tabStop;
  return !!stop && stop.section === props.layout.index && stop.index === index;
}

function labelOf(cell: PickerCell): string {
  if (cell.type === "unicode") return cell.entry.name;
  if (cell.type === "custom") return `:${cell.item.name}:`;
  return [cell.item.name, ...cell.item.emoji].join(" ");
}

const spriteStyle = (cell: PickerCell) =>
  cell.type === "unicode" ? (spriteResolver.getStyle(cell.entry, UNICODE_SIZE) ?? undefined) : undefined;
</script>

<template>
  <section
    class="xp-section"
    :style="{ height: `${layout.height}px` }"
    :data-section-id="section.id"
    :aria-label="section.title"
  >
    <div class="xp-section__title" :style="{ height: `${metrics.header}px` }">
      <span class="truncate">{{ section.title }}</span>
    </div>
    <div class="xp-section__items" :style="{ height: `${itemsHeight}px` }">
      <component
        :is="rowHasCustom(row) ? CustomEmojiOverlay : 'div'"
        v-for="row in rows"
        :key="row"
        v-bind="rowHasCustom(row) ? { group: 'picker' } : {}"
        class="xp-row"
        :style="rowStyle(row)"
      >
        <button
          v-for="(cell, i) in cellsOf(row)"
          :key="cell.key"
          type="button"
          class="xp-cell"
          :class="`xp-cell--${cell.type}`"
          :style="cellStyle"
          :data-cell="`${layout.index}:${row * columns + i}`"
          :tabindex="isTabStop(row * columns + i) ? 0 : -1"
          :aria-label="labelOf(cell)"
          :title="cell.type === 'sticker' ? undefined : labelOf(cell)"
        >
          <span
            v-if="cell.type === 'unicode'"
            class="xp-sprite"
            :style="spriteStyle(cell)"
            aria-hidden="true"
          />
          <CustomEmojiInline
            v-else-if="cell.type === 'custom'"
            :media="toMedia(cell.item)"
            :size="CUSTOM_EMOJI_SIZE"
            :alt="`:${cell.item.name}:`"
          />
          <StickerView v-else :media="toMedia(cell.item)" :size="STICKER_SIZE" group="picker" />
        </button>
      </component>
    </div>
  </section>
</template>

<style scoped>
.xp-section {
  position: relative;
}

.xp-section__title {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  padding: 0 4px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--popover));
}

.xp-section__items {
  position: relative;
}

.xp-row {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
}

.xp-cell {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: calc(var(--radius) - 2px);
  color: hsl(var(--foreground));
  transition: background-color 0.1s ease;
  cursor: pointer;
  -webkit-touch-callout: none;
  user-select: none;
}

.xp-cell:hover {
  background: hsl(var(--accent) / 0.7);
}

.xp-cell:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: -2px;
  background: hsl(var(--accent) / 0.7);
}

.xp-cell--sticker:active,
.xp-cell--unicode:active,
.xp-cell--custom:active {
  transform: scale(0.94);
}

.xp-sprite {
  display: block;
  width: 34px;
  height: 34px;
  background-repeat: no-repeat;
  pointer-events: none;
}

.xp-cell :deep(.sticker-view),
.xp-cell :deep(.ce) {
  pointer-events: none;
}
</style>
