<script setup lang="ts">
import "./pickerScroll.css";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { SkinTone } from "@argon-chat/emojix";
import PickerSection from "./PickerSection.vue";
import {
  activeGroupIndex,
  cellOffset,
  layoutGrid,
  visibleRowRange,
  type GridMetrics,
  type PickerCell,
  type PickerGroup,
} from "./pickerModel";
import { useGridKeyboardNav, type GridPos } from "./useGridKeyboardNav";
import { useHoldPreview, type HoldTarget } from "./useHoldPreview";

/**
 * The picker's scroller: groups in normal flow with their heights reserved, sticky group headers,
 * only the rows near the viewport mounted, the current group reported for the rail, and a roving
 * focus over the cells. Pointer and key events are handled here once, for every cell; a sticker held
 * down is previewed (see `useHoldPreview`).
 */
const props = defineProps<{
  groups: readonly PickerGroup[];
  metrics: GridMetrics;
  tone: SkinTone;
}>();

const emit = defineEmits<{
  select: [cell: PickerCell, el: HTMLElement];
  /** Right click, or a long press on touch. */
  context: [cell: PickerCell, el: HTMLElement, source: "mouse" | "touch"];
  /** The mouse over a cell, or null when it left the grid. */
  hover: [cell: PickerCell | null, el: HTMLElement | null];
  /** A cell took the keyboard focus. */
  focus: [cell: PickerCell];
  /** The sticker held down; null when the hold ends. */
  preview: [cell: PickerCell | null];
  "active-change": [id: string | null];
  "type-ahead": [e: KeyboardEvent];
}>();

const PADDING_X = 8;
const OVERSCAN = 160;

const scroller = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewport = ref({ width: 0, height: 0 });

const sections = computed(() => props.groups.flatMap((g) => g.sections));

const layout = computed(() => layoutGrid(props.groups, Math.max(0, viewport.value.width - PADDING_X * 2), props.metrics));

// Nothing is mounted before the width is known: rows laid out one column wide would all remount.
const ranges = computed(() => {
  const top = scrollTop.value;
  const bottom = top + viewport.value.height;
  const measured = viewport.value.width > 0;
  return layout.value.sections.map((s): [number, number] => (measured ? visibleRowRange(s, props.metrics, top, bottom, OVERSCAN) : [0, 0]));
});

// While a click on the rail scrolls smoothly, the rail keeps showing where it is going.
const lockedId = ref<string | null>(null);
let unlockTimer: ReturnType<typeof setTimeout> | undefined;
// A section opened from outside keeps its group current until the user scrolls away, even where the
// scroll stops short of it (the end of the content).
const pinnedId = ref<string | null>(null);
let pinnedTop = 0;

const activeId = computed(() => {
  if (lockedId.value) return lockedId.value;
  if (pinnedId.value) return pinnedId.value;
  const index = activeGroupIndex(layout.value, scrollTop.value, viewport.value.height);
  return index >= 0 ? (layout.value.groups[index]?.id ?? null) : null;
});

watch(activeId, (id) => emit("active-change", id), { immediate: true });

function cellAt(pos: GridPos): PickerCell | undefined {
  return sections.value[pos.section]?.cells[pos.index];
}

function parsePos(el: Element | null): { pos: GridPos; el: HTMLElement } | null {
  const target = el?.closest<HTMLElement>("[data-cell]");
  if (!target || !scroller.value?.contains(target)) return null;
  const [section, index] = (target.dataset.cell ?? "").split(":").map(Number);
  return Number.isInteger(section) && Number.isInteger(index) ? { pos: { section, index }, el: target } : null;
}

const cellElement = (pos: GridPos) =>
  scroller.value?.querySelector<HTMLElement>(`[data-cell="${pos.section}:${pos.index}"]`) ?? null;

