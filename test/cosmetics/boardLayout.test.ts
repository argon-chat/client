/**
 * How tall somebody's board comes out.
 *
 * What these guard: this number is the line a whole-card cosmetic stops at when its wearer asked it
 * to leave the board alone, and it is worked out rather than measured — so nothing on screen will
 * ever disagree with it loudly. A gap counted after the last row, or a card's own row ignored in
 * favour of the last one listed, is a scene that stops a few pixels off the mark on exactly the
 * profiles that have a board, which is the hardest kind of wrong to notice.
 */

import { describe, expect, test } from "vitest";
import { boardHeight, BOARD_GAP, BOARD_ROW_HEIGHT } from "@/cosmetics/boardLayout";
import type { CosmeticBoardCell } from "@/cosmetics/types";

const cell = (y: number, h: number): CosmeticBoardCell => ({ x: 0, y, w: 1, h });

describe("boardHeight", () => {
  test("is nothing at all when nothing is on the board", () => {
    expect(boardHeight([])).toBe(0);
  });

  test("is one row for a single one-row card", () => {
    expect(boardHeight([cell(0, 1)])).toBe(BOARD_ROW_HEIGHT);
  });

  test("counts the gaps between rows and not one after the last", () => {
    expect(boardHeight([cell(0, 2)])).toBe(BOARD_ROW_HEIGHT * 2 + BOARD_GAP);
  });

  test("measures to the lowest row reached, empty rows above it included", () => {
    // Nothing is compacted on this board, so a gap somebody left is part of the layout and part of
    // the height. A card dragged to row four makes the card four rows tall whatever is above it.
    expect(boardHeight([cell(3, 1)])).toBe(BOARD_ROW_HEIGHT * 4 + BOARD_GAP * 3);
  });

  test("takes the lowest of several rather than the last one listed", () => {
    expect(boardHeight([cell(2, 1), cell(0, 1)])).toBe(BOARD_ROW_HEIGHT * 3 + BOARD_GAP * 2);
  });

  test("counts a tall card's own rows", () => {
    expect(boardHeight([cell(1, 3)])).toBe(BOARD_ROW_HEIGHT * 4 + BOARD_GAP * 3);
  });

  test("takes the row height a host draws at instead of the default", () => {
    expect(boardHeight([cell(0, 2)], 40)).toBe(40 * 2 + BOARD_GAP);
  });
});
