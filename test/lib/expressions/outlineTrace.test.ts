/**
 * The outline tracer (the client twin of the server's OutlineTracer): an alpha mask becomes a closed
 * SVG path in a 512 view box, simplified and packed to at most 1024 bytes; nothing opaque is no outline.
 */

import { describe, test, expect } from "vitest";
import { alphaOf, traceOutline } from "@/lib/expressions/outlineTrace";
import { decodeOutline } from "@/lib/expressions/outline";

function mask(width: number, height: number, inside: (x: number, y: number) => boolean): Uint8Array {
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = inside(x + 0.5, y + 0.5) ? 255 : 0;
  return alpha;
}

/** Absolute points of each ring of a traced path (M x,y l dx,dy … z). */
function rings(path: string): { x: number; y: number }[][] {
  const out: { x: number; y: number }[][] = [];
  for (const part of path.split("z").filter(Boolean)) {
    const [, start, deltas] = /^M(-?\d+,-?\d+)l(.*)$/.exec(part)!;
    const [x0, y0] = start.split(",").map(Number);
    const numbers = (deltas.match(/-?\d+/g) ?? []).map(Number);
    const ring = [{ x: x0, y: y0 }];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      const last = ring[ring.length - 1];
      ring.push({ x: last.x + numbers[i], y: last.y + numbers[i + 1] });
    }
    out.push(ring);
  }
  return out;
}

const bbox = (points: { x: number; y: number }[]) => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxY: Math.max(...points.map((p) => p.y)),
});

describe("traceOutline", () => {
  test("nothing opaque: no outline", () => {
    expect(traceOutline(new Uint8Array(128 * 128), 128, 128)).toBeNull();
    // Opaque enough is over 127.
    expect(traceOutline(new Uint8Array(64 * 64).fill(127), 64, 64)).toBeNull();
  });

  test("fully opaque: the whole box", () => {
    const bytes = traceOutline(new Uint8Array(128 * 128).fill(255), 128, 128)!;
    expect(decodeOutline(bytes)).toBe("M0,0l512,0,0,512-512,0z");
  });

  test("a non-square image keeps its aspect, centred", () => {
    const bytes = traceOutline(new Uint8Array(512 * 256).fill(255), 512, 256)!;
    expect(decodeOutline(bytes)).toBe("M0,128l512,0,0,256-512,0z");
  });

  test("a rectangle: one closed ring along its edges", () => {
    const bytes = traceOutline(mask(128, 128, (x, y) => x >= 32 && x < 96 && y >= 16 && y < 112), 128, 128)!;
    expect(bytes).not.toBeNull();
    const path = decodeOutline(bytes);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("z")).toBe(true);
    const [ring, ...rest] = rings(path);
    expect(rest).toHaveLength(0);
    const box = bbox(ring);
    // Midway between opaque and clear pixel centres: the true edge, ×4 into the 512 box (128…384, 64…448).
    expect(box.minX).toBeGreaterThanOrEqual(126);
    expect(box.minX).toBeLessThanOrEqual(130);
    expect(box.maxX).toBeGreaterThanOrEqual(380);
    expect(box.maxX).toBeLessThanOrEqual(386);
    expect(box.minY).toBeGreaterThanOrEqual(62);
    expect(box.maxY).toBeLessThanOrEqual(450);
    expect(ring.length).toBeLessThanOrEqual(12);
  });

  test("a circle: one closed ring near the radius, within 1024 bytes", () => {
    const bytes = traceOutline(mask(256, 256, (x, y) => (x - 128) ** 2 + (y - 128) ** 2 <= 80 ** 2), 256, 256)!;
    expect(bytes).not.toBeNull();
    expect(bytes.length).toBeLessThanOrEqual(1024);
    const all = rings(decodeOutline(bytes));
    expect(all).toHaveLength(1);
    for (const p of all[0]) {
      // 80 of 256 is 160 of 512, centred at 256.
      const r = Math.hypot(p.x - 256, p.y - 256);
      expect(r).toBeGreaterThan(150);
      expect(r).toBeLessThan(166);
    }
    expect(all[0].length).toBeGreaterThan(8);
  });

  test("a ring with a hole: the outer contour first, then the hole", () => {
    const inside = (x: number, y: number) => {
      const d = Math.hypot(x - 64, y - 64);
      return d <= 50 && d >= 25;
    };
    const all = rings(decodeOutline(traceOutline(mask(128, 128, inside), 128, 128)!));
    expect(all).toHaveLength(2);
    expect(bbox(all[0]).maxX - bbox(all[0]).minX).toBeGreaterThan(bbox(all[1]).maxX - bbox(all[1]).minX);
  });

  test("specks too small to see are dropped", () => {
    expect(traceOutline(mask(512, 512, (x, y) => x < 4 && y < 4), 512, 512)).toBeNull();
  });

  test("a budget the path cannot fit gives no outline", () => {
    const circle = mask(256, 256, (x, y) => (x - 128) ** 2 + (y - 128) ** 2 <= 100 ** 2);
    expect(traceOutline(circle, 256, 256, 4)).toBeNull();
  });

  test("alphaOf takes every fourth byte", () => {
    expect(Array.from(alphaOf(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8])))).toEqual([4, 8]);
  });

  test("bad input is refused", () => {
    expect(() => traceOutline(new Uint8Array(4), 0, 4)).toThrow();
    expect(() => traceOutline(new Uint8Array(3), 2, 2)).toThrow();
  });
});