/** Scrolls just enough for the cell to clear the sticky header and the bottom edge. */
function reveal(pos: GridPos) {
  const box = scroller.value;
  if (!box || !layout.value.sections[pos.section]) return;
  const { top, bottom } = cellOffset(layout.value, pos.section, pos.index);
  const header = props.metrics.header;
  let next = box.scrollTop;
  if (top - header < next) next = Math.max(0, top - header - 4);
  else if (bottom > next + box.clientHeight) next = bottom - box.clientHeight + 4;
  if (next !== box.scrollTop) {
    box.scrollTop = next;
    scrollTop.value = box.scrollTop;
  }
  void nextTick(() => cellElement(pos)?.focus({ preventScroll: true }));
}

// A button also clicks itself on Enter or Space; that click is the same pick, already made.
let keyboardPickAt = -Infinity;

const nav = useGridKeyboardNav({
  counts: () => sections.value.map((s) => s.cells.length),
  columns: () => layout.value.columns,
  reveal,
  select: (pos) => {
    const cell = cellAt(pos);
    const el = cellElement(pos);
    if (!cell || !el) return;
    keyboardPickAt = performance.now();
    emit("select", cell, el);
  },
  typeAhead: (e) => emit("type-ahead", e),
});

function isMounted(pos: GridPos): boolean {
  const range = ranges.value[pos.section];
  const row = Math.floor(pos.index / layout.value.columns);
  return !!range && row >= range[0] && row < range[1];
}

/** The first cell on screen, under the sticky header. */
const firstVisible = computed<GridPos | null>(() => {
  const top = scrollTop.value + props.metrics.header;
  const bottom = scrollTop.value + viewport.value.height;
  for (const s of layout.value.sections) {
    const [first, end] = visibleRowRange(s, props.metrics, top, bottom);
    if (first < end) return { section: s.index, index: first * layout.value.columns };
  }
  const any = sections.value.findIndex((s) => s.cells.length > 0);
  return any >= 0 ? { section: any, index: 0 } : null;
});

/** The one cell reachable with Tab: the focused one while it is mounted, else the first on screen. */
const tabStop = computed<GridPos | null>(() => {
  const f = nav.focused.value;
  if (f && cellAt(f) && isMounted(f)) return f;
  return firstVisible.value;
});

watch(sections, () => {
  if (nav.focused.value && !cellAt(nav.focused.value)) nav.focused.value = null;
});

// ── events ──

function onScroll() {
  const box = scroller.value;
  if (!box) return;
  scrollTop.value = box.scrollTop;
  if (pinnedId.value && Math.abs(box.scrollTop - pinnedTop) >= 1) pinnedId.value = null;
  hold.onScroll();
}

function onScrollEnd() {
  if (!lockedId.value) return;
  clearTimeout(unlockTimer);
  lockedId.value = null;
}

function onKeydown(e: KeyboardEvent) {
  nav.onKeydown(e, parsePos(e.target as Element)?.pos ?? null);
}

function onFocusIn(e: FocusEvent) {
  const hit = parsePos(e.target as Element);
  if (!hit) return;
  nav.focused.value = hit.pos;
  const cell = cellAt(hit.pos);
  if (cell) emit("focus", cell);
}

function hitCell(el: Element | null): HoldTarget | null {
  const hit = parsePos(el);
  const cell = hit ? cellAt(hit.pos) : undefined;
  return hit && cell ? { cell, el: hit.el } : null;
}

const hold = useHoldPreview({
  hit: hitCell,
  preview: (cell) => emit("preview", cell),
  longPress: ({ cell, el }) => emit("context", cell, el, "touch"),
});

// Only cells report: the gaps between them and the headers are passed over without a word.
function onPointerOver(e: PointerEvent) {
  if (e.pointerType !== "mouse") return;
  const hit = hitCell(e.target as Element);
  if (hit) emit("hover", hit.cell, hit.el);
}

function onPointerLeave(e: PointerEvent) {
  if (e.pointerType === "mouse") emit("hover", null, null);
}

function onClick(e: MouseEvent) {
  if (e.detail === 0 && performance.now() - keyboardPickAt < 500) return;
  const hit = parsePos(e.target as Element);
  const cell = hit ? cellAt(hit.pos) : undefined;
  if (!hit || !cell) return;
  nav.focused.value = hit.pos;
  emit("select", cell, hit.el);
}

