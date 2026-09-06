/**
 * Tile sizing.
 *
 * The regression these guard: the main tile once carried a CSS `aspect-ratio` derived
 * from the incoming picture while its pixel dimensions came from the solver. That is
 * fine while the container is measured, but on a layout switch or a fullscreen
 * transition the solver reports zero, the dimensions drop out, and a lone aspect-ratio
 * on a `flex: 0 0 auto` item grows the tile straight off the screen.
 */

import { describe, test, expect } from "vitest";
import { ref } from "vue";
import { solveGrid, tileStyle, useResponsiveGrid } from "@/composables/useResponsiveGrid";

describe("solveGrid", () => {
  test("fits every tile inside the container", () => {
    const width = 1200;
    const height = 700;
    const count = 5;
    const gap = 16;

    const g = solveGrid(width, height, count, 16 / 9, gap);

    expect(g.tileWidth).toBeGreaterThan(0);
    expect(g.cols * g.tileWidth + gap * (g.cols - 1)).toBeLessThanOrEqual(width + 0.001);
    expect(g.rows * g.tileHeight + gap * (g.rows - 1)).toBeLessThanOrEqual(height + 0.001);
  });

  test("honours the requested ratio", () => {
    for (const ratio of [16 / 9, 21 / 9, 9 / 16, 16 / 10]) {
      const g = solveGrid(1600, 900, 1, ratio, 0);
      expect(g.tileWidth / g.tileHeight).toBeCloseTo(ratio, 5);
    }
  });

  test("an ultrawide tile still fits a normal container", () => {
    const g = solveGrid(1000, 800, 1, 32 / 9, 0);
    expect(g.tileWidth).toBeLessThanOrEqual(1000);
    expect(g.tileHeight).toBeLessThanOrEqual(800);
  });

  test("reports zero rather than guessing when unmeasured", () => {
    for (const [w, h] of [[0, 0], [1200, 0], [0, 700], [Number.NaN, 700], [Number.POSITIVE_INFINITY, 700]]) {
      const g = solveGrid(w, h, 4);
      expect(g.tileWidth).toBe(0);
      expect(g.tileHeight).toBe(0);
    }
  });
});

describe("tileStyle", () => {
  test("emits dimensions and ratio together", () => {
    const s = tileStyle({ tileWidth: 640, tileHeight: 360 }, 16 / 9);
    expect(s.width).toBe("640px");
    expect(s.height).toBe("360px");
    expect(s.aspectRatio).toBe(String(16 / 9));
  });

  test("never emits aspect-ratio without dimensions to bound it", () => {
    const unmeasured = [
      { tileWidth: 0, tileHeight: 0 },
      { tileWidth: 0, tileHeight: 360 },
      { tileWidth: 640, tileHeight: 0 },
    ];

    for (const g of unmeasured) {
      const s = tileStyle(g, 21 / 9);
      expect(s.aspectRatio).toBeUndefined();
      expect(s.width).toBeUndefined();
      expect(s.height).toBeUndefined();
    }
  });

  test("an unmeasured container produces no sizing at all", () => {
    const s = tileStyle(solveGrid(0, 0, 1, 32 / 9), 32 / 9);
    expect(s.width).toBeUndefined();
    expect(s.height).toBeUndefined();
    expect(s.aspectRatio).toBeUndefined();
  });
});

