import type { CosmeticBoardCell } from "@/cosmetics/types";

/**
 * How tall somebody's board comes out, worked out rather than measured.
 *
 * <b>Here because two things need the same number and one of them may not measure for it.</b> The
 * board draws itself from these constants; a cosmetic that has to stop where the board starts needs
 * the same answer before anything is on screen. A ResizeObserver would give it a frame late, which
 * on a popover that opens under the cursor is a scene visibly jumping every time it appears.
 *
 * It can be arithmetic because the board is a grid with explicit rows and a fixed row height, and
 * nothing on it is compacted: the height is the lowest row anybody reached, gaps included. So this
 * needs no DOM, works in a test, and answers the same in the client and in the console's preview.
 */

/**
 * The gap between rows.
 *
 * Mirrors `.cosmetic-board`'s own `gap`, which is CSS and cannot read this. The two are a pair —
 * change one and change the other, or a scene stops a few pixels from where the board does.
 */
export const BOARD_GAP = 8;

/** What one row is drawn at when a host does not say otherwise. */
export const BOARD_ROW_HEIGHT = 28;

/**
 * The board's height in pixels, or zero when there is nothing on it.
 *
 * Zero is not "a board of no rows" but "no board": `CosmeticBoard` renders nothing at all when it is
 * empty, so there is no box and no gap above it either.
 */
export function boardHeight(
  cells: readonly CosmeticBoardCell[],
  rowHeight: number = BOARD_ROW_HEIGHT,
): number {
  let rows = 0;

  for (const cell of cells) {
    rows = Math.max(rows, cell.y + cell.h);
  }

  if (rows === 0) return 0;

  return rows * rowHeight + (rows - 1) * BOARD_GAP;
}
