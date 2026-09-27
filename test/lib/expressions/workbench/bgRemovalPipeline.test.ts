/**
 * Background removal without the model: the image squeezed to 320×320 and standardised exactly as
 * U²-Net expects, the saliency map stretched and brought back to the requested size, and what a
 * (fake) session is handed and gives back.
 */

import { describe, test, expect, vi } from "vitest";
import {
  normalizeSaliency,
  resampleRgba,
  segment,
  toMaskBytes,
  toModelInput,
  upsampleBilinear,
  type SaliencySession,
} from "@/lib/expressions/workbench/bgRemovalPipeline";
import { BG_MODEL } from "@/lib/expressions/workbench/model";

function solid(width: number, height: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) out.set(rgba, i * 4);
  return out;
}

describe("resampleRgba", () => {
  test("the same size is a copy", () => {
    const src = solid(3, 2, [1, 2, 3, 4]);
    const out = resampleRgba(src, 3, 2, 3, 2);
    expect(out).not.toBe(src);
    expect(Array.from(out)).toEqual(Array.from(src));
  });

  test("shrinking averages each block", () => {
    // 4×2 → 2×1: left block black and white, right block all 100.
    const src = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255, 100, 100, 100, 255, 100, 100, 100, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 100, 100, 100, 255, 100, 100, 100, 255,
    ]);
    expect(Array.from(resampleRgba(src, 4, 2, 2, 1))).toEqual([128, 128, 128, 255, 100, 100, 100, 255]);
  });

  test("growing interpolates between pixel centres", () => {
    const src = new Uint8ClampedArray([0, 0, 0, 255, 200, 200, 200, 255]);
    const row = resampleRgba(src, 2, 1, 4, 1);
    const reds = [0, 1, 2, 3].map((i) => row[i * 4]);
    expect(reds).toEqual([0, 50, 150, 200]);
  });

  test("a large photo lands on the model's 320×320", () => {
    const out = resampleRgba(solid(1000, 640, [10, 20, 30, 255]), 1000, 640, 320, 320);
    expect(out.length).toBe(320 * 320 * 4);
    expect(Array.from(out.subarray(0, 4))).toEqual([10, 20, 30, 255]);
  });
});

