/**
 * The cut-out tab's selection and smart-eraser tools, CPU side: rasterising a lasso (with feather),
 * the magic eraser's flood fill, colour distance, the live-wire cost map and path search, the
 * background eraser's sampling, the magnetic lasso's anchors, and how each lands in the mask
 * history as one undoable op.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { rasterizePolygon, selectionCoverage, simplifyPath, polygonArea } from "../src/selection/polygon";
import { cropCoverage, eraseWithCoverage, featherCoverage, type CoverageRect } from "../src/selection/coverage";
import { colourMatch, deltaE76, distanceFrom, rgbToLab, toleranceToDeltaE } from "../src/selection/color";
import { magicErase, type RgbaImage } from "../src/selection/magicEraser";
import { beginBackgroundErase, brushFalloff } from "../src/selection/backgroundEraser";
import { computeCostMap, findPath, pathLength, pointsWithin, snapToEdge } from "../src/selection/livewire";
import { createLocalLiveWire } from "../src/selection/liveWireClient";
import { AUTO_ANCHOR_SPACING, concat, createMagneticLasso } from "../src/selection/magneticLasso";
import { useMediaEditorStore, REMOVE_ARRAY_ITEM } from "../src/store/editorStore";
import type { Vec2 } from "../src/types";

type Rgba = [number, number, number, number];

function image(width: number, height: number, paint: (x: number, y: number) => Rgba): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  }
  return { width, height, data };
}

/** Value of a coverage at frame pixel (x, y), 0 outside its box. */
function valueAt(c: CoverageRect | null, x: number, y: number): number {
  if (!c) return 0;
  if (x < c.x || y < c.y || x >= c.x + c.width || y >= c.y + c.height) return 0;
  return c.data[(y - c.y) * c.width + (x - c.x)];
}

