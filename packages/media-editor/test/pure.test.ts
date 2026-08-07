/**
 * The editor's pure maths: colour, geometry, tweening and comparison.
 *
 * These sit under every slider and crop handle. Nothing here touches a canvas, so the
 * tests are exact — and exactness is the point: an off-by-one in a hue or an inverted
 * aspect fit is invisible in code review and obvious on screen.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { parseHexColor, hexToHsl, contrastingTextColor, hexToRgbaTuple } from "../src/color";
import {
  clamp, mix, mixArray, remap, pointDistance, rotatePoint,
  fitToAspectRatio, computeViewportScaleRatio,
} from "../src/geometry";
import { easeOutCubic, tween } from "../src/animation";
import { deepEqualApprox, omitKeys, touchDeep } from "../src/comparison";
import { ADJUSTMENTS, adjustmentKeys, adjustmentsConfig } from "../src/adjustments";

describe("colour parsing", () => {
  test("reads six-digit hex with or without the hash", () => {
    expect(parseHexColor("#3b82f6")).toEqual({ r: 0x3b, g: 0x82, b: 0xf6, a: 1 });
    expect(parseHexColor("3b82f6")).toEqual({ r: 0x3b, g: 0x82, b: 0xf6, a: 1 });
  });

  test("expands the three-digit shorthand", () => {
    expect(parseHexColor("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseHexColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
  });

  test("reads the alpha byte as a 0–1 fraction", () => {
    expect(parseHexColor("#ff000080").a).toBeCloseTo(128 / 255, 5);
    expect(parseHexColor("#ff0000ff").a).toBe(1);
    expect(parseHexColor("#ff000000").a).toBe(0);
  });

  test("colours without alpha are fully opaque", () => {
    expect(parseHexColor("#000000").a).toBe(1);
  });

  test("the rgba tuple keeps channels in 0–255 and alpha in 0–1", () => {
    // Canvas and WebGPU disagree about alpha's range; this one is normalised.
    const [r, g, b, a] = hexToRgbaTuple("#ff800080");
    expect([r, g, b]).toEqual([255, 128, 0]);
    expect(a).toBeLessThanOrEqual(1);
  });
});

describe("hexToHsl", () => {
  test("greys have no hue and no saturation", () => {
    expect(hexToHsl("#000000")).toMatchObject({ h: 0, s: 0, l: 0 });
    expect(hexToHsl("#ffffff")).toMatchObject({ h: 0, s: 0, l: 100 });
  });

  test("primaries land on their standard hues", () => {
    expect(hexToHsl("#ff0000").h).toBeCloseTo(0, 4);
    expect(hexToHsl("#00ff00").h).toBeCloseTo(120, 4);
    expect(hexToHsl("#0000ff").h).toBeCloseTo(240, 4);
  });

  test("hue wraps rather than going negative", () => {
    // Magenta sits past blue; a missing +6 term would report it as -60.
    expect(hexToHsl("#ff00ff").h).toBeCloseTo(300, 4);
    expect(hexToHsl("#ff0080").h).toBeGreaterThan(0);
  });

  test("carries alpha through", () => {
    expect(hexToHsl("#ff000080").a).toBeCloseTo(128 / 255, 5);
  });
});

describe("contrastingTextColor", () => {
  test("white on dark, black on light", () => {
    expect(contrastingTextColor("#000000")).toBe("#ffffff");
    expect(contrastingTextColor("#101010")).toBe("#ffffff");
    expect(contrastingTextColor("#ffffff")).toBe("#000000");
  });

  test("switches on lightness, not on hue", () => {
    // A saturated yellow is light; a saturated blue of the same hue angle is not.
    expect(contrastingTextColor("#ffff00")).toBe("#ffffff");
    expect(contrastingTextColor("#fffff0")).toBe("#000000");
  });
});

describe("geometry", () => {
  test("clamp holds a value inside its interval", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  test("mix interpolates and hits both ends exactly", () => {
    expect(mix(0, 10, 0)).toBe(0);
    expect(mix(0, 10, 1)).toBe(10);
    expect(mix(0, 10, 0.25)).toBe(2.5);
  });

  test("mixArray interpolates element-wise", () => {
    expect(mixArray([0, 10], [10, 20], 0.5)).toEqual([5, 15]);
  });

  test("remap moves a value between ranges, including inverted ones", () => {
    expect(remap(50, 0, 100, 0, 1)).toBe(0.5);
    expect(remap(0, -100, 100, 0, 1)).toBe(0.5);
    expect(remap(0, 0, 100, 1, 0)).toBe(1);
  });

  test("pointDistance is symmetric and zero for a point on itself", () => {
    expect(pointDistance([0, 0], [3, 4])).toBe(5);
    expect(pointDistance([3, 4], [0, 0])).toBe(5);
    expect(pointDistance([2, 2], [2, 2])).toBe(0);
  });

  test("rotatePoint turns counter-clockwise and preserves length", () => {
    const [x, y] = rotatePoint([1, 0], Math.PI / 2);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(1, 10);
    expect(Math.hypot(...rotatePoint([3, 4], 1.234))).toBeCloseTo(5, 10);
  });

  test("a full turn returns the point", () => {
    const [x, y] = rotatePoint([2, -5], Math.PI * 2);
    expect(x).toBeCloseTo(2, 10);
    expect(y).toBeCloseTo(-5, 10);
  });
});

describe("fitToAspectRatio", () => {
  test("fits inside the box on whichever axis binds", () => {
    // Wide box, square target: height binds.
    expect(fitToAspectRatio(1, 400, 200)).toEqual([200, 200]);
    // Tall box, square target: width binds.
    expect(fitToAspectRatio(1, 200, 400)).toEqual([200, 200]);
  });

  test("never exceeds the box it was given", () => {
    for (const ratio of [0.5, 1, 16 / 9, 21 / 9]) {
      const [w, h] = fitToAspectRatio(ratio, 300, 500);
      expect(w).toBeLessThanOrEqual(300 + 1e-9);
      expect(h).toBeLessThanOrEqual(500 + 1e-9);
    }
  });

  test("keeps the requested ratio", () => {
    for (const ratio of [0.5, 1, 16 / 9, 21 / 9]) {
      const [w, h] = fitToAspectRatio(ratio, 640, 480);
      expect(w / h).toBeCloseTo(ratio, 10);
    }
  });

  test("a box already at the ratio is left alone", () => {
    expect(fitToAspectRatio(16 / 9, 1600, 900)).toEqual([1600, 900]);
  });
});

describe("computeViewportScaleRatio", () => {
  test("equal viewports scale by one", () => {
    expect(computeViewportScaleRatio(16 / 9, 800, 600, 800, 600)).toBeCloseTo(1, 10);
  });

  test("a larger viewport reports how much bigger it appears", () => {
    expect(computeViewportScaleRatio(1, 400, 400, 200, 200)).toBeCloseTo(2, 10);
  });

  test("shrinking reports a factor below one", () => {
    expect(computeViewportScaleRatio(1, 100, 100, 200, 200)).toBeCloseTo(0.5, 10);
  });
});

describe("easing and tweening", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("easeOutCubic spans 0 to 1 and decelerates", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    // More distance covered in the first half than the second.
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  test("a scalar tween ends exactly on its target", async () => {
    const seen: number[] = [];
    let done = false;

    tween({ from: 0, to: 100, duration: 100, onUpdate: (v) => seen.push(v), onComplete: () => { done = true; } });
    await vi.advanceTimersByTimeAsync(200);

    expect(done).toBe(true);
    expect(seen.at(-1)).toBe(100);
  });

  test("an array tween interpolates every component", async () => {
    const seen: number[][] = [];

    tween({ from: [0, 10], to: [10, 0], duration: 100, onUpdate: (v) => seen.push(v) });
    await vi.advanceTimersByTimeAsync(200);

    expect(seen.at(-1)).toEqual([10, 0]);
  });

  test("cancelling stops updates and suppresses completion", async () => {
    const onUpdate = vi.fn();
    const onComplete = vi.fn();

    const handle = tween({ from: 0, to: 1, duration: 100, onUpdate, onComplete });
    handle.cancel();
    await vi.advanceTimersByTimeAsync(200);

    expect(onComplete).not.toHaveBeenCalled();
  });

  test("a custom easing is used instead of the default", async () => {
    const easing = vi.fn((t: number) => t);

    tween({ from: 0, to: 1, duration: 50, easing, onUpdate: () => {} });
    await vi.advanceTimersByTimeAsync(100);

    expect(easing).toHaveBeenCalled();
  });
});

describe("deepEqualApprox", () => {
  test("numbers compare within tolerance", () => {
    expect(deepEqualApprox(1, 1.0005)).toBe(true);
    expect(deepEqualApprox(1, 1.5)).toBe(false);
  });

  test("tolerance applies inside nested structures", () => {
    // Slider values arrive as floats; exact equality would report a change on every
    // repaint and re-render the whole preview.
    expect(deepEqualApprox({ a: [1, 2.0001] }, { a: [1, 2] })).toBe(true);
    expect(deepEqualApprox({ a: [1, 2.5] }, { a: [1, 2] })).toBe(false);
  });

  test("arrays of different length differ", () => {
    expect(deepEqualApprox([1, 2], [1, 2, 3])).toBe(false);
  });

  test("a key present on only one side is a difference", () => {
    expect(deepEqualApprox({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  test("identical primitives and mismatched types", () => {
    expect(deepEqualApprox("x", "x")).toBe(true);
    expect(deepEqualApprox("x", "y")).toBe(false);
    expect(deepEqualApprox(1, "1")).toBe(false);
  });
});

describe("omitKeys", () => {
  test("removes the listed keys and leaves the original alone", () => {
    const source = { a: 1, b: 2, c: 3 };
    expect(omitKeys(source, ["b"])).toEqual({ a: 1, c: 3 });
    expect(source).toEqual({ a: 1, b: 2, c: 3 });
  });

  test("omitting nothing, or something absent, is harmless", () => {
    expect(omitKeys({ a: 1 }, [])).toEqual({ a: 1 });
    expect(omitKeys({ a: 1 }, ["zz" as never])).toEqual({ a: 1 });
  });
});

describe("touchDeep", () => {
  test("walks nested structures without throwing", () => {
    expect(() => touchDeep({ a: [1, { b: [2, 3] }], c: "x" })).not.toThrow();
    expect(() => touchDeep(null)).not.toThrow();
  });
});

describe("the adjustments table", () => {
  test("every adjustment declares a shader uniform and a label", () => {
    for (const key of adjustmentKeys) {
      const def = ADJUSTMENTS[key];
      expect(def.uniform, key).toMatch(/^u[A-Z]/);
      expect(def.labelKey, key).toMatch(/^media_editor_/);
      expect(def.icon, key).toBeTruthy();
    }
  });

  test("uniform names are unique — a collision would silently share a slider", () => {
    const uniforms = adjustmentKeys.map((k) => ADJUSTMENTS[k].uniform);
    expect(new Set(uniforms).size).toBe(uniforms.length);
  });

  test("ranges are either unipolar or symmetric bipolar, nothing else", () => {
    for (const key of adjustmentKeys) {
      const [min, max] = ADJUSTMENTS[key].range;
      expect([0, -100], key).toContain(min);
      expect(max, key).toBe(100);
    }
  });

  test("to100 marks exactly the unipolar effects", () => {
    for (const entry of adjustmentsConfig) {
      expect(entry.to100, entry.key).toBe(ADJUSTMENTS[entry.key].range[0] === 0);
    }
  });

  test("the ordered list matches the table", () => {
    expect(adjustmentsConfig.map((e) => e.key)).toEqual(adjustmentKeys);
    expect(adjustmentKeys.sort()).toEqual(Object.keys(ADJUSTMENTS).sort());
  });
});
