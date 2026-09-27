/**
 * Sticker mode's CPU-side maths and state: the export presets, premultiplied alpha, the mask
 * (feathering, compositing, canvas ↔ source mapping), the outline's parameters and how all of it
 * goes through undo / redo.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  computeExportDimensions,
  computeExpressionLayout,
  fitExpressionContent,
  EXPRESSION_EXPORT_PRESETS,
} from "../src/finalRender/computeExportDimensions";
import {
  applyMaskToRgba,
  canvasToSource,
  featherMask,
  jfaSteps,
  maskResolution,
  mixPremultiplied,
  outlineCoverage,
  outlineRadiusOnCanvas,
  premultiply,
  sourceToCanvas,
  unpremultiply,
  OUTLINE_MAX_RADIUS,
  type Rgba,
} from "../src/mask/maskMath";
import { resampleMaskNearestArea } from "../src/mask/maskRaster";
import { useMediaEditorStore, REMOVE_ARRAY_ITEM } from "../src/store/editorStore";
import { isExpressionMode, isMaskBrush, type RenderTransform, type Vec2 } from "../src/types";

describe("expression export presets", () => {
  test("a sticker's longer side is exactly 512 and the other keeps the aspect, unpadded", () => {
    expect(fitExpressionContent("sticker", 1)).toEqual([512, 512]);
    expect(fitExpressionContent("sticker", 2)).toEqual([512, 256]);
    expect(fitExpressionContent("sticker", 0.5)).toEqual([256, 512]);
    expect(fitExpressionContent("sticker", 16 / 9)).toEqual([512, 288]);
    expect(computeExpressionLayout("sticker", 2)).toEqual({ canvas: [512, 256], content: { x: 0, y: 0, width: 512, height: 256 } });
  });

  test("a sliver never collapses to zero pixels", () => {
    expect(fitExpressionContent("sticker", 1000)).toEqual([512, 1]);
    expect(fitExpressionContent("sticker", 0.001)).toEqual([1, 512]);
  });

  test("an emoji fits inside 100×100 and the file is always 100×100, centred", () => {
    expect(computeExpressionLayout("emoji", 1)).toEqual({ canvas: [100, 100], content: { x: 0, y: 0, width: 100, height: 100 } });
    expect(computeExpressionLayout("emoji", 2)).toEqual({ canvas: [100, 100], content: { x: 0, y: 25, width: 100, height: 50 } });
    expect(computeExpressionLayout("emoji", 0.25)).toEqual({ canvas: [100, 100], content: { x: 37, y: 0, width: 25, height: 100 } });
    expect(EXPRESSION_EXPORT_PRESETS.emoji).toEqual({ box: 100, pad: true });
  });

  test("an unusable ratio falls back to square", () => {
    expect(fitExpressionContent("sticker", 0)).toEqual([512, 512]);
    expect(fitExpressionContent("emoji", Number.NaN)).toEqual([100, 100]);
  });

  test("computeExportDimensions: the expression modes ignore source size and zoom", () => {
    const base = { sourceWidth: 4000, sourceAspectRatio: 4 / 3, cropAreaSize: { width: 800, height: 600 }, zoomScale: 3 };
    expect(computeExportDimensions({ ...base, cropAspectRatio: 4 / 3, outputMode: "sticker" })).toEqual([512, 384]);
    expect(computeExportDimensions({ ...base, cropAspectRatio: 1, outputMode: "emoji" })).toEqual([100, 100]);
    // The ordinary export is untouched: large, and even for the encoders.
    const [w, h] = computeExportDimensions({ ...base, cropAspectRatio: 4 / 3 });
    expect(w % 2).toBe(0);
    expect(h % 2).toBe(0);
    expect(Math.max(w, h)).toBeLessThanOrEqual(2560);
  });
});

describe("premultiplied alpha", () => {
  const close = (a: Rgba, b: Rgba) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

  test("premultiply scales colour by alpha; unpremultiply undoes it", () => {
    close(premultiply([1, 0.5, 0.25, 0.5]), [0.5, 0.25, 0.125, 0.5]);
    close(unpremultiply([0.5, 0.25, 0.125, 0.5]), [1, 0.5, 0.25, 0.5]);
  });

  test("a fully transparent pixel has no colour to recover", () => {
    close(unpremultiply([0.3, 0.3, 0.3, 0]), [0, 0, 0, 0]);
  });

  test("unpremultiply clamps what spatial passes push past alpha", () => {
    close(unpremultiply([0.8, 0.2, 0.1, 0.5]), [1, 0.4, 0.2, 0.5]);
  });

  test("filtering between opaque red and transparent black keeps red: no dark fringe", () => {
    const red: Rgba = [1, 0, 0, 1];
    const clear: Rgba = [0, 0, 0, 0];
    close(mixPremultiplied(red, clear, 0.5), [1, 0, 0, 0.5]);
    // What straight-alpha filtering would have given: half-brightness red.
    const naive = red.map((v, i) => v + (clear[i] - v) * 0.5);
    expect(naive[0]).toBeCloseTo(0.5);
  });
});

describe("mask", () => {
  test("resolution follows the source up to 2048 on the long side", () => {
    expect(maskResolution(800, 600)).toEqual([800, 600]);
    expect(maskResolution(4096, 2048)).toEqual([2048, 1024]);
    expect(maskResolution(1000, 5000)).toEqual([410, 2048]);
  });

  test("applyMaskToRgba scales alpha only", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 128]);
    const out = applyMaskToRgba(rgba, new Uint8Array([0, 255]));
    expect(Array.from(out)).toEqual([10, 20, 30, 0, 40, 50, 60, 128]);
    expect(Array.from(applyMaskToRgba(rgba, new Uint8Array([128, 128])))).toEqual([10, 20, 30, 128, 40, 50, 60, 64]);
  });

  test("feathering keeps flat regions and ramps the edge around its midpoint", () => {
    const w = 40;
    const h = 8;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 20; x < w; x++) mask[y * w + x] = 255;
    const soft = featherMask(mask, w, h, 6);
    const row = Array.from(soft.subarray(4 * w, 5 * w));
    expect(row[0]).toBe(0);
    expect(row[w - 1]).toBe(255);
    for (let x = 1; x < w; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]);
    // The ramp straddles the old edge: it has started before it and not finished after it.
    expect(row[18]).toBeGreaterThan(0);
    expect(row[21]).toBeLessThan(255);
    expect(Math.abs(row[19] + row[20] - 255)).toBeLessThanOrEqual(2);
  });

  test("feather 0 is a copy, not the same buffer", () => {
    const mask = new Uint8Array([0, 255, 0, 255]);
    const out = featherMask(mask, 2, 2, 0);
    expect(out).not.toBe(mask);
    expect(Array.from(out)).toEqual([0, 255, 0, 255]);
  });

  test("resampling a mask: area average down, nearest up", () => {
    const src = new Uint8Array([0, 255, 255, 255]);
    expect(Array.from(resampleMaskNearestArea(src, 2, 2, 1, 1))).toEqual([191]);
    expect(Array.from(resampleMaskNearestArea(new Uint8Array([0, 255]), 2, 1, 4, 1))).toEqual([0, 0, 255, 255]);
  });
});

describe("canvas ↔ source mapping", () => {
  const viewport: Vec2 = [1000, 800];
  const image: Vec2 = [400, 300];

  test("the image centre lands on the viewport centre plus the translation", () => {
    const t: RenderTransform = { scale: 2, rotation: 0.3, flip: [1, 1], translation: [15, -20] };
    const [x, y] = sourceToCanvas([200, 150], t, viewport, image);
    expect(x).toBeCloseTo(515);
    expect(y).toBeCloseTo(380);
  });

  test("scale and flip act about the centre", () => {
    const t: RenderTransform = { scale: 2, rotation: 0, flip: [-1, 1], translation: [0, 0] };
    // 10 px right of centre in the source → 20 px left of centre on the canvas.
    const [x, y] = sourceToCanvas([210, 150], t, viewport, image);
    expect(x).toBeCloseTo(480);
    expect(y).toBeCloseTo(400);
  });

  test("canvasToSource inverts sourceToCanvas under any rotation, flip and zoom", () => {
    for (const t of [
      { scale: 1.7, rotation: 0.9, flip: [1, -1], translation: [33, 12] },
      { scale: 0.4, rotation: -2.1, flip: [-1, -1], translation: [-80, 5] },
      { scale: 3, rotation: Math.PI / 2, flip: [1, 1], translation: [0, 0] },
    ] as RenderTransform[]) {
      for (const p of [[0, 0], [400, 300], [123.5, 77.25]] as Vec2[]) {
        const back = canvasToSource(sourceToCanvas(p, t, viewport, image), t, viewport, image);
        expect(back[0]).toBeCloseTo(p[0], 6);
        expect(back[1]).toBeCloseTo(p[1], 6);
      }
    }
  });
});

describe("outline parameters", () => {
  test("a radius in output pixels becomes canvas pixels by the ratio of the two scales", () => {
    // Canvas shows 3 device px per source px; the 512 export has 1.5 per source px.
    expect(outlineRadiusOnCanvas(8, 3, 1.5)).toBe(16);
    expect(outlineRadiusOnCanvas(0, 3, 1.5)).toBe(0);
    expect(outlineRadiusOnCanvas(8, 3, 0)).toBe(0);
  });

  test("jump-flood steps halve down to 1, reach the distance, and end with an extra 1", () => {
    expect(jfaSteps(0)).toEqual([]);
    expect(jfaSteps(1)).toEqual([1, 1]);
    expect(jfaSteps(10)).toEqual([8, 4, 2, 1, 1]);
    expect(jfaSteps(26)).toEqual([16, 8, 4, 2, 1, 1]);
    for (const d of [3, 7, 24, 100, 255]) {
      const steps = jfaSteps(d);
      const reach = steps.slice(0, -1).reduce((a, b) => a + b, 0);
      expect(reach).toBeGreaterThanOrEqual(d);
      // And no longer than needed: starting at half the step would fall short.
      expect(reach - steps[0]).toBeLessThan(d);
    }
  });

  test("coverage is full inside the radius and ramps over one pixel at its edge", () => {
    expect(outlineCoverage(0, 8)).toBe(1);
    expect(outlineCoverage(8, 8)).toBe(1);
    expect(outlineCoverage(8.5, 8)).toBeCloseTo(0.5);
    expect(outlineCoverage(9, 8)).toBe(0);
    expect(outlineCoverage(3, 0)).toBe(0);
  });
});

describe("editor state in the sticker modes", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function open(mode: "sticker" | "emoji" | "full" = "sticker") {
    const store = useMediaEditorStore();
    store.init({ src: "blob:x", type: "image", mode });
    return store;
  }

  test("the modes are told apart", () => {
    expect(isExpressionMode("sticker")).toBe(true);
    expect(isExpressionMode("emoji")).toBe(true);
    expect(isExpressionMode("avatar")).toBe(false);
    expect(isMaskBrush("maskErase")).toBe(true);
    expect(isMaskBrush("eraser")).toBe(false);
  });

  test("a sticker can always be finished: it is re-encoded at its preset even untouched", () => {
    expect(open("sticker").canFinish).toBe(true);
    expect(open("emoji").canFinish).toBe(true);
    expect(open("full").canFinish).toBe(false);
  });

  test("outline defaults: off, white, 8 px", () => {
    expect(open().mediaState.outline).toEqual({ enabled: false, radius: 8, color: "#ffffff" });
  });

  test("outline changes are undoable one by one; the radius is clamped to whole pixels 0–24", () => {
    const store = open();
    store.setOutline("enabled", true);
    store.setOutline("radius", 30.4);
    store.setOutline("color", "#ff0000");
    expect(store.mediaState.outline).toEqual({ enabled: true, radius: OUTLINE_MAX_RADIUS, color: "#ff0000" });

    store.setOutline("radius", -3);
    expect(store.mediaState.outline.radius).toBe(0);
    store.setOutline("radius", 12.6);
    expect(store.mediaState.outline.radius).toBe(13);

    store.undo();
    expect(store.mediaState.outline.radius).toBe(0);
    store.undo();
    store.undo();
    expect(store.mediaState.outline).toEqual({ enabled: true, radius: OUTLINE_MAX_RADIUS, color: "#ffffff" });
    store.undo();
    store.undo();
    expect(store.mediaState.outline).toEqual({ enabled: false, radius: 8, color: "#ffffff" });
    store.redo();
    expect(store.mediaState.outline.enabled).toBe(true);
    expect(store.hasModifications).toBe(true);
  });

  test("setting a value to what it is records nothing", () => {
    const store = open();
    store.setOutline("radius", 8);
    store.setMaskFeather(0);
    store.setMaskSource(null);
    expect(store.mediaState.history).toHaveLength(0);
  });

  test("mask source, strokes and feather go through the history; reset is one step", () => {
    const store = open();
    const raster = { width: 2, height: 1, data: new Uint8Array([0, 255]) };
    const id = store.addMaskSource(raster);
    store.setMaskSource(id);
    expect(store.getMaskSource(store.mediaState.mask.source)).toBe(raster);

    const stroke = { mode: "erase" as const, size: 4, points: [[1, 1], [2, 2]] as Vec2[] };
    store.addMaskStroke(stroke);
    store.setMaskFeather(3.4);
    expect(store.mediaState.mask).toMatchObject({ source: id, feather: 3, strokes: [stroke] });
    expect(store.mediaState.history.at(-2)).toMatchObject({ path: ["mask", "strokes", 0], oldValue: REMOVE_ARRAY_ITEM });

    store.resetMask();
    expect(store.mediaState.mask).toEqual({ source: null, feather: 0, strokes: [] });
    store.undo();
    expect(store.mediaState.mask).toMatchObject({ source: id, feather: 3 });
    expect(store.mediaState.mask.strokes).toHaveLength(1);

    store.undo(); // feather
    store.undo(); // stroke
    expect(store.mediaState.mask.strokes).toHaveLength(0);
    store.undo(); // source
    expect(store.mediaState.mask.source).toBeNull();

    store.redo();
    store.redo();
    expect(store.mediaState.mask.source).toBe(id);
    expect(store.mediaState.mask.strokes).toEqual([stroke]);
  });

  test("a state saved before outline and mask existed opens with their defaults", () => {
    const store = useMediaEditorStore();
    store.init({ src: "blob:x", type: "image", mode: "sticker" });
    const old = JSON.parse(JSON.stringify(store.mediaState)) as Record<string, unknown>;
    delete old.outline;
    delete old.mask;
    store.setOutline("enabled", true);
    store.init({ src: "blob:y", type: "image", mode: "sticker", initialState: old as never });
    expect(store.mediaState.outline.enabled).toBe(false);
    expect(store.mediaState.mask).toEqual({ source: null, feather: 0, strokes: [] });
  });

  describe("background removal", () => {
    beforeEach(() => {
      vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4, height: 2, close: vi.fn() })));
    });

    test("the remover gets the mask size and its result becomes the mask's base, undoably", async () => {
      const store = open();
      store.uiState.mediaSize = [4000, 2000];
      const remover = vi.fn(async (input: { width: number; height: number }, options?: { onProgress?: (v: number) => void }) => {
        options?.onProgress?.(0.5);
        expect(store.uiState.backgroundRemoval).toEqual({ status: "running", progress: 0.5 });
        return { width: input.width, height: input.height, data: new Uint8Array(input.width * input.height) };
      });
      expect(await store.removeBackground(remover, {} as ImageBitmapSource)).toBe(true);
      expect(remover.mock.calls[0][0]).toMatchObject({ width: 2048, height: 1024 });
      expect(store.mediaState.mask.source).not.toBeNull();
      expect(store.getMaskSource(store.mediaState.mask.source)?.width).toBe(2048);
      expect(store.uiState.backgroundRemoval.status).toBe("idle");
      store.undo();
      expect(store.mediaState.mask.source).toBeNull();
    });

    test("cancelled: nothing changes and the state goes back to idle", async () => {
      const store = open();
      store.uiState.mediaSize = [100, 100];
      let signal: AbortSignal | undefined;
      const remover = vi.fn(
        (_input: unknown, options?: { signal?: AbortSignal }) =>
          new Promise<never>((_, reject) => {
            signal = options?.signal;
            signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
          }),
      );
      const run = store.removeBackground(remover, {} as ImageBitmapSource);
      await vi.waitFor(() => expect(remover).toHaveBeenCalled());
      store.cancelBackgroundRemoval();
      expect(await run).toBe(false);
      expect(signal?.aborted).toBe(true);
      expect(store.mediaState.mask.source).toBeNull();
      expect(store.uiState.backgroundRemoval.status).toBe("idle");
      expect(store.mediaState.history).toHaveLength(0);
    });

    test("a failure, or a mask of the wrong size, is reported and changes nothing", async () => {
      const store = open();
      store.uiState.mediaSize = [100, 100];
      vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(await store.removeBackground(async () => ({ width: 10, height: 10, data: new Uint8Array(100) }), {} as ImageBitmapSource)).toBe(false);
      expect(store.uiState.backgroundRemoval.status).toBe("failed");
      expect(await store.removeBackground(async () => { throw new Error("no model"); }, {} as ImageBitmapSource)).toBe(false);
      expect(store.uiState.backgroundRemoval.status).toBe("failed");
      expect(store.mediaState.mask.source).toBeNull();
    });
  });
});