describe("polygon → coverage", () => {
  const square: Vec2[] = [[10, 10], [30, 10], [30, 30], [10, 30]];

  test("inside is 255, outside 0, and an edge through a pixel's middle half covers it", () => {
    const c = rasterizePolygon(square, 64, 64)!;
    expect(c).toMatchObject({ x: 10, y: 10, width: 20, height: 20 });
    expect(valueAt(c, 20, 20)).toBe(255);
    expect(valueAt(c, 10, 10)).toBe(255);
    expect(valueAt(c, 29, 29)).toBe(255);
    expect(valueAt(c, 9, 20)).toBe(0);
    expect(valueAt(c, 30, 20)).toBe(0);

    const half = rasterizePolygon([[10.5, 10], [30, 10], [30, 30], [10.5, 30]], 64, 64)!;
    expect(valueAt(half, 10, 20)).toBe(128);
    expect(valueAt(half, 11, 20)).toBe(255);
  });

  test("a diagonal edge is anti-aliased: about half coverage on the diagonal", () => {
    const c = rasterizePolygon([[0, 0], [40, 0], [0, 40]], 40, 40)!;
    // The pixel (10, 29) straddles x + y = 40 through its centre... (10.5 + 29.5 = 40)
    expect(Math.abs(valueAt(c, 10, 29) - 128)).toBeLessThanOrEqual(26);
    expect(valueAt(c, 5, 5)).toBe(255);
    expect(valueAt(c, 30, 30)).toBe(0);
    // The total is the triangle's area.
    let sum = 0;
    for (const v of c.data) sum += v / 255;
    expect(sum).toBeCloseTo(800, -1);
  });

  test("non-zero winding: a lasso that loops over itself keeps the loop", () => {
    // A figure drawn twice round (same direction): still covered, not cancelled out.
    const twice: Vec2[] = [...square, ...square];
    expect(valueAt(rasterizePolygon(twice, 64, 64), 20, 20)).toBe(255);
  });

  test("clipped to the frame; nothing inside is null", () => {
    const c = rasterizePolygon([[-10, -10], [20, -10], [20, 20], [-10, 20]], 16, 16)!;
    expect(c).toMatchObject({ x: 0, y: 0, width: 16, height: 16 });
    expect(c.data.every((v) => v === 255)).toBe(true);
    expect(rasterizePolygon([[100, 100], [120, 100], [120, 120]], 16, 16)).toBeNull();
    expect(rasterizePolygon([[1, 1], [2, 2]], 16, 16)).toBeNull();
  });

  test("feather: flat inside and outside, a monotone band across the edge that keeps its midpoint", () => {
    const c = selectionCoverage([[20, 0], [80, 0], [80, 40], [20, 40]], 6, 100, 40)!;
    const row = Array.from({ length: 100 }, (_, x) => valueAt(c, x, 20));
    expect(row[50]).toBe(255);
    expect(row[0]).toBe(0);
    expect(row[99]).toBe(0);
    for (let x = 1; x <= 50; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
    // A band, not a step: several partial pixels on each side of x = 20.
    const band = row.slice(0, 50).filter((v) => v > 0 && v < 255).length;
    expect(band).toBeGreaterThanOrEqual(6);
    expect(row[16]).toBeGreaterThan(0);
    expect(row[23]).toBeLessThan(255);
    expect(Math.abs(row[19] + row[20] - 255)).toBeLessThanOrEqual(4);
    // At the frame's top and bottom the selection runs off the edge: no fade there.
    expect(valueAt(c, 50, 0)).toBe(255);
  });

  test("source points are scaled into a smaller mask frame", () => {
    const c = selectionCoverage([[20, 20], [60, 20], [60, 60], [20, 60]], 0, 50, 50, 0.5)!;
    expect(c).toMatchObject({ x: 10, y: 10, width: 20, height: 20 });
  });

  test("erasing with a coverage: inside multiplies the mask by 1 − c, outside keeps only c", () => {
    const mask = new Uint8Array(16).fill(200);
    const c: CoverageRect = { x: 1, y: 1, width: 2, height: 2, data: new Uint8Array([255, 128, 0, 255]) };
    const inside = mask.slice();
    eraseWithCoverage(inside, 4, 4, c);
    expect(Array.from(inside.subarray(4, 8))).toEqual([200, 0, 100, 200]);
    expect(inside[0]).toBe(200);
    const outside = mask.slice();
    eraseWithCoverage(outside, 4, 4, c, true);
    expect(Array.from(outside.subarray(4, 8))).toEqual([0, 200, 100, 0]);
    expect(outside[0]).toBe(0);
  });

  test("simplify keeps corners and drops collinear points", () => {
    const line: Vec2[] = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3]];
    expect(simplifyPath(line, 0.1)).toEqual([[0, 0], [3, 0], [3, 3]]);
    expect(polygonArea([[0, 0], [4, 0], [4, 3]])).toBe(6);
  });

  test("crop and feather helpers", () => {
    const full = new Uint8Array(100);
    full[5 * 10 + 5] = 255;
    expect(cropCoverage(full, 10, 10)).toMatchObject({ x: 5, y: 5, width: 1, height: 1 });
    expect(cropCoverage(new Uint8Array(100), 10, 10)).toBeNull();
    const grown = featherCoverage({ x: 5, y: 5, width: 1, height: 1, data: new Uint8Array([255]) }, 1, 10, 10);
    expect(grown.width).toBeGreaterThan(1);
    expect(featherCoverage(cropCoverage(full, 10, 10)!, 0, 10, 10).width).toBe(1);
  });
});

