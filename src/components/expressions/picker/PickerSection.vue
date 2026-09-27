<script setup lang="ts">
import { computed } from "vue";
import { emojiRegistry, spriteResolver, type SkinTone } from "@argon-chat/emojix";
import StickerView from "@/components/expressions/StickerView.vue";
import CustomEmojiInline from "@/components/expressions/CustomEmojiInline.vue";
import CustomEmojiOverlay from "@/components/expressions/CustomEmojiOverlay.vue";
import { pickerMedia } from "./pickerMedia";
import {
  EMOJI_ART,
  rowPitch,
  rowsHeight,
  STICKER_ART,
  tonedEntry,
  type GridMetrics,
  type PickerCell,
  type PickerSection,
  type SectionLayout,
} from "./pickerModel";
import type { GridPos } from "./useGridKeyboardNav";

/**
 * One section of a picker group: a pack's sub-header when it has one, then its rows. Its height is
 * reserved up front; only the rows in `range` are mounted, each absolutely placed at its own offset,
 * so scrolling never moves the layout.
 */
const props = defineProps<{
  section: PickerSection;
  layout: SectionLayout;
  metrics: GridMetrics;
  columns: number;
  gapX: number;
  /** Mounted rows, [first, end). */
  range: readonly [number, number];
  tabStop: GridPos | null;
  tone: SkinTone;
}>();

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
const itemsHeight = computed(() => rowsHeight(props.layout.rows, props.metrics));

function isTabStop(index: number): boolean {
  const stop = props.tabStop;
  return !!stop && stop.section === props.layout.index && stop.index === index;
}

function labelOf(cell: PickerCell): string {
  if (cell.type === "unicode") return cell.entry.name;
  if (cell.type === "custom") return `:${cell.item.name}:`;
  return [cell.item.name, ...cell.item.emoji].join(" ");
}

const byText = (text: string) => emojiRegistry.getByText(text);

const spriteStyle = (cell: PickerCell) =>
  cell.type === "unicode" ? (spriteResolver.getStyle(tonedEntry(cell.entry, props.tone, byText), EMOJI_ART) ?? undefined) : undefined;
</script>

<template>
  <div class="xp-section" :style="{ height: `${layout.height}px` }" :data-section-id="section.id">
    <div v-if="section.title" class="xp-section__title" :style="{ height: `${metrics.subheader}px` }">
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
        >
          <span v-if="cell.type === 'unicode'" class="xp-sprite" :style="spriteStyle(cell)" aria-hidden="true" />
          <CustomEmojiInline
            v-else-if="cell.type === 'custom'"
            :media="pickerMedia(cell.item)"
            :size="EMOJI_ART"
            :alt="`:${cell.item.name}:`"
          />
          <StickerView v-else :media="pickerMedia(cell.item)" :size="STICKER_ART" group="picker" />
        </button>
      </component>
    </div>
  </div>
</template>

<style scoped>
.xp-section {
  position: relative;
}

.xp-section__title {
  display: flex;
  align-items: flex-end;
  padding: 0 4px 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: hsl(var(--muted-foreground) / 0.85);
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

.xp-cell:active {
  transform: scale(0.94);
}

.xp-sprite {
  display: block;
  width: 32px;
  height: 32px;
  background-repeat: no-repeat;
  pointer-events: none;
}

.xp-cell :deep(.sticker-view),
.xp-cell :deep(.ce) {
  pointer-events: none;
}
</style>
