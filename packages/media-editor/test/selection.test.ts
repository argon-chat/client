/**
 * The cut-out tab's selection and smart-eraser tools, CPU side: rasterising a lasso (with feather
 * and anti-alias), the magic eraser and the background eraser with Photoshop's options and their
 * colour decontamination, the live-wire cost map and path search (Edge Contrast, Width), the
 * magnetic lasso's fastening points, and how each lands in the mask history as one undoable op.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { rasterizePolygon, selectionCoverage, simplifyPath, polygonArea } from "../src/selection/polygon";
import { cropCoverage, eraseWithCoverage, featherCoverage, type CoverageRect, type EraseRect } from "../src/selection/coverage";
import { magicErase, type MagicEraseOptions, type RgbaImage } from "../src/selection/magicEraser";
import { beginBackgroundErase, brushFalloff, type BackgroundEraserOptions } from "../src/selection/backgroundEraser";
import { channelTables, hexToRgba, rgbToHex, sampleColour } from "../src/selection/sample";
import { computeCostMap, contrastLevels, findPath, pathLength, pointsWithin, snapToEdge } from "../src/selection/livewire";
import { createLocalLiveWire } from "../src/selection/liveWireClient";
import { concat, createMagneticLasso, fasteningSpacing } from "../src/selection/magneticLasso";
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

/** The colour an eraser gives pixel (x, y), or null when it keeps its own. */
function colourAt(c: EraseRect | null, x: number, y: number): number[] | null {
  if (!c?.colour) return null;
  if (x < c.x || y < c.y || x >= c.x + c.width || y >= c.y + c.height) return null;
  const local = (y - c.y) * c.width + (x - c.x);
  for (let k = 0; k + 1 < c.colour.length; k += 2) {
    if (c.colour[k] !== local) continue;
    const rgb = c.colour[k + 1];
    return [rgb >>> 16, (rgb >>> 8) & 255, rgb & 255];
  }
  return null;
}

/** Colours given to pixels that stay (partly) visible; the rest is padding under erased pixels. */
function visibleColours(c: EraseRect | null): number[] {
  if (!c?.colour) return [];
  const out: number[] = [];
  for (let k = 0; k + 1 < c.colour.length; k += 2) if (c.data[c.colour[k]] < 255) out.push(c.colour[k]);
  return out;
}

const mix = (a: Rgba, b: Rgba, t: number): Rgba => [0, 1, 2, 3].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as Rgba;

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

describe("colour sampling", () => {
  test("Point and square averages, clipped to the image", () => {
    const img = image(4, 4, (x, y) => [x * 10, y * 10, 0, 255]);
    expect(sampleColour(img, 1, 1, 1)).toEqual([10, 10, 0, 255]);
    expect(sampleColour(img, 1, 1, 3)).toEqual([10, 10, 0, 255]);
    // At the corner only the four pixels inside count.
    expect(sampleColour(img, 0, 0, 3)).toEqual([5, 5, 0, 255]);
  });

  test("the tolerance tables: every channel within the tolerance", () => {
    const [r, g, b, a] = channelTables([100, 0, 255, 255], 10);
    expect([r[90], r[110], r[89], r[111]]).toEqual([1, 1, 0, 0]);
    expect([g[0], g[10], g[11]]).toEqual([1, 1, 0]);
    expect([b[245], b[244]]).toEqual([1, 0]);
    expect([a[255], a[0]]).toEqual([1, 0]);
    expect(hexToRgba("#ff8000")).toEqual([255, 128, 0, 255]);
    expect(rgbToHex(255, 128, 0)).toBe("#ff8000");
  });
});