describe("colour distance", () => {
  test("Lab of the primaries and the neutral axis match the reference values", () => {
    const close = (a: number[], b: number[], tol = 0.05) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThanOrEqual(tol));
    close(rgbToLab(255, 255, 255), [100, 0, 0], 0.01);
    close(rgbToLab(0, 0, 0), [0, 0, 0], 0.01);
    close(rgbToLab(255, 0, 0), [53.24, 80.09, 67.2]);
    close(rgbToLab(0, 255, 0), [87.73, -86.18, 83.18]);
    close(rgbToLab(0, 0, 255), [32.3, 79.19, -107.86]);
    const grey = rgbToLab(119, 119, 119);
    expect(Math.abs(grey[1]) + Math.abs(grey[2])).toBeLessThan(0.01);
    expect(grey[0]).toBeCloseTo(50, 0);
  });

  test("CIE76 ΔE is the Euclidean distance in Lab", () => {
    expect(deltaE76([50, 0, 0], [53, 4, 0])).toBe(5);
    expect(deltaE76(rgbToLab(0, 0, 0), rgbToLab(255, 255, 255))).toBeCloseTo(100, 1);
    // Perceptual, not RGB: equal RGB steps are not equal ΔE (dark greys are further apart).
    const dark = deltaE76(rgbToLab(10, 10, 10), rgbToLab(30, 30, 30));
    const light = deltaE76(rgbToLab(220, 220, 220), rgbToLab(240, 240, 240));
    expect(dark).toBeGreaterThan(light);
  });

  test("distanceFrom: ΔE between opaque colours, alpha weighs as a fourth axis, cached or not", () => {
    const d = distanceFrom(255, 0, 0, 255);
    expect(d(255, 0, 0, 255)).toBe(0);
    const red = rgbToLab(255, 0, 0);
    const blue = rgbToLab(0, 0, 255);
    expect(d(0, 0, 255, 255)).toBeCloseTo(deltaE76(red, blue), 3);
    expect(d(0, 0, 255, 255)).toBeCloseTo(deltaE76(red, blue), 3); // from the cache
    expect(d(255, 0, 0, 0)).toBeCloseTo(100, 3);
  });

  test("tolerance maps 0–100 onto ΔE 0–150, monotone; the match ramps just past the threshold", () => {
    expect(toleranceToDeltaE(0)).toBe(0);
    expect(toleranceToDeltaE(50)).toBe(50);
    expect(toleranceToDeltaE(100)).toBe(150);
    expect(toleranceToDeltaE(120)).toBe(150);
    for (let t = 1; t <= 100; t++) expect(toleranceToDeltaE(t)).toBeGreaterThan(toleranceToDeltaE(t - 1));
    expect(colourMatch(10, 10, 4)).toBe(1);
    expect(colourMatch(12, 10, 4)).toBeCloseTo(0.5);
    expect(colourMatch(14, 10, 4)).toBe(0);
  });
});

