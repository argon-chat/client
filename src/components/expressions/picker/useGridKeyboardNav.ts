import { ref, type Ref } from "vue";

// tweb's attachListNavigation in its `xy` mode, over the grid's model instead of its DOM: the picker
// mounts only the rows on screen, so the next cell is found by position, not by measuring elements.

export interface GridPos {
  section: number;
  index: number;
}

export type GridNavKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

const NAV_KEYS = new Set<string>(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

export const isGridNavKey = (key: string): key is GridNavKey => NAV_KEYS.has(key);

const nonEmpty = (counts: readonly number[], from: number, step: 1 | -1): number => {
  for (let s = from; s >= 0 && s < counts.length; s += step) if (counts[s] > 0) return s;
  return -1;
};

/**
 * The cell `key` moves to from `pos`, over sections of `counts` cells laid out `columns` wide.
 * Left/right walk the cells in order across sections; up/down keep the column, landing on the last
 * cell of a shorter row, and cross into the neighbouring section's nearest row. Edges hold.
 */
export function moveGridPos(counts: readonly number[], columns: number, pos: GridPos | null, key: GridNavKey): GridPos | null {
  const first = nonEmpty(counts, 0, 1);
  if (first < 0) return null;
  const last = nonEmpty(counts, counts.length - 1, -1);
  if (key === "Home") return { section: first, index: 0 };
  if (key === "End") return { section: last, index: counts[last] - 1 };
  if (!pos || pos.section < 0 || pos.section >= counts.length || pos.index < 0 || pos.index >= counts[pos.section]) {
    return { section: first, index: 0 };
  }

  const cols = Math.max(1, columns);
  const { section, index } = pos;
  const count = counts[section];

  switch (key) {
    case "ArrowRight": {
      if (index + 1 < count) return { section, index: index + 1 };
      const next = nonEmpty(counts, section + 1, 1);
      return next < 0 ? pos : { section: next, index: 0 };
    }
    case "ArrowLeft": {
      if (index > 0) return { section, index: index - 1 };
      const prev = nonEmpty(counts, section - 1, -1);
      return prev < 0 ? pos : { section: prev, index: counts[prev] - 1 };
    }
    case "ArrowDown": {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const rows = Math.ceil(count / cols);
      if (row + 1 < rows) return { section, index: Math.min(count - 1, (row + 1) * cols + col) };
      const next = nonEmpty(counts, section + 1, 1);
      return next < 0 ? pos : { section: next, index: Math.min(counts[next] - 1, col) };
    }
    case "ArrowUp": {
      const col = index % cols;
      const row = Math.floor(index / cols);
      if (row > 0) return { section, index: (row - 1) * cols + col };
      const prev = nonEmpty(counts, section - 1, -1);
      if (prev < 0) return pos;
      const prevLastRow = Math.ceil(counts[prev] / cols) - 1;
      return { section: prev, index: Math.min(counts[prev] - 1, prevLastRow * cols + col) };
    }
  }
}

/** A key that types into the search field: one printable character, no command modifier. */
export function isTypingKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  return e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;
}

export interface GridKeyboardNavOptions {
  counts: () => readonly number[];
  columns: () => number;
  /** Bring the cell on screen and focus it once it is rendered. */
  reveal: (pos: GridPos) => void;
  select: (pos: GridPos) => void;
  /** A printable key pressed in the grid: the search field takes over. */
  typeAhead?: (e: KeyboardEvent) => void;
}

/**
 * Roving focus for the picker grid: one cell is the tab stop; arrows, Home and End move it, Enter and
 * Space pick it, typing goes to the search field.
 */
export function useGridKeyboardNav(options: GridKeyboardNavOptions) {
  const focused: Ref<GridPos | null> = ref(null);

  function focus(pos: GridPos | null) {
    focused.value = pos;
    if (pos) options.reveal(pos);
  }

  function onKeydown(e: KeyboardEvent, from: GridPos | null) {
    if (e.defaultPrevented || e.isComposing) return;
    const current = from ?? focused.value;
    if (isGridNavKey(e.key)) {
      e.preventDefault();
      const next = moveGridPos(options.counts(), options.columns(), current, e.key);
      if (next) focus(next);
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && current) {
      e.preventDefault();
      if (!e.repeat) options.select(current);
      return;
    }
    if (isTypingKey(e)) options.typeAhead?.(e);
  }

  return { focused, focus, onKeydown };
}