describe("solveGrid: the options CallGrid relies on", () => {
  const RATIO = 16 / 9;

  test("every tile is the same size and the layout never leaves the box", () => {
    for (const [w, h] of [[1200, 700], [500, 1200], [3440, 1440], [320, 200]]) {
      for (let n = 1; n <= 16; n++) {
        const g = solveGrid(w, h, n, RATIO, 16);
        expect(g.cols * g.rows, `${w}x${h} n=${n}`).toBeGreaterThanOrEqual(n);
        expect(g.cols * g.tileWidth + 16 * (g.cols - 1), `${w}x${h} n=${n}`).toBeLessThanOrEqual(w + 0.001);
        expect(g.rows * g.tileHeight + 16 * (g.rows - 1), `${w}x${h} n=${n}`).toBeLessThanOrEqual(h + 0.001);
        expect(g.tileWidth / g.tileHeight).toBeCloseTo(RATIO, 5);
      }
    }
  });

  test("more people never means bigger tiles", () => {
    let last = Number.POSITIVE_INFINITY;
    for (let n = 1; n <= 20; n++) {
      const { tileWidth } = solveGrid(1200, 700, n, RATIO, 16);
      expect(tileWidth, `n=${n}`).toBeLessThanOrEqual(last + 0.001);
      last = tileWidth;
    }
  });

  test("a wide box puts two tiles side by side; a tall one stacks them", () => {
    expect(solveGrid(1600, 500, 2, RATIO, 16).cols).toBe(2);
    expect(solveGrid(500, 1200, 2, RATIO, 16).cols).toBe(1);
  });

  test("singleRow sizes tiles to the strip height and lets the row scroll sideways", () => {
    // A thumbnail strip must not shrink its tiles to slivers when the call is big:
    // the tile is as tall as the strip, however many there are, and the container
    // scrolls horizontally past the ones that do not fit.
    let first: number | null = null;
    for (const n of [1, 2, 5, 12, 40]) {
      const g = solveGrid(1200, 128, n, RATIO, 12, { singleRow: true });
      expect(g.rows, `n=${n}`).toBe(1);
      expect(g.tileHeight, `n=${n}`).toBeCloseTo(128, 5);
      expect(g.tileWidth / g.tileHeight).toBeCloseTo(RATIO, 5);
      first ??= g.tileWidth;
      expect(g.tileWidth, `n=${n}`).toBeCloseTo(first, 5);
    }
  });

  test("singleRow still bounds a lone tile by the strip width", () => {
    const g = solveGrid(200, 128, 1, RATIO, 12, { singleRow: true });
    expect(g.rows).toBe(1);
    expect(g.tileWidth).toBeLessThanOrEqual(200 + 0.001);
    expect(g.tileHeight).toBeLessThan(128);
  });

  test("maxTileWidth caps a tile and keeps its ratio", () => {
    const g = solveGrid(4000, 2200, 1, RATIO, 16, { maxTileWidth: 720 });
    expect(g.tileWidth).toBe(720);
    expect(g.tileHeight).toBeCloseTo(720 / RATIO, 5);
  });

  test("maxTileWidth does nothing when the tile is already smaller", () => {
    const capped = solveGrid(1200, 700, 6, RATIO, 16, { maxTileWidth: 720 });
    const free = solveGrid(1200, 700, 6, RATIO, 16);
    expect(capped).toEqual(free);
  });

  test("minTileWidth holds a floor even when that overflows the box", () => {
    const g = solveGrid(320, 200, 20, RATIO, 16, { minTileWidth: 150 });
    expect(g.tileWidth).toBe(150);
    expect(g.tileHeight).toBeCloseTo(150 / RATIO, 5);
    // Overflow is the intended outcome here: the area scrolls rather than the tiles shrinking to nothing.
    expect(g.cols * g.tileWidth).toBeGreaterThan(320);
  });

  test("minTileWidth does not fire for an unmeasured box", () => {
    const g = solveGrid(0, 0, 4, RATIO, 16, { minTileWidth: 150 });
    expect(g.tileWidth).toBe(0);
    expect(g.tileHeight).toBe(0);
  });

  test("a zero or negative count is a zeroed single column", () => {
    for (const n of [0, -3]) {
      const g = solveGrid(1200, 700, n, RATIO, 16);
      expect(g.cols).toBe(1);
      expect(g.rows).toBe(1);
      expect(g.tileWidth).toBe(0);
    }
  });

  test("a gap wider than the box still yields a finite, non-negative tile", () => {
    const g = solveGrid(10, 700, 3, RATIO, 16);
    expect(Number.isFinite(g.tileWidth)).toBe(true);
    expect(g.tileWidth).toBeGreaterThanOrEqual(0);
    expect(g.cols).toBe(1);
  });

  test("the reactive wrapper follows its inputs", () => {
    const width = ref(1200);
    const count = ref(2);
    const g = useResponsiveGrid({ width, height: 700, count, gap: 16 });
    const first = g.value.tileWidth;

    count.value = 6;
    expect(g.value.tileWidth).toBeLessThan(first);

    width.value = 0;
    expect(g.value.tileWidth).toBe(0);
  });
});
