import type { Vec2 } from '../types';
import { colourMatch, distanceFrom, matchBand, toleranceToDeltaE, type ColourDistance } from './color';
import { cropCoverage, emptyBounds, growBounds, type Bounds, type CoverageRect } from './coverage';
import type { RgbaImage } from './magicEraser';

export type EraserSampling = 'once' | 'continuous';

export type BackgroundEraserOptions = {
  /** Brush diameter, frame pixels. */
  size: number;
  /** 0–100: the share of the radius that erases fully before the edge falls off. */
  hardness: number;
  /** 0–100, see `toleranceToDeltaE`. */
  tolerance: number;
  /** The colour under the hotspot when the stroke starts, or under it at every dab. */
  sampling: EraserSampling;
};

export interface BackgroundEraseStroke {
  /** Dabs along the way from the last point to `point` (frame pixels); the area touched, or null. */
  to(point: Vec2): Bounds | null;
  /** The stroke so far over the whole frame: how much each pixel loses (0–255). */
  readonly coverage: Uint8Array;
  readonly bounds: Bounds;
  /** The colour being erased (straight RGBA). */
  readonly sample: readonly number[];
  /** The stroke, cropped to what it erased. */
  result(): CoverageRect | null;
}

/** 1 inside the hard core, easing to 0 at the rim. */
export function brushFalloff(r: number, radius: number, hardness: number): number {
  if (r >= radius + 0.5) return 0;
  const h = Math.min(1, Math.max(0, hardness / 100));
  const core = radius * h;
  if (h >= 1 || radius - core < 1) return Math.min(1, Math.max(0, radius + 0.5 - r));
  if (r <= core) return 1;
  const t = Math.min(1, (r - core) / (radius - core));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The background eraser: a round brush that removes, under it, only the pixels close to a sampled
 * colour. Overlapping dabs take the larger amount, so going over a spot twice does not erase more.
 */
export function beginBackgroundErase(image: RgbaImage, start: Vec2, options: BackgroundEraserOptions): BackgroundEraseStroke {
  const { width, height, data } = image;
  const radius = Math.max(0.5, options.size / 2);
  const threshold = toleranceToDeltaE(options.tolerance);
  const band = matchBand(threshold);
  const spacing = Math.max(1, radius * 0.25);
  const coverage = new Uint8Array(width * height);
  const bounds = emptyBounds();
  const sample = [0, 0, 0, 0];
  let distance: ColourDistance | null = null;
  let last: Vec2 = [start[0], start[1]];
  let carry = 0;

  function resample(x: number, y: number) {
    const px = Math.min(width - 1, Math.max(0, Math.floor(x)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(y)));
    const at = (py * width + px) * 4;
    const [r, g, b, a] = [data[at], data[at + 1], data[at + 2], data[at + 3]];
    if (distance && r === sample[0] && g === sample[1] && b === sample[2] && a === sample[3]) return;
    sample[0] = r;
    sample[1] = g;
    sample[2] = b;
    sample[3] = a;
    distance = distanceFrom(r, g, b, a, 10);
  }

  function dab(cx: number, cy: number, touched: Bounds) {
    if (options.sampling === 'continuous' || !distance) resample(cx, cy);
    const d = distance!;
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const x1 = Math.min(width, Math.ceil(cx + radius + 1));
    const y1 = Math.min(height, Math.ceil(cy + radius + 1));
    if (x1 <= x0 || y1 <= y0) return;
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x < x1; x++) {
        const f = brushFalloff(Math.hypot(x + 0.5 - cx, dy), radius, options.hardness);
        if (f <= 0) continue;
        const i = y * width + x;
        const p = i * 4;
        const v = Math.round(255 * f * colourMatch(d(data[p], data[p + 1], data[p + 2], data[p + 3]), threshold, band));
        if (v > coverage[i]) coverage[i] = v;
      }
    }
    growBounds(touched, x0, y0, x1, y1);
  }

  const first = emptyBounds();
  dab(start[0], start[1], first);
  growBounds(bounds, first.x0, first.y0, first.x1, first.y1);

  return {
    to(point) {
      const touched = emptyBounds();
      const dx = point[0] - last[0];
      const dy = point[1] - last[1];
      const len = Math.hypot(dx, dy);
      let t = spacing - carry;
      while (t <= len) {
        dab(last[0] + (dx * t) / len, last[1] + (dy * t) / len, touched);
        t += spacing;
      }
      carry = len - (t - spacing);
      last = [point[0], point[1]];
      if (touched.x1 <= touched.x0) return null;
      growBounds(bounds, touched.x0, touched.y0, touched.x1, touched.y1);
      return touched;
    },
    coverage,
    bounds,
    sample,
    result() {
      const c = cropCoverage(coverage, width, height, bounds);
      return c && c.data.some((v) => v > 0) ? c : null;
    }
  };
}