function onContextMenu(e: MouseEvent) {
  const hit = hitCell(e.target as Element);
  if (!hit) return;
  e.preventDefault();
  // A finger's long press answers for itself; the browser's own menu follows it.
  if (hold.touching()) return;
  emit("context", hit.cell, hit.el, "mouse");
}

// ── size ──

let observer: ResizeObserver | null = null;

function measure() {
  const box = scroller.value;
  if (!box) return;
  viewport.value = { width: box.clientWidth, height: box.clientHeight };
}

onMounted(() => {
  measure();
  const box = scroller.value;
  if (box && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(measure);
    observer.observe(box);
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  hold.dispose();
  clearTimeout(unlockTimer);
});

// ── api ──

function scrollToGroup(id: string, smooth = true) {
  const box = scroller.value;
  const group = layout.value.groups.find((g) => g.id === id);
  if (!box || !group) return;
  pinnedId.value = null;
  const max = Math.max(0, box.scrollHeight - box.clientHeight);
  const target = Math.min(group.top, max);
  if (Math.abs(box.scrollTop - target) < 1) return;
  if (smooth) {
    lockedId.value = id;
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(onScrollEnd, 1000);
    box.scrollTo({ top: target, behavior: "smooth" });
  } else {
    box.scrollTop = target;
    scrollTop.value = box.scrollTop;
  }
}

/**
 * Jumps to a section: its sub-header just under its group's sticky header (the group's top for the
 * first one), its group current in the rail. False when there is no such section.
 */
function scrollToSection(id: string): boolean {
  const box = scroller.value;
  const section = layout.value.sections.find((s) => s.id === id);
  const group = section ? layout.value.groups[section.group] : undefined;
  if (!box || !section || !group) return false;
  const top = group.sections[0] === section.index ? group.top : section.top - props.metrics.header;
  box.scrollTop = Math.min(top, Math.max(0, box.scrollHeight - box.clientHeight));
  scrollTop.value = pinnedTop = box.scrollTop;
  pinnedId.value = group.id;
  return true;
}

function focusFirst() {
  const stop = tabStop.value;
  if (stop) nav.focus(stop);
}

defineExpose({ scrollToGroup, scrollToSection, focusFirst, activeId, layout, scroller });
</script>

<template>
  <div
    ref="scroller"
    class="xp-grid xp-scroll"
    :style="{ paddingLeft: `${PADDING_X}px`, paddingRight: `${PADDING_X}px` }"
    @scroll.passive="onScroll"
    @scrollend="onScrollEnd"
    @keydown="onKeydown"
    @focusin="onFocusIn"
    @click="onClick"
    @contextmenu="onContextMenu"
    @mousedown="hold.onMouseDown"
    @touchstart.passive="hold.onTouchStart"
    @touchmove="hold.onTouchMove"
    @touchend="hold.onTouchEnd"
    @touchcancel="hold.onTouchCancel"
    @pointerover="onPointerOver"
    @pointerleave="onPointerLeave"
  >
    <section
      v-for="(group, g) in groups"
      :key="group.id"
      class="xp-group"
      :style="{ height: `${layout.groups[g]?.height ?? 0}px` }"
      :data-group-id="group.id"
      :aria-label="group.title"
    >
      <div class="xp-group__title" :style="{ height: `${metrics.header}px` }">
        <span class="truncate">{{ group.title }}</span>
      </div>
      <PickerSection
        v-for="index in layout.groups[g]?.sections ?? []"
        :key="sections[index].id"
        :section="sections[index]"
        :layout="layout.sections[index]"
        :metrics="metrics"
        :columns="layout.columns"
        :gap-x="layout.gapX"
        :range="ranges[index]"
        :tab-stop="tabStop"
        :tone="tone"
      />
    </section>
  </div>
</template>

<style scoped>
.xp-grid {
  position: relative;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  outline: none;
}

.xp-group {
  position: relative;
}

.xp-group__title {
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
</style>