describe("magic eraser (Photoshop's options)", () => {
  const WHITE: Rgba = [255, 255, 255, 255];
  const RED: Rgba = [220, 30, 30, 255];
  const GREY: Rgba = [128, 128, 128, 255];
  const DISC: Rgba = [230, 20, 20, 255];
  // Two white regions split by a red bar, a red square inside the left one.
  const picture = image(40, 20, (x, y) => (x >= 18 && x < 22) || (x >= 5 && x < 10 && y >= 5 && y < 10) ? RED : WHITE);
  const opts = (o: Partial<MagicEraseOptions> = {}): MagicEraseOptions => ({ tolerance: 32, antiAlias: false, contiguous: true, opacity: 100, sampleSize: 1, ...o });

  test("contiguous: the clicked region only, up to the other colour", () => {
    const c = magicErase(picture, [2, 2], opts())!;
    expect(valueAt(c, 0, 0)).toBe(255);
    expect(valueAt(c, 17, 19)).toBe(255);
    expect(valueAt(c, 7, 7)).toBe(0); // the red square inside
    expect(valueAt(c, 19, 5)).toBe(0); // the bar
    expect(valueAt(c, 30, 5)).toBe(0); // the white on the other side
    expect(c.x + c.width).toBeLessThanOrEqual(18);
  });

  test("not contiguous: the colour everywhere", () => {
    const c = magicErase(picture, [2, 2], opts({ contiguous: false }))!;
    expect(valueAt(c, 0, 0)).toBe(255);
    expect(valueAt(c, 30, 5)).toBe(255);
    expect(valueAt(c, 7, 7)).toBe(0);
    expect(valueAt(c, 19, 5)).toBe(0);
  });

  test("tolerance 0–255 is the largest difference allowed in any one channel", () => {
    // Green steps by 10 per column, the other channels stay.
    const ramp = image(20, 2, (x) => [100, Math.min(255, 100 + x * 10), 100, 255]);
    const reach = (tolerance: number) =>
      Array.from({ length: 20 }, (_, x) => valueAt(magicErase(ramp, [0, 0], opts({ tolerance })), x, 1)).filter((v) => v === 255).length;
    expect(reach(0)).toBe(1);
    expect(reach(25)).toBe(3);
    expect(reach(30)).toBe(4);
    expect(reach(255)).toBe(20);
  });

  test("opacity takes that share of each matching pixel", () => {
    const c = magicErase(picture, [2, 2], opts({ opacity: 40 }))!;
    expect(valueAt(c, 0, 0)).toBe(102);
    expect(magicErase(picture, [2, 2], opts({ opacity: 0 }))).toBeNull();
  });

  test("sample size: the clicked colour is the average of the square round the click", () => {
    const checker = image(10, 10, (x, y) => ((x + y) % 2 ? [140, 140, 140, 255] : [100, 100, 100, 255]));
    const count = (c: CoverageRect | null) => (c ? c.data.filter((v) => v === 255).length : 0);
    // Point: the clicked 100 grey; 140 is 40 away.
    expect(count(magicErase(checker, [1, 1], opts({ tolerance: 25, contiguous: false, sampleSize: 1 })))).toBe(50);
    // 3×3: about 118, within 25 of both.
    expect(count(magicErase(checker, [1, 1], opts({ tolerance: 25, contiguous: false, sampleSize: 3 })))).toBe(100);
    // 11×11 averages to about 120: the clicked 100 is not within 5 of it, so nothing to start from.
    expect(magicErase(checker, [5, 5], opts({ tolerance: 5, sampleSize: 11 }))).toBeNull();
  });

  test("anti-alias: an edge pixel loses its background share and keeps the subject's colour", () => {
    for (const t of [0.25, 0.5, 0.75]) {
      const soft = image(12, 4, (x) => (x < 5 ? GREY : x === 5 ? mix(GREY, DISC, t) : DISC));
      const c = magicErase(soft, [0, 0], opts({ tolerance: 20, antiAlias: true }))!;
      expect(valueAt(c, 4, 1)).toBe(255);
      expect(valueAt(c, 7, 1)).toBe(0);
      expect(Math.abs(valueAt(c, 5, 1) / 255 - (1 - t)), `t = ${t}`).toBeLessThan(0.03);
      // Decontaminated: the subject's red, not a grey-tinted blend.
      const [r, g, b] = colourAt(c, 5, 1)!;
      expect(r).toBeGreaterThan(215);
      expect(g).toBeLessThan(35);
      expect(b).toBeLessThan(35);
      // The erased grey beside it is padded with that red, so scaling the image cannot bleed grey in.
      expect(colourAt(c, 4, 1)).toEqual(colourAt(c, 5, 1));
      expect(colourAt(c, 2, 1)).toBeNull();
    }
  });

  test("anti-alias: a pixel within the tolerance but on the edge keeps the subject's share", () => {
    const faint = image(12, 4, (x) => (x < 5 ? GREY : x === 5 ? mix(GREY, DISC, 0.1) : DISC));
    const c = magicErase(faint, [0, 0], opts({ tolerance: 20, antiAlias: true }))!;
    expect(Math.abs(valueAt(c, 5, 1) - 230)).toBeLessThanOrEqual(5);
    expect(colourAt(c, 5, 1)![0]).toBeGreaterThan(200);
    // Off: a hard edge, all or nothing, no colour.
    const hard = magicErase(faint, [0, 0], opts({ tolerance: 20 }))!;
    expect(valueAt(hard, 5, 1)).toBe(255);
    expect(visibleColours(hard)).toEqual([]);
  });

  test("anti-alias: a pixel beside the region that is no blend of the two stays whole", () => {
    // Grey | a black outline | red: black is not between grey and red.
    const outlined = image(12, 4, (x) => (x < 5 ? GREY : x === 5 ? [0, 0, 0, 255] : DISC));
    const c = magicErase(outlined, [0, 0], opts({ tolerance: 20, antiAlias: true }))!;
    expect(valueAt(c, 4, 1)).toBe(255);
    expect(valueAt(c, 5, 1)).toBe(0);
  });

  test("alpha is a channel: an opaque colour does not match transparent pixels", () => {
    const holed = image(10, 10, (x) => (x < 5 ? WHITE : [255, 255, 255, 0]));
    const c = magicErase(holed, [0, 0], opts({ tolerance: 20 }))!;
    expect(valueAt(c, 4, 4)).toBe(255);
    expect(valueAt(c, 6, 4)).toBe(0);
  });

  test("a click outside the image does nothing", () => {
    expect(magicErase(picture, [-1, 3], opts())).toBeNull();
  });

  // A benchmark: what it measures is asserted inside, against its own baseline. The runner's default
  // five seconds is not enough for it on a shared CI machine under coverage instrumentation.
  test("a 4-megapixel image is erased within the frame budget", () => {
    // A disc on a textured background, the same picture at any size.
    const scene = (W: number): RgbaImage => {
      const data = new Uint8ClampedArray(W * W * 4);
      const c = W / 2;
      const r = (W * 600) / 2048;
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          const p = (y * W + x) * 4;
          const inside = (x - c) ** 2 + (y - c) ** 2 < r ** 2;
          const n = (x * 7 + y * 13) % 9;
          data[p] = inside ? 210 : 110 + n;
          data[p + 1] = inside ? 40 : 130 + n;
          data[p + 2] = inside ? 40 : 150 + n;
          data[p + 3] = 255;
        }
      }
      return { width: W, height: W, data };
    };
    const big = scene(2048);
    // A quarter of the pixels, timed alongside: the baseline this machine sets right now.
    const small = scene(1024);
    const median = (runs: number[]) => [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)];
    const time = (o: MagicEraseOptions) => {
      const runs = { big: [] as number[], small: [] as number[] };
      magicErase(small, [5, 5], o);
      for (let i = 0; i < 5; i++) {
        for (const size of ["small", "big"] as const) {
          const started = performance.now();
          const c = magicErase(size === "big" ? big : small, [5, 5], o);
          runs[size].push(performance.now() - started);
          expect(c).not.toBeNull();
        }
      }
      return { big: median(runs.big), small: median(runs.small), best: Math.min(...runs.big) };
    };
    const contiguous = time(opts({ tolerance: 32, antiAlias: true }));
    const global = time(opts({ tolerance: 32, antiAlias: true, contiguous: false }));
    console.info(
      `[magic eraser] 2048² anti-aliased: contiguous ${contiguous.best.toFixed(1)}–${contiguous.big.toFixed(1)} ms (best–median; 1024² ${contiguous.small.toFixed(1)}), ` +
        `global ${global.best.toFixed(1)}–${global.big.toFixed(1)} ms (1024² ${global.small.toFixed(1)})`,
    );
    // Linear in the pixel count: four times the pixels cost about four times as much (16× would be
    // quadratic). Relative to the baseline, so a slow or loaded machine does not fail it.
    expect(contiguous.big / contiguous.small).toBeLessThan(10);
    expect(global.big / global.small).toBeLessThan(10);
    // The frame budget in ms (60 on a desktop, with margin), only where a wall clock means something:
    // a shared CI runner is several times slower and noisier than a desktop.
    if (!process.env.CI) {
      expect(contiguous.big).toBeLessThan(100);
      expect(global.big).toBeLessThan(100);
    }
    const c = magicErase(big, [5, 5], opts({ tolerance: 32, antiAlias: true }))!;
    expect(valueAt(c, 5, 5)).toBe(255);
    expect(valueAt(c, 1024, 1024)).toBe(0);
  }, 60_000);
});