describe("magic eraser", () => {
  const WHITE: Rgba = [255, 255, 255, 255];
  const RED: Rgba = [220, 30, 30, 255];
  // Two white regions split by a red bar, a red square inside the left one.
  const picture = image(40, 20, (x, y) => (x >= 18 && x < 22) || (x >= 5 && x < 10 && y >= 5 && y < 10) ? RED : WHITE);

  test("contiguous: erases the clicked region only, up to the other colour", () => {
    const c = magicErase(picture, [2, 2], { tolerance: 20, contiguous: true, feather: 0 })!;
    expect(valueAt(c, 0, 0)).toBe(255);
    expect(valueAt(c, 17, 19)).toBe(255);
    expect(valueAt(c, 7, 7)).toBe(0); // the red square inside
    expect(valueAt(c, 19, 5)).toBe(0); // the bar
    expect(valueAt(c, 30, 5)).toBe(0); // the white on the other side
    expect(c.x + c.width).toBeLessThanOrEqual(18);
  });

  test("global: the same colour everywhere", () => {
    const c = magicErase(picture, [2, 2], { tolerance: 20, contiguous: false, feather: 0 })!;
    expect(valueAt(c, 0, 0)).toBe(255);
    expect(valueAt(c, 30, 5)).toBe(255);
    expect(valueAt(c, 7, 7)).toBe(0);
    expect(valueAt(c, 19, 5)).toBe(0);
  });

  test("tolerance decides what counts as the same colour", () => {
    // A gradient: 10 grey levels apart per column.
    const ramp = image(20, 4, (x) => [x * 10, x * 10, x * 10, 255]);
    const narrow = magicErase(ramp, [0, 0], { tolerance: 5, contiguous: true, feather: 0 })!;
    const wide = magicErase(ramp, [0, 0], { tolerance: 40, contiguous: true, feather: 0 })!;
    const reach = (c: CoverageRect) => Array.from({ length: 20 }, (_, x) => valueAt(c, x, 1)).filter((v) => v === 255).length;
    expect(reach(wide)).toBeGreaterThan(reach(narrow));
    expect(reach(narrow)).toBeGreaterThanOrEqual(1);
    expect(valueAt(wide, 19, 1)).toBe(0);
  });

  test("anti-aliased boundary: an edge pixel blended toward the subject keeps the subject's share", () => {
    // White | a column a quarter / half / three quarters of the way to red | red.
    const mixTo = (t: number): Rgba => [Math.round(255 + (RED[0] - 255) * t), Math.round(255 + (RED[1] - 255) * t), Math.round(255 + (RED[2] - 255) * t), 255];
    const d = distanceFrom(255, 255, 255, 255);
    const erased: number[] = [];
    for (const t of [0.25, 0.5, 0.75]) {
      const blend = mixTo(t);
      const soft = image(12, 4, (x) => (x < 5 ? WHITE : x === 5 ? blend : RED));
      const c = magicErase(soft, [0, 0], { tolerance: 20, contiguous: true, feather: 0 })!;
      expect(valueAt(c, 4, 1)).toBe(255);
      expect(valueAt(c, 7, 1)).toBe(0);
      const partial = valueAt(c, 5, 1);
      // 1 − d(pixel) / d(subject): the distance is perceptual, so only roughly 1 − t.
      expect(partial).toBe(Math.round(255 * (1 - d(...blend) / d(...RED))));
      expect(Math.abs(partial / 255 - (1 - t))).toBeLessThan(0.2);
      erased.push(partial);
    }
    expect(erased[0]).toBeGreaterThan(erased[1]);
    expect(erased[1]).toBeGreaterThan(erased[2]);
    // Within the tolerance it is not an edge any more: erased in full.
    const faint = image(12, 4, (x) => (x < 5 ? WHITE : x === 5 ? mixTo(0.02) : RED));
    expect(valueAt(magicErase(faint, [0, 0], { tolerance: 20, contiguous: true, feather: 0 }), 5, 1)).toBe(255);
  });

  test("an opaque colour does not match transparent pixels; feather softens the cut", () => {
    const holed = image(10, 10, (x) => (x < 5 ? WHITE : [255, 255, 255, 0]));
    const c = magicErase(holed, [0, 0], { tolerance: 20, contiguous: true, feather: 0 })!;
    expect(valueAt(c, 4, 4)).toBe(255);
    expect(valueAt(c, 6, 4)).toBe(0);
    const soft = magicErase(picture, [2, 2], { tolerance: 20, contiguous: true, feather: 3 })!;
    expect(valueAt(soft, 19, 12)).toBeGreaterThan(0); // the bar's edge gets some of the fade
    expect(valueAt(soft, 1, 15)).toBe(255);
  });

  test("a click outside the image does nothing", () => {
    expect(magicErase(picture, [-1, 3], { tolerance: 20, contiguous: true, feather: 0 })).toBeNull();
  });
});

