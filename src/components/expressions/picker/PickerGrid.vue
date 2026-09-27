<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import PickerSection from "./PickerSection.vue";
import {
  activeSectionIndex,
  cellOffset,
  layoutGrid,
  visibleRowRange,
  type GridMetrics,
  type PickerCell,
  type PickerSectionData,
} from "./pickerModel";
import { useGridKeyboardNav, type GridPos } from "./useGridKeyboardNav";

/**
 * The picker's scroller: sections in normal flow with their heights reserved, sticky headers, only
 * the rows near the viewport mounted, the current section reported for the category bar, and a
 * roving focus over the cells. Pointer and key events are handled here once, for every cell.
 */
const props = defineProps<{
  sections: readonly PickerSectionData[];
  metrics: GridMetrics;
}>();

const emit = defineEmits<{
  select: [cell: PickerCell, el: HTMLElement];
  /** Right click, or a long press on touch. */
  context: [cell: PickerCell, el: HTMLElement, source: "mouse" | "touch"];
  /** The mouse over a cell, or null when it left the grid. */
  hover: [cell: PickerCell | null, el: HTMLElement | null];
  /** The finger lifted after a long press. */
  release: [];
  "active-change": [id: string | null];
  "type-ahead": [e: KeyboardEvent];
  scroll: [];
}>();

const PADDING_X = 8;
const OVERSCAN = 160;
const LONG_PRESS_MS = 400;
const LONG_PRESS_SLOP = 10;

const scroller = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewport = ref({ width: 0, height: 0 });

const layout = computed(() => layoutGrid(props.sections, Math.max(0, viewport.value.width - PADDING_X * 2), props.metrics));

const ranges = computed(() => {
  const top = scrollTop.value;
  const bottom = top + viewport.value.height;
  return layout.value.sections.map((s) => visibleRowRange(s, props.metrics, top, bottom, OVERSCAN));
});

// While a click on the category bar scrolls smoothly, the bar keeps showing where it is going.
const lockedId = ref<string | null>(null);
let unlockTimer: ReturnType<typeof setTimeout> | undefined;

const activeId = computed(() => {
  if (lockedId.value) return lockedId.value;
  const index = activeSectionIndex(layout.value, scrollTop.value, viewport.value.height);
  return index >= 0 ? (layout.value.sections[index]?.id ?? null) : null;
});

watch(activeId, (id) => emit("active-change", id), { immediate: true });

function cellAt(pos: GridPos): PickerCell | undefined {
  return props.sections[pos.section]?.cells[pos.index];
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
  counts: () => props.sections.map((s) => s.cells.length),
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

/** The one cell reachable with Tab: the focused one, else the first. */
const tabStop = computed<GridPos | null>(() => {
  const f = nav.focused.value;
  if (f && cellAt(f)) return f;
  const first = props.sections.findIndex((s) => s.cells.length > 0);
  return first >= 0 ? { section: first, index: 0 } : null;
});

watch(
  () => props.sections,
  () => {
    if (nav.focused.value && !cellAt(nav.focused.value)) nav.focused.value = null;
  },
);

// ── events ──

function onScroll() {
  const box = scroller.value;
  if (!box) return;
  scrollTop.value = box.scrollTop;
  emit("scroll");
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
  if (hit) nav.focused.value = hit.pos;
}

let suppressClick = false;
let pressTimer: ReturnType<typeof setTimeout> | undefined;
let pressStart: { x: number; y: number } | null = null;
let longPressed = false;

function cancelPress() {
  clearTimeout(pressTimer);
  pressTimer = undefined;
  pressStart = null;
}

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === "mouse") return;
  const hit = parsePos(e.target as Element);
  if (!hit) return;
  cancelPress();
  longPressed = false;
  pressStart = { x: e.clientX, y: e.clientY };
  pressTimer = setTimeout(() => {
    const cell = cellAt(hit.pos);
    pressTimer = undefined;
    if (!cell) return;
    longPressed = true;
    suppressClick = true;
    emit("context", cell, hit.el, "touch");
  }, LONG_PRESS_MS);
}

function onPointerMove(e: PointerEvent) {
  if (pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > LONG_PRESS_SLOP) cancelPress();
}

function onPointerUp() {
  cancelPress();
  if (longPressed) {
    longPressed = false;
    emit("release");
    // The click that follows the lift is the end of the long press, not a pick.
    setTimeout(() => (suppressClick = false), 400);
  }
}

// Only cells report: the gaps between them and the headers are passed over without a word, so a
// preview is not dropped and reopened on the way from one sticker to the next.
function onPointerOver(e: PointerEvent) {
  if (e.pointerType !== "mouse") return;
  const hit = parsePos(e.target as Element);
  const cell = hit ? cellAt(hit.pos) : undefined;
  if (hit && cell) emit("hover", cell, hit.el);
}

function onPointerLeave(e: PointerEvent) {
  if (e.pointerType === "mouse") emit("hover", null, null);
}

function onClick(e: MouseEvent) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (e.detail === 0 && performance.now() - keyboardPickAt < 500) return;
  const hit = parsePos(e.target as Element);
  const cell = hit ? cellAt(hit.pos) : undefined;
  if (!hit || !cell) return;
  nav.focused.value = hit.pos;
  emit("select", cell, hit.el);
}

function onContextMenu(e: MouseEvent) {
  const hit = parsePos(e.target as Element);
  const cell = hit ? cellAt(hit.pos) : undefined;
  if (!hit || !cell) return;
  e.preventDefault();
  // A touch long press already answered; the browser's own context menu follows it.
  if (longPressed || suppressClick) return;
  emit("context", cell, hit.el, "mouse");
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
  cancelPress();
  clearTimeout(unlockTimer);
});

// ── api ──

function scrollToSection(id: string, smooth = true) {
  const box = scroller.value;
  const section = layout.value.sections.find((s) => s.id === id);
  if (!box || !section) return;
  const max = Math.max(0, box.scrollHeight - box.clientHeight);
  const target = Math.min(section.top, max);
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

function focusFirst() {
  const stop = tabStop.value;
  if (stop) nav.focus(stop);
}

defineExpose({ scrollToSection, focusFirst, activeId, layout, scroller });
</script>

<template>
  <div
    ref="scroller"
    class="xp-grid"
    :style="{ paddingLeft: `${PADDING_X}px`, paddingRight: `${PADDING_X}px` }"
    @scroll.passive="onScroll"
    @scrollend="onScrollEnd"
    @keydown="onKeydown"
    @focusin="onFocusIn"
    @click="onClick"
    @contextmenu="onContextMenu"
    @pointerdown="onPointerDown"
    @pointermove.passive="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @pointerover="onPointerOver"
    @pointerleave="onPointerLeave"
  >
    <PickerSection
      v-for="(section, i) in sections"
      :key="section.id"
      :section="section"
      :layout="layout.sections[i]"
      :metrics="metrics"
      :columns="layout.columns"
      :gap-x="layout.gapX"
      :range="ranges[i]"
      :tab-stop="tabStop"
    />
    <slot name="footer" />
  </div>
</template>

<style scoped>
.xp-grid {
  position: relative;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
  outline: none;
}
</style>
