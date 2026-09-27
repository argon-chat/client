/**
 * Keyboard navigation over the picker grid (tweb's attachListNavigation `xy` mode, by model): arrows
 * move within and across sections keeping the column, edges hold, Enter/Space pick, typing goes to search.
 */

import { describe, test, expect, vi } from "vitest";
import { isTypingKey, moveGridPos, useGridKeyboardNav, type GridPos } from "@/components/expressions/picker/useGridKeyboardNav";

// Three sections, 4 columns: 6 cells (rows of 4 + 2), none, 9 cells (4 + 4 + 1).
const counts = [6, 0, 9];
const move = (pos: GridPos | null, key: Parameters<typeof moveGridPos>[3]) => moveGridPos(counts, 4, pos, key);

describe("moveGridPos", () => {
  test("left and right walk the cells in order, across sections, and stop at the ends", () => {
    expect(move({ section: 0, index: 2 }, "ArrowRight")).toEqual({ section: 0, index: 3 });
    expect(move({ section: 0, index: 5 }, "ArrowRight")).toEqual({ section: 2, index: 0 });
    expect(move({ section: 2, index: 0 }, "ArrowLeft")).toEqual({ section: 0, index: 5 });
    expect(move({ section: 0, index: 0 }, "ArrowLeft")).toEqual({ section: 0, index: 0 });
    expect(move({ section: 2, index: 8 }, "ArrowRight")).toEqual({ section: 2, index: 8 });
  });

  test("down keeps the column, lands on a shorter row's last cell, and crosses into the next section", () => {
    expect(move({ section: 0, index: 1 }, "ArrowDown")).toEqual({ section: 0, index: 5 });
    expect(move({ section: 0, index: 3 }, "ArrowDown")).toEqual({ section: 0, index: 5 });
    expect(move({ section: 0, index: 5 }, "ArrowDown")).toEqual({ section: 2, index: 1 });
    expect(move({ section: 2, index: 6 }, "ArrowDown")).toEqual({ section: 2, index: 8 });
    expect(move({ section: 2, index: 8 }, "ArrowDown")).toEqual({ section: 2, index: 8 });
  });

  test("up keeps the column and crosses into the previous section's last row", () => {
    expect(move({ section: 2, index: 5 }, "ArrowUp")).toEqual({ section: 2, index: 1 });
    expect(move({ section: 2, index: 1 }, "ArrowUp")).toEqual({ section: 0, index: 5 });
    expect(move({ section: 2, index: 0 }, "ArrowUp")).toEqual({ section: 0, index: 4 });
    expect(move({ section: 0, index: 2 }, "ArrowUp")).toEqual({ section: 0, index: 2 });
  });

  test("Home and End, and a start from nowhere", () => {
    expect(move({ section: 2, index: 4 }, "Home")).toEqual({ section: 0, index: 0 });
    expect(move({ section: 0, index: 0 }, "End")).toEqual({ section: 2, index: 8 });
    expect(move(null, "ArrowDown")).toEqual({ section: 0, index: 0 });
    expect(move({ section: 1, index: 0 }, "ArrowRight")).toEqual({ section: 0, index: 0 });
    expect(moveGridPos([0, 0], 4, null, "ArrowDown")).toBeNull();
  });
});

describe("useGridKeyboardNav", () => {
  function setup() {
    const reveal = vi.fn();
    const select = vi.fn();
    const typeAhead = vi.fn();
    const nav = useGridKeyboardNav({ counts: () => counts, columns: () => 4, reveal, select, typeAhead });
    const key = (key: string, from: GridPos | null = nav.focused.value, extra: Partial<KeyboardEventInit> = {}) => {
      const e = new KeyboardEvent("keydown", { key, cancelable: true, ...extra });
      nav.onKeydown(e, from);
      return e;
    };
    return { nav, reveal, select, typeAhead, key };
  }

  test("arrows move the focus and bring the cell into view", () => {
    const { nav, reveal, key } = setup();
    const e = key("ArrowRight", { section: 0, index: 0 });
    expect(e.defaultPrevented).toBe(true);
    expect(nav.focused.value).toEqual({ section: 0, index: 1 });
    expect(reveal).toHaveBeenLastCalledWith({ section: 0, index: 1 });
    key("ArrowDown");
    expect(nav.focused.value).toEqual({ section: 0, index: 5 });
  });

  test("Enter and Space pick the focused cell, once per press", () => {
    const { select, key } = setup();
    key("Enter", { section: 2, index: 3 });
    key(" ", { section: 2, index: 4 });
    key("Enter", { section: 2, index: 4 }, { repeat: true });
    expect(select.mock.calls).toEqual([[{ section: 2, index: 3 }], [{ section: 2, index: 4 }]]);
  });

  test("a printable key goes to the search field; shortcuts do not", () => {
    const { typeAhead, key } = setup();
    key("a", { section: 0, index: 0 });
    key("c", { section: 0, index: 0 }, { ctrlKey: true });
    key("Tab", { section: 0, index: 0 });
    expect(typeAhead).toHaveBeenCalledTimes(1);
    expect(isTypingKey({ key: "Я", ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isTypingKey({ key: " ", ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });
});