describe("background eraser", () => {
  const BLUE: Rgba = [30, 60, 220, 255];
  const YELLOW: Rgba = [240, 220, 40, 255];
  const halves = image(60, 30, (x) => (x < 30 ? BLUE : YELLOW));

  test("sampled once: a stroke across the boundary erases only the colour it started on", () => {
    const s = beginBackgroundErase(halves, [15, 15], { size: 16, hardness: 100, tolerance: 20, sampling: "once" });
    s.to([45, 15]);
    expect(s.sample).toEqual(BLUE);
    const c = s.result()!;
    for (const x of [10, 20, 29]) expect(valueAt(c, x, 15)).toBe(255);
    for (const x of [30, 35, 45]) expect(valueAt(c, x, 15)).toBe(0);
    expect(valueAt(c, 20, 2)).toBe(0); // outside the brush
  });

  test("sampled continuously: the colour under the hotspot changes as it moves", () => {
    const s = beginBackgroundErase(halves, [15, 15], { size: 16, hardness: 100, tolerance: 20, sampling: "continuous" });
    s.to([45, 15]);
    expect(s.sample).toEqual(YELLOW);
    const c = s.result()!;
    expect(valueAt(c, 20, 15)).toBe(255);
    expect(valueAt(c, 40, 15)).toBe(255);
  });

  test("hardness: a hard brush erases fully to its rim, a soft one falls off", () => {
    expect(brushFalloff(0, 10, 100)).toBe(1);
    expect(brushFalloff(9.4, 10, 100)).toBe(1);
    expect(brushFalloff(11, 10, 100)).toBe(0);
    expect(brushFalloff(2, 10, 0)).toBeLessThan(1);
    expect(brushFalloff(5, 10, 50)).toBe(1);
    expect(brushFalloff(7.5, 10, 50)).toBeCloseTo(0.5);
    const s = beginBackgroundErase(halves, [15, 15], { size: 20, hardness: 0, tolerance: 20, sampling: "once" });
    const c = s.result()!;
    expect(valueAt(c, 15, 15)).toBeGreaterThan(200);
    expect(valueAt(c, 22, 15)).toBeGreaterThan(0);
    expect(valueAt(c, 22, 15)).toBeLessThan(valueAt(c, 17, 15));
  });

  test("going over the same spot twice does not erase more; nothing erased is no result", () => {
    const soft = beginBackgroundErase(halves, [15, 15], { size: 20, hardness: 0, tolerance: 20, sampling: "once" });
    const once = valueAt(soft.result(), 22, 15);
    soft.to([15, 16]);
    soft.to([15, 15]);
    expect(valueAt(soft.result(), 22, 15)).toBeLessThanOrEqual(once + 30);
    const none = beginBackgroundErase(halves, [15, 15], { size: 4, hardness: 100, tolerance: 0, sampling: "once" });
    expect(none.result()).not.toBeNull();
    const nothing = beginBackgroundErase(image(10, 10, () => BLUE), [-50, -50], { size: 4, hardness: 100, tolerance: 0, sampling: "once" });
    expect(nothing.result()).toBeNull();
  });
});

