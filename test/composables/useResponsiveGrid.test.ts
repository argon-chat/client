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
import { solveGrid, tileStyle } from "@/composables/useResponsiveGrid";

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