describe("background eraser (Photoshop's options)", () => {
  const BLUE: Rgba = [30, 60, 220, 255];
  const YELLOW: Rgba = [240, 220, 40, 255];
  const halves = image(60, 30, (x) => (x < 30 ? BLUE : YELLOW));
  const brush = (o: Partial<BackgroundEraserOptions> = {}): BackgroundEraserOptions => ({
    size: 16,
    hardness: 100,
    spacing: 25,
    tolerance: 20,
    sampling: "once",
    limits: "contiguous",
    ...o,
  });

  test("sampled once: a stroke across the boundary erases only the colour it started on", () => {
    const s = beginBackgroundErase(halves, [15, 15], brush());
    s.to([45, 15]);
    expect(s.sample).toEqual(BLUE);
    const c = s.result()!;
    for (const x of [10, 20, 29]) expect(valueAt(c, x, 15)).toBe(255);
    for (const x of [30, 35, 45]) expect(valueAt(c, x, 15)).toBe(0);
    expect(valueAt(c, 20, 2)).toBe(0); // outside the brush
  });

  test("sampled continuously: the colour under the hotspot changes as it moves", () => {
    const s = beginBackgroundErase(halves, [15, 15], brush({ sampling: "continuous" }));
    s.to([45, 15]);
    expect(s.sample).toEqual(YELLOW);
    const c = s.result()!;
    expect(valueAt(c, 20, 15)).toBe(255);
    expect(valueAt(c, 40, 15)).toBe(255);
  });

  test("background swatch: only the picked colour goes, wherever the hotspot is", () => {
    const s = beginBackgroundErase(halves, [15, 15], brush({ sampling: "swatch", swatch: YELLOW }));
    s.to([45, 15]);
    expect(s.sample).toEqual(YELLOW);
    const c = s.result()!;
    expect(valueAt(c, 20, 15)).toBe(0);
    expect(valueAt(c, 40, 15)).toBe(255);
  });

  test("limits: contiguous stops at a ring the colour does not cross, discontiguous does not", () => {
    // Blue with a yellow ring round a blue spot at (30, 30).
    const ringed = image(60, 60, (x, y) => {
      const d = Math.hypot(x + 0.5 - 30, y + 0.5 - 30);
      return d >= 4 && d < 7 ? YELLOW : BLUE;
    });
    const at = (limits: "contiguous" | "discontiguous") => beginBackgroundErase(ringed, [30, 18], brush({ size: 30, limits })).result()!;
    expect(valueAt(at("contiguous"), 30, 18)).toBe(255);
    expect(valueAt(at("contiguous"), 30, 30)).toBe(0);
    expect(valueAt(at("discontiguous"), 30, 30)).toBe(255);
    expect(valueAt(at("discontiguous"), 30, 25)).toBe(0); // the ring
  });

  test("limits: find edges does not cross a sharp line even when its colour is within the tolerance", () => {
    const lined = image(60, 30, (x) => (x === 30 ? [30, 60, 150, 255] : BLUE));
    const at = (limits: "contiguous" | "findEdges") => beginBackgroundErase(lined, [25, 15], brush({ size: 20, tolerance: 50, limits })).result()!;
    const contiguous = at("contiguous");
    expect(valueAt(contiguous, 30, 15)).toBe(255);
    expect(valueAt(contiguous, 33, 15)).toBe(255);
    const edges = at("findEdges");
    expect(valueAt(edges, 26, 15)).toBe(255);
    expect(valueAt(edges, 30, 15)).toBe(0);
    expect(valueAt(edges, 33, 15)).toBe(0);
  });

  test("protect foreground colour: a colour nearer to it than to the sample is never erased", () => {
    const SKIN: Rgba = [210, 180, 160, 255];
    const GREYISH: Rgba = [200, 200, 200, 255];
    const face = image(60, 30, (x) => (x < 30 ? GREYISH : SKIN));
    const o = brush({ size: 40, tolerance: 50, limits: "discontiguous" });
    const open = beginBackgroundErase(face, [28, 15], o).result()!;
    expect(valueAt(open, 20, 15)).toBe(255);
    expect(valueAt(open, 40, 15)).toBe(255);
    const guarded = beginBackgroundErase(face, [28, 15], { ...o, protect: SKIN }).result()!;
    expect(valueAt(guarded, 20, 15)).toBe(255);
    expect(valueAt(guarded, 40, 15)).toBe(0);
  });

  test("hardness: a hard brush erases fully to its rim, a soft one falls off", () => {
    expect(brushFalloff(0, 10, 100)).toBe(1);
    expect(brushFalloff(9.4, 10, 100)).toBe(1);
    expect(brushFalloff(11, 10, 100)).toBe(0);
    expect(brushFalloff(2, 10, 0)).toBeLessThan(1);
    expect(brushFalloff(5, 10, 50)).toBe(1);
    expect(brushFalloff(7.5, 10, 50)).toBeCloseTo(0.5);
    const c = beginBackgroundErase(halves, [15, 15], brush({ size: 20, hardness: 0 })).result()!;
    expect(valueAt(c, 15, 15)).toBeGreaterThan(200);
    expect(valueAt(c, 22, 15)).toBeGreaterThan(0);
    expect(valueAt(c, 22, 15)).toBeLessThan(valueAt(c, 17, 15));
  });

  test("spacing: dabs far apart leave a soft stroke uneven, close ones even", () => {
    const flat = image(80, 30, () => BLUE);
    const ridge = (spacing: number) => {
      const s = beginBackgroundErase(flat, [10, 15], brush({ size: 20, hardness: 0, spacing, limits: "discontiguous" }));
      s.to([60, 15]);
      const row = Array.from({ length: 21 }, (_, i) => s.coverage[15 * 80 + 20 + i]);
      return Math.max(...row) - Math.min(...row);
    };
    expect(ridge(100)).toBeGreaterThan(150);
    expect(ridge(5)).toBeLessThan(40);
  });

  test("the erased edge keeps the subject's colour, without the background", () => {
    const GREY: Rgba = [128, 128, 128, 255];
    const RED: Rgba = [230, 20, 20, 255];
    const soft = image(12, 6, (x) => (x < 5 ? GREY : x === 5 ? mix(GREY, RED, 0.4) : RED));
    const c = beginBackgroundErase(soft, [3, 3], brush({ size: 8 })).result()!;
    expect(valueAt(c, 3, 3)).toBe(255);
    expect(Math.abs(valueAt(c, 5, 3) / 255 - 0.6)).toBeLessThan(0.03);
    const [r, g, b] = colourAt(c, 5, 3)!;
    expect(r).toBeGreaterThan(215);
    expect(g).toBeLessThan(35);
    expect(b).toBeLessThan(35);
    expect(valueAt(c, 7, 3)).toBe(0);
  });

  test("going over the same spot twice does not erase more; nothing erased is no result", () => {
    const soft = beginBackgroundErase(halves, [15, 15], brush({ size: 20, hardness: 0 }));
    const once = valueAt(soft.result(), 22, 15);
    soft.to([15, 16]);
    soft.to([15, 15]);
    expect(valueAt(soft.result(), 22, 15)).toBeLessThanOrEqual(once + 30);
    const nothing = beginBackgroundErase(image(10, 10, () => BLUE), [-50, -50], brush({ size: 4, tolerance: 0 }));
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

describe("live wire: Edge Contrast and Width", () => {
  const W = 120;
  /** A square 30..90, `step` levels darker than the grey round it. */
  const square = (step: number) =>
    image(W, W, (x, y) => {
      const v = x >= 30 && x < 90 && y >= 30 && y < 90 ? 180 - step : 180;
      return [v, v, v, 255];
    });
  const pairs = (p: Int32Array) => Array.from({ length: p.length / 2 }, (_, i) => [p[i * 2], p[i * 2 + 1]] as Vec2);
  const nearCorner = (p: Int32Array) => Math.min(...pairs(p).map(([x, y]) => Math.hypot(x - 30, y - 30)));

  test("contrast is about the step, in levels, across an edge", () => {
    const map = computeCostMap(square(40).data, W, W);
    const at = Math.max(map.contrast[60 * W + 29], map.contrast[60 * W + 30]);
    expect(Math.abs(at - 40)).toBeLessThanOrEqual(4);
    expect(map.contrast[60 * W + 60]).toBe(0);
    expect(contrastLevels(10)).toBe(26);
    expect(contrastLevels(100)).toBe(255);
  });

  test("an edge fainter than the Edge Contrast neither snaps the point nor pulls the path", () => {
    const map = computeCostMap(square(15).data, W, W);
    expect(snapToEdge(map, [34, 60], 8, contrastLevels(10))).toEqual([34, 60]);
    const [sx] = snapToEdge(map, [34, 60], 8, contrastLevels(3));
    expect(sx === 29 || sx === 30).toBe(true);
    // Low contrast: round the square's corner; high: straight across.
    expect(nearCorner(findPath(map, [30, 70], [70, 30], { contrast: contrastLevels(3) }).points)).toBeLessThanOrEqual(2);
    expect(nearCorner(findPath(map, [30, 70], [70, 30], { contrast: contrastLevels(10) }).points)).toBeGreaterThan(20);
  });

  test("Width: the path keeps within the corridor round the pointer's way", () => {
    const map = computeCostMap(square(150).data, W, W);
    // The pointer went straight across: the path cannot reach the corner.
    const across = findPath(map, [30, 70], [70, 30], { corridor: { points: [30, 70, 70, 30], radius: 6 } });
    expect(across.straight).toBe(false);
    for (const [x, y] of pairs(across.points)) expect(Math.abs(x + y - 100) / Math.SQRT2).toBeLessThanOrEqual(7);
    // The pointer went round the corner: so does the path, on the edge.
    const round = findPath(map, [30, 70], [70, 30], { corridor: { points: [30, 70, 30, 30, 70, 30], radius: 6 } });
    expect(nearCorner(round.points)).toBeLessThanOrEqual(2);
  });
});

describe("magnetic lasso", () => {
  const W = 200;
  const picture = image(W, W, (x, y) => (x >= 40 && x < 160 && y >= 40 && y < 160 ? [200, 40, 40, 255] : [230, 230, 230, 255]));

  async function lasso(overrides: { width?: number; spacing?: number; contrast?: number } = {}, source = picture) {
    const backend = createLocalLiveWire();
    await backend.prepare(source);
    const onChange = vi.fn();
    const m = createMagneticLasso(backend, {
      width: () => overrides.width ?? 4,
      contrast: () => overrides.contrast ?? contrastLevels(10),
      spacing: () => overrides.spacing ?? 100,
      onChange,
    });
    return { m, onChange };
  }

  test("Frequency sets how far apart the automatic fastening points are", () => {
    expect(fasteningSpacing(0)).toBe(Infinity);
    expect(fasteningSpacing(100)).toBeCloseTo(12, 5);
    expect(Math.abs(fasteningSpacing(57) - 49)).toBeLessThan(2);
    for (let f = 2; f <= 100; f++) expect(fasteningSpacing(f)).toBeLessThan(fasteningSpacing(f - 1));
  });

  test("traced half way round and closed: the outline goes round the square along its edge", async () => {
    const { m } = await lasso({ spacing: Infinity });
    await m.click([42, 100]); // snaps onto the left edge
    expect(m.state.anchors[0][0]).toBeGreaterThanOrEqual(39);
    expect(m.state.anchors[0][0]).toBeLessThanOrEqual(40);
    // The pointer goes down the left side, along the bottom and up the right side.
    for (let y = 104; y <= 158; y += 3) m.move([41, y]);
    for (let x = 44; x <= 158; x += 3) m.move([x, 158]);
    for (let y = 155; y >= 100; y -= 3) m.move([158, y]);
    await m.idle();
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

  test("tracing drops fastening points every ~spacing; Backspace takes one back; Esc clears", async () => {
    const { m, onChange } = await lasso({ spacing: 100 });
    await m.click([40, 150]);
    for (let y = 148; y >= 40; y -= 4) m.move([40, y]);
    for (let x = 44; x <= 150; x += 4) m.move([x, 40]);
    await m.idle();
    // The pointer went ~220 px along the edge: at least one automatic point.
    expect(m.state.anchors.length).toBeGreaterThanOrEqual(2);
    for (const seg of m.state.segments) expect(pathLength(seg)).toBeLessThanOrEqual(140);
    expect(onChange).toHaveBeenCalled();
    const n = m.state.anchors.length;
    m.removeLast();
    expect(m.state.anchors.length).toBe(n - 1);
    m.cancel();
    expect(m.state.anchors).toEqual([]);
    expect(await m.close()).toBeNull();
  });

  test("Frequency 0: points only where clicked", async () => {
    const { m } = await lasso({ spacing: Infinity });
    await m.click([40, 150]);
    for (let y = 148; y >= 40; y -= 4) m.move([40, y]);
    for (let x = 44; x <= 150; x += 4) m.move([x, 40]);
    await m.idle();
    expect(m.state.anchors).toHaveLength(1);
    expect(pathLength(m.state.live!)).toBeGreaterThan(200);
  });

  test("moves made while the first point is still being placed are followed once it lands", async () => {
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

  test("Alt: straight segments, back to the edge when it is let go", async () => {
    const { m } = await lasso();
    await m.click([40, 150]);
    // Straight across the square's inside, not round its edge.
    m.move([100, 100], { straight: true });
    const live = m.state.live!;
    const [ax, ay] = m.state.anchors[0];
    const len = Math.hypot(100 - ax, 100 - ay);
    for (const [x, y] of Array.from({ length: live.length / 2 }, (_, i) => [live[i * 2], live[i * 2 + 1]])) {
      expect(Math.abs((100 - ay) * (x - ax) - (100 - ax) * (y - ay)) / len).toBeLessThanOrEqual(1);
    }
    await m.click([100, 100], { straight: true });
    expect(m.state.anchors[1]).toEqual([100, 100]);
    // Without Alt, the next move is magnetic again: on the edge.
    m.move([158, 100]);
    await m.idle();
    const back = m.state.live!;
    expect(Math.abs(back[back.length - 2] + 0.5 - 160)).toBeLessThanOrEqual(1);
    const outline = (await m.close({ straight: true }))!;
    expect(outline[outline.length - 1]).not.toBeUndefined();
  });

  test("Width: the strongest edge is sought only that far from the pointer", async () => {
    // A mild step at x = 50 and a strong one at x = 60, both vertical.
    const steps = image(W, W, (x) => (x < 50 ? [120, 120, 120, 255] : x < 60 ? [180, 180, 180, 255] : [20, 20, 20, 255]));
    const narrow = await lasso({ width: 4 }, steps);
    await narrow.m.click([50, 20]);
    narrow.m.move([50, 120]);
    await narrow.m.idle();
    const a = narrow.m.state.live!;
    expect(Math.abs(a[a.length - 2] - 49.5)).toBeLessThanOrEqual(1.5);
    const wide = await lasso({ width: 16 }, steps);
    await wide.m.click([50, 20]);
    wide.m.move([50, 120]);
    await wide.m.idle();
    const b = wide.m.state.live!;
    expect(Math.abs(b[b.length - 2] - 59.5)).toBeLessThanOrEqual(1.5);
  });

  test("without a backend it is a polygon lasso: straight segments between clicks", async () => {
    const m = createMagneticLasso(null, { width: () => 4, contrast: () => 26, spacing: () => Infinity, onChange: () => {} });
    await m.click([10, 10]);
    await m.click([100, 10]);
    await m.click([100, 100]);
    expect(m.state.segments.map((s) => [s[0], s[1], s[s.length - 2], s[s.length - 1]])).toEqual([[10, 10, 100, 10], [100, 10, 100, 100]]);
    const outline = (await m.close())!;
    expect(outline[0]).toEqual([10, 10]);
    expect(outline).toContainEqual([100, 10]);
    expect(outline).toContainEqual([100, 100]);
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

  test("Photoshop's defaults", () => {
    const o = open().uiState.cutoutOptions;
    expect(o).toMatchObject({ magicTolerance: 32, magicAntiAlias: true, contiguous: true, magicOpacity: 100, sampleSize: 1 });
    expect(o).toMatchObject({ eraserTolerance: 50, sampling: "continuous", limits: "contiguous", eraserSpacing: 25, protectForeground: false });
    expect(o).toMatchObject({ edgeWidth: 10, edgeContrast: 10, frequency: 57, selectionAntiAlias: true });
  });

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

  test("anti-alias off makes a hard-edged selection op", () => {
    const store = open();
    store.uiState.cutoutOptions.selectionAntiAlias = false;
    store.uiState.selection = { points: [[0, 0], [10.5, 0], [10.5, 10]], inverted: false };
    store.applySelection("erase");
    expect(store.mediaState.mask.strokes[0]).toMatchObject({ kind: "polygon", antiAlias: false });
    const hard = selectionCoverage([[0.7, 0], [10.7, 0], [10.7, 10], [0.7, 10]], 0, 20, 20, 1, false)!;
    expect(new Set(hard.data)).toEqual(new Set([0, 255]));
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

  test("select all and deselect", () => {
    const store = open();
    expect(store.selectAll()).toBe(false);
    store.uiState.mediaSize = [300, 200];
    expect(store.selectAll()).toBe(true);
    expect(store.uiState.selection).toEqual({ points: [[0, 0], [300, 0], [300, 200], [0, 200]], inverted: false });
    const seq = store.uiState.deselectSeq;
    store.deselect();
    expect(store.uiState.selection).toBeNull();
    expect(store.uiState.deselectSeq).toBe(seq + 1);
    expect(store.mediaState.history).toHaveLength(0);
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
    // Only padding: the erased column beside the red takes the red, against filtering bleed.
    const pads = Array.from(raster!.colour!).filter((_, i) => i % 2 === 0);
    expect(pads.length).toBe(50);
    for (const i of pads) expect(i % 60).toBe(59);
    store.undo();
    expect(store.mediaState.mask.strokes).toHaveLength(0);
    store.redo();
    expect(store.mediaState.mask.strokes).toHaveLength(1);
    // Nothing to erase outside the image.
    expect(store.magicErase([-10, 5])).toBe(false);
    expect(store.mediaState.history).toHaveLength(1);
  });

  test("a soft edge's decontaminated colours travel with the eraser's raster", () => {
    const store = open();
    const GREY: Rgba = [128, 128, 128, 255];
    const RED: Rgba = [230, 20, 20, 255];
    store.setWorkingImage({ ...image(20, 10, (x) => (x < 8 ? GREY : x === 8 ? mix(GREY, RED, 0.5) : RED)), scale: 1 });
    store.magicErase([2, 2]);
    const op = store.mediaState.mask.strokes[0];
    const raster = op.kind === "raster" ? store.getMaskSource(op.raster)! : null;
    expect(raster!.colour).toBeInstanceOf(Uint32Array);
    // The raster's box starts at the image's corner here: its pixel (8, 2) is the image's.
    expect(op).toMatchObject({ points: [[0, 0], [9, 10]] });
    const at = 2 * raster!.width + 8;
    const k = Array.from(raster!.colour!).findIndex((v, i) => i % 2 === 0 && v === at);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(raster!.colour![k + 1] >>> 16).toBeGreaterThan(215);
    expect(raster!.data[at]).toBeGreaterThan(110);
    expect(raster!.data[at]).toBeLessThan(145);
  });

  test("picking a colour from the working image", () => {
    const store = open();
    expect(store.pickColourAt([1, 1])).toBeNull();
    store.setWorkingImage({ ...image(4, 4, () => [255, 128, 0, 255]), scale: 0.5 });
    expect(store.pickColourAt([2, 2])).toBe("#ff8000");
    expect(store.pickColourAt([100, 2])).toBeNull();
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
    store.uiState.cutoutOptions.magicTolerance = 100;
    expect(store.mediaState.history).toHaveLength(0);
    expect(store.hasModifications).toBe(false);
    store.init({ src: "blob:y", type: "image", mode: "sticker" });
    expect(store.uiState.cutoutTool).toBeNull();
    expect(store.uiState.selection).toBeNull();
    expect(store.uiState.cutoutOptions.magicTolerance).toBe(32);
    expect(store.getWorkingImage()).toBeNull();
  });
});