describe("live wire", () => {
  // 120×120 grey with a sharp dark square 30..90 (its edge lies between pixels 29|30 and 89|90).
  const W = 120;
  const squareImage = image(W, W, (x, y) => (x >= 30 && x < 90 && y >= 30 && y < 90 ? [40, 40, 60, 255] : [200, 200, 200, 255]));
  const map = computeCostMap(squareImage.data, W, W);
  const pairs = (p: Int32Array) => Array.from({ length: p.length / 2 }, (_, i) => [p[i * 2], p[i * 2 + 1]] as Vec2);
  /** Distance from a pixel centre to the square's outline. */
  const toEdge = ([x, y]: Vec2) => {
    const cx = x + 0.5;
    const cy = y + 0.5;
    const dx = Math.max(30 - cx, 0, cx - 90);
    const dy = Math.max(30 - cy, 0, cy - 90);
    if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
    return Math.min(cx - 30, 90 - cx, cy - 30, 90 - cy);
  };

  test("the cost map is low on the edge and high on flat areas", () => {
    const cost = (x: number, y: number) => map.cost[y * W + x];
    expect(Math.min(cost(29, 60), cost(30, 60))).toBeLessThan(40);
    expect(cost(10, 10)).toBe(255);
    expect(cost(60, 60)).toBe(255);
    expect(map.edge[60 * W + 30]).toBeGreaterThan(200);
  });

  test("a path between two points on the edge follows the edge within 1 px, round the corner", () => {
    const r = findPath(map, [30, 70], [70, 30]);
    expect(r.straight).toBe(false);
    const points = pairs(r.points);
    expect(points[0]).toEqual([30, 70]);
    expect(points[points.length - 1]).toEqual([70, 30]);
    for (const p of points) expect(toEdge(p), `(${p})`).toBeLessThanOrEqual(1);
    // It went round the corner, not across: some point is near (30, 30).
    expect(Math.min(...points.map(([x, y]) => Math.hypot(x - 30, y - 30)))).toBeLessThanOrEqual(2);
    // 8-connected and without repeats.
    for (let i = 1; i < points.length; i++) {
      expect(Math.max(Math.abs(points[i][0] - points[i - 1][0]), Math.abs(points[i][1] - points[i - 1][1]))).toBe(1);
    }
  });

  test("a path across a flat area is straight", () => {
    const flat = computeCostMap(image(200, 200, () => [128, 128, 128, 255]).data, 200, 200);
    for (const [from, to] of [
      [[5, 5], [25, 12]],
      [[100, 10], [110, 28]],
      [[40, 50], [160, 90]],
      [[150, 150], [20, 180]],
    ] as [Vec2, Vec2][]) {
      const points = pairs(findPath(flat, from, to).points);
      const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
      const len = Math.hypot(dx, dy);
      for (const [x, y] of points) {
        const off = Math.abs(dy * (x - from[0]) - dx * (y - from[1])) / len;
        expect(off, `(${x},${y}) from ${from}→${to}`).toBeLessThanOrEqual(1);
      }
      // As short as an 8-connected path can be.
      expect(points.length - 1).toBe(Math.max(Math.abs(dx), Math.abs(dy)));
    }
  });

  test("snapping moves a nearby point onto the edge and leaves a lonely one alone", () => {
    const [sx] = snapToEdge(map, [34, 60], 6);
    expect(sx === 29 || sx === 30).toBe(true);
    expect(snapToEdge(map, [60, 60], 6)).toEqual([60, 60]);
  });

  test("a far target is pulled into the window along the line; blocked pixels are avoided", () => {
    const far = findPath(map, [0, 0], [119, 119], { maxWindow: 64, pad: 8 });
    expect(far.clamped).toBe(true);
    expect(far.end[0]).toBeLessThan(64);
    expect(far.end[0]).toBe(far.end[1]);

    // From the left edge's middle to the right edge's: once over the top, then (with the top
    // blocked) back along the bottom.
    const over = findPath(map, [30, 60], [89, 60], { window: { x0: 0, y0: 0, x1: W, y1: W } });
    const back = findPath(map, [89, 60], [30, 60], { window: { x0: 0, y0: 0, x1: W, y1: W }, blocked: over.points });
    const overY = pairs(over.points).map((p) => p[1]);
    const backY = pairs(back.points).map((p) => p[1]);
    const overSide = Math.sign(Math.min(...overY) - 60 + (Math.max(...overY) - 60));
    const backSide = Math.sign(Math.min(...backY) - 60 + (Math.max(...backY) - 60));
    expect(overSide).not.toBe(0);
    expect(backSide).toBe(-overSide);
    for (const p of pairs(back.points)) expect(toEdge(p)).toBeLessThanOrEqual(1);
  });

  test("path length helpers", () => {
    const p = Int32Array.of(0, 0, 3, 4, 6, 8);
    expect(pathLength(p)).toBe(10);
    expect(pointsWithin(p, 5)).toBe(2);
    expect(pointsWithin(p, 4)).toBe(1);
    expect(Array.from(concat(Int32Array.of(0, 0, 1, 1), Int32Array.of(1, 1, 2, 2)))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe("magnetic lasso", () => {
  const W = 200;
  const picture = image(W, W, (x, y) => (x >= 40 && x < 160 && y >= 40 && y < 160 ? [200, 40, 40, 255] : [230, 230, 230, 255]));

  async function lasso() {
    const backend = createLocalLiveWire();
    await backend.prepare(picture);
    const onChange = vi.fn();
    return { m: createMagneticLasso(backend, { snapRadius: () => 4, onChange }), onChange };
  }

  test("two anchors and close: the outline goes round the square along its edge", async () => {
    const { m } = await lasso();
    await m.click([42, 100]); // snaps onto the left edge
    expect(m.state.anchors[0][0]).toBeGreaterThanOrEqual(39);
    expect(m.state.anchors[0][0]).toBeLessThanOrEqual(40);
    await m.click([158, 100]);
    const outline = (await m.close())!;
    expect(outline.length).toBeGreaterThan(300);
    // Every point within a pixel of the square's outline, and the loop covers all four sides.
    for (const [x, y] of outline) {
      const d = Math.min(Math.abs(x + 0.5 - 40), Math.abs(x + 0.5 - 160), Math.abs(y + 0.5 - 40), Math.abs(y + 0.5 - 160));
      expect(d, `(${x},${y})`).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(polygonArea(outline.map(([x, y]) => [x + 0.5, y + 0.5] as Vec2)))).toBeGreaterThan(120 * 120 * 0.95);
    expect(m.state.anchors).toEqual([]);
  });

  test("tracing lays anchors on its own every ~100 px; Backspace takes one back; Esc clears", async () => {
    const { m, onChange } = await lasso();
    await m.click([40, 150]);
    for (let y = 148; y >= 40; y -= 4) m.move([40, y]);
    for (let x = 44; x <= 150; x += 4) m.move([x, 40]);
    await m.idle();
    // The pointer went ~220 px along the edge: at least one automatic anchor.
    expect(m.state.anchors.length).toBeGreaterThanOrEqual(2);
    for (const seg of m.state.segments) expect(pathLength(seg)).toBeLessThanOrEqual(AUTO_ANCHOR_SPACING + 40);
    expect(onChange).toHaveBeenCalled();
    const n = m.state.anchors.length;
    m.removeLast();
    expect(m.state.anchors.length).toBe(n - 1);
    m.cancel();
    expect(m.state.anchors).toEqual([]);
    expect(await m.close()).toBeNull();
  });

  test("moves made while the first anchor is still being placed are followed once it lands", async () => {
    const { m } = await lasso();
    void m.click([40, 150]);
    m.move([40, 120]);
    m.move([40, 100]);
    expect(m.state.anchors).toEqual([]);
    await m.idle();
    await m.idle();
    const live = m.state.live!;
    expect(live).not.toBeNull();
    expect([live[live.length - 2], live[live.length - 1]]).toEqual([m.state.anchors[0][0], 100]);
  });

  test("without a backend it is a polygon lasso: straight segments between clicks", async () => {
    const m = createMagneticLasso(null, { snapRadius: () => 4, onChange: () => {} });
    await m.click([10, 10]);
    await m.click([100, 10]);
    await m.click([100, 100]);
    expect(m.state.segments.map((s) => Array.from(s))).toEqual([[10, 10, 100, 10], [100, 10, 100, 100]]);
    expect(await m.close()).toEqual([[10, 10], [100, 10], [100, 100]]);
  });
});

describe("the tools in the editor state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function open() {
    const store = useMediaEditorStore();
    store.init({ src: "blob:x", type: "image", mode: "sticker" });
    return store;
  }

  test("a selection is one polygon op; keep erases outside, erase inside, invert swaps them; undoable", () => {
    const store = open();
    const points: Vec2[] = [[10, 10], [50, 10], [50, 50]];
    store.uiState.cutoutOptions.selectionFeather = 4;
    store.uiState.selection = { points, inverted: false };
    expect(store.applySelection("keep")).toBe(true);
    expect(store.uiState.selection).toBeNull();
    expect(store.mediaState.mask.strokes).toEqual([{ kind: "polygon", region: "outside", feather: 4, points }]);
    expect(store.mediaState.history.at(-1)).toMatchObject({ path: ["mask", "strokes", 0], oldValue: REMOVE_ARRAY_ITEM });

    store.uiState.selection = { points, inverted: false };
    store.applySelection("erase");
    store.uiState.selection = { points, inverted: true };
    store.applySelection("keep");
    store.uiState.selection = { points, inverted: true };
    store.applySelection("erase");
    expect(store.mediaState.mask.strokes.map((s) => (s.kind === "polygon" ? s.region : null))).toEqual(["outside", "inside", "inside", "outside"]);

    store.undo();
    store.undo();
    store.undo();
    expect(store.mediaState.mask.strokes).toHaveLength(1);
    store.undo();
    expect(store.mediaState.mask.strokes).toHaveLength(0);
    store.redo();
    expect(store.mediaState.mask.strokes[0]).toMatchObject({ kind: "polygon", region: "outside" });
    expect(store.hasModifications).toBe(true);
  });

  test("a degenerate selection records nothing; feather is clamped to 0–20", () => {
    const store = open();
    expect(store.eraseSelection([[0, 0], [10, 10]], "inside")).toBe(false);
    expect(store.eraseSelection([[0, 0], [10, 10], [20, 20]], "inside")).toBe(false);
    expect(store.applySelection("keep")).toBe(false);
    expect(store.mediaState.history).toHaveLength(0);
    store.eraseSelection([[0, 0], [10, 0], [10, 10]], "inside", 99);
    expect(store.mediaState.mask.strokes[0]).toMatchObject({ feather: 20 });
  });

  test("the magic eraser adds one raster op over the source box it erased; undo and redo", () => {
    const store = open();
    // A 200×100 source seen through a 100×50 working copy (scale 0.5): white left, red right.
    const working = image(100, 50, (x) => (x < 60 ? [255, 255, 255, 255] : [200, 0, 0, 255]));
    store.setWorkingImage({ ...working, scale: 0.5 });
    store.uiState.cutoutOptions.magicTolerance = 20;
    expect(store.magicErase([20, 20])).toBe(true);
    const op = store.mediaState.mask.strokes[0];
    expect(op).toMatchObject({ kind: "raster", mode: "erase", points: [[0, 0], [120, 100]] });
    const raster = op.kind === "raster" ? store.getMaskSource(op.raster) : null;
    expect(raster).toMatchObject({ width: 60, height: 50 });
    expect(raster!.data.every((v) => v === 255)).toBe(true);
    store.undo();
    expect(store.mediaState.mask.strokes).toHaveLength(0);
    store.redo();
    expect(store.mediaState.mask.strokes).toHaveLength(1);
    // Nothing to erase outside the image.
    expect(store.magicErase([-10, 5])).toBe(false);
    expect(store.mediaState.history).toHaveLength(1);
  });

  test("resetting the mask takes every kind of op with it, and undo brings them back", () => {
    const store = open();
    store.addMaskStroke({ mode: "erase", size: 4, points: [[1, 1]] });
    store.eraseSelection([[0, 0], [10, 0], [10, 10]], "outside");
    store.addMaskErase({ x: 2, y: 3, width: 2, height: 1, data: new Uint8Array([255, 128]) }, 1);
    expect(store.mediaState.mask.strokes).toHaveLength(3);
    store.resetMask();
    expect(store.mediaState.mask.strokes).toEqual([]);
    store.undo();
    expect(store.mediaState.mask.strokes.map((s) => s.kind ?? "brush")).toEqual(["brush", "polygon", "raster"]);
    expect(store.mediaState.mask.strokes[2]).toMatchObject({ points: [[2, 3], [4, 4]] });
  });

  test("tool state is UI state: it resets with the editor and never enters the history", () => {
    const store = open();
    store.uiState.cutoutTool = "lasso";
    store.uiState.selection = { points: [[0, 0], [1, 0], [1, 1]], inverted: true };
    expect(store.mediaState.history).toHaveLength(0);
    expect(store.hasModifications).toBe(false);
    store.init({ src: "blob:y", type: "image", mode: "sticker" });
    expect(store.uiState.cutoutTool).toBeNull();
    expect(store.uiState.selection).toBeNull();
    expect(store.getWorkingImage()).toBeNull();
  });
});