describe("toModelInput", () => {
  test("NCHW planes, scaled by the brightest value, standardised with ImageNet statistics", () => {
    const size = 2;
    // Brightest channel value is 200, so 200 → 1.0 and 100 → 0.5.
    const rgba = new Uint8ClampedArray([200, 100, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 100, 200, 100, 7]);
    const input = toModelInput(rgba, size);
    expect(input.length).toBe(3 * size * size);
    const [mr, mg, mb] = BG_MODEL.mean;
    const [sr, sg, sb] = BG_MODEL.std;
    expect(input[0]).toBeCloseTo((1 - mr) / sr, 5); // R plane, pixel 0
    expect(input[4]).toBeCloseTo((0.5 - mg) / sg, 5); // G plane, pixel 0
    expect(input[8]).toBeCloseTo((0 - mb) / sb, 5); // B plane, pixel 0
    expect(input[3]).toBeCloseTo((0.5 - mr) / sr, 5); // R plane, pixel 3
    expect(input[7]).toBeCloseTo((1 - mg) / sg, 5); // G plane, pixel 3
    // Alpha plays no part: pixel 2 (transparent black) reads as black.
    expect(input[2]).toBeCloseTo((0 - mr) / sr, 5);
  });

  test("an all-black image does not divide by zero", () => {
    const input = toModelInput(new Uint8ClampedArray(4 * 4), 2);
    for (const v of input) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("saliency to mask", () => {
  test("min–max stretched to 0–1", () => {
    expect(Array.from(normalizeSaliency(new Float32Array([2, 4, 6])))).toEqual([0, 0.5, 1]);
  });

  test("a flat map becomes all-or-nothing instead of NaN", () => {
    expect(Array.from(normalizeSaliency(new Float32Array([0.9, 0.9])))).toEqual([1, 1]);
    expect(Array.from(normalizeSaliency(new Float32Array([0.1, 0.1])))).toEqual([0, 0]);
  });

  test("bilinear upsampling with aligned pixel centres keeps the ends and the midpoint", () => {
    const up = upsampleBilinear(new Float32Array([0, 1]), 2, 1, 8, 1);
    expect(up[0]).toBe(0);
    expect(up[7]).toBe(1);
    for (let i = 1; i < 8; i++) expect(up[i]).toBeGreaterThanOrEqual(up[i - 1]);
    expect((up[3] + up[4]) / 2).toBeCloseTo(0.5, 5);
  });

  test("bytes are rounded and clamped", () => {
    expect(Array.from(toMaskBytes(new Float32Array([-0.2, 0.5, 1.4])))).toEqual([0, 128, 255]);
  });
});

describe("segment with a fake session", () => {
  // Salient where the input is bright: returns the R plane as the "saliency", in arbitrary units.
  function fakeSession(): SaliencySession & { calls: { input: Float32Array; dims: readonly number[] }[] } {
    const calls: { input: Float32Array; dims: readonly number[] }[] = [];
    return {
      calls,
      async run(input, dims) {
        calls.push({ input, dims });
        const plane = dims[2] * dims[3];
        return { data: input.slice(0, plane).map((v) => v * 10 + 3), dims: [1, 1, dims[2], dims[3]] };
      },
    };
  }

  function halfBright(width: number, height: number): Uint8ClampedArray {
    // Right half white, left half black.
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = x >= width / 2 ? 255 : 0;
        out.set([v, v, v, 255], (y * width + x) * 4);
      }
    }
    return out;
  }

  test("the session gets [1, 3, 320, 320]; the mask comes back at the requested size", async () => {
    const session = fakeSession();
    const progress: string[] = [];
    const mask = await segment(session, { data: halfBright(640, 480), width: 640, height: 480 }, 200, 100, {
      onProgress: (s) => progress.push(s),
    });
    expect(session.calls[0].dims).toEqual([1, 3, 320, 320]);
    expect(session.calls[0].input.length).toBe(3 * 320 * 320);
    expect(progress).toEqual(["prepare", "infer", "finish"]);
    expect(mask.length).toBe(200 * 100);
    expect(mask[50 * 200 + 10]).toBe(0);
    expect(mask[50 * 200 + 190]).toBe(255);
  });

  test("feathering softens the edge", async () => {
    const hard = await segment(fakeSession(), { data: halfBright(64, 64), width: 64, height: 64 }, 64, 64);
    const soft = await segment(fakeSession(), { data: halfBright(64, 64), width: 64, height: 64 }, 64, 64, { feather: 6 });
    const edge = (m: Uint8Array) => Array.from(m.subarray(32 * 64 + 26, 32 * 64 + 38)).filter((v) => v > 0 && v < 255).length;
    expect(edge(soft)).toBeGreaterThan(edge(hard));
  });

  test("an output without two spatial dimensions is refused", async () => {
    const session: SaliencySession = { run: async () => ({ data: new Float32Array(4), dims: [4] }) };
    await expect(segment(session, { data: solid(4, 4, [1, 1, 1, 255]), width: 4, height: 4 }, 4, 4)).rejects.toThrow(/Unexpected model output/);
  });

  test("an abort between the steps stops before the mask is built", async () => {
    const controller = new AbortController();
    const session: SaliencySession = {
      run: vi.fn(async (_input, dims) => {
        controller.abort();
        return { data: new Float32Array(dims[2] * dims[3]), dims: [1, 1, dims[2], dims[3]] };
      }),
    };
    await expect(
      segment(session, { data: solid(8, 8, [1, 1, 1, 255]), width: 8, height: 8 }, 8, 8, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
