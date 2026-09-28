import type { Vec2 } from '../types';
import { cropCoverage, emptyBounds, growBounds, type Bounds, type EraseRect } from './coverage';
import { edgeMatte, hasBackgroundColour, padColours, pairsIn, unblend, IN_REACH, OUT_OF_REACH, REGION } from './matte';
import { channelTables, type RgbaImage } from './sample';

/** Photoshop's sampling: under the hotspot at every dab, once at the start, or a picked colour. */
export type EraserSampling = 'continuous' | 'once' | 'swatch';
/** Photoshop's limits: every match under the brush, only those connected to the hotspot, or those but not across edges. */
export type EraserLimits = 'discontiguous' | 'contiguous' | 'findEdges';

export type BackgroundEraserOptions = {
  /** Brush diameter, frame pixels. */
  size: number;
  /** 0–100: the share of the radius that erases fully before the edge falls off. */
  hardness: number;
  /** 1–100 % of the diameter between dabs. */
  spacing?: number;
  /** 0–100 %: how far each channel (R, G, B, A) may be from the sampled colour. */
  tolerance: number;
  sampling: EraserSampling;
  limits?: EraserLimits;
  /** The colour erased with `swatch` sampling (RGBA). */
  swatch?: readonly number[] | null;
  /**
   * Protect Foreground Colour: pixels within the tolerance of this one are never erased (within the
   * tolerance of both it and the sample, they go with the nearer).
   */
  protect?: readonly number[] | null;
};

export interface BackgroundEraseStroke {
  /** Dabs along the way from the last point to `point` (frame pixels); the area touched, or null. */
  to(point: Vec2): Bounds | null;
  /** The stroke so far over the whole frame: how much each pixel loses (0–255). */
  readonly coverage: Uint8Array;
  /** The colour a partly erased edge pixel keeps (0xRRGGBB), or −1. */
  colourAt(i: number): number;
  readonly bounds: Bounds;
  /** The colour being erased (straight RGBA). */
  readonly sample: readonly number[];
  /** The stroke, cropped to what it erased. */
  result(): EraseRect | null;
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

/** 0–100 % → the per-channel difference allowed, 0–255. */
export const toleranceLevels = (tolerance: number) => (Math.min(100, Math.max(0, tolerance)) / 100) * 255;

/** Find Edges does not cross pixels whose colour changes faster than this (levels per pixel). */
export const edgeThreshold = (levels: number) => Math.max(16, levels / 2);

/** The largest per-channel Sobel magnitude at (x, y), scaled so that a sharp step of Δ levels gives Δ. */
export function colourGradient(image: RgbaImage, x: number, y: number): number {
  const { width, height, data } = image;
  const xl = x > 0 ? x - 1 : x;
  const xr = x < width - 1 ? x + 1 : x;
  const up = (y > 0 ? y - 1 : y) * width;
  const row = y * width;
  const dn = (y < height - 1 ? y + 1 : y) * width;
  let most = 0;
  for (let c = 0; c < 3; c++) {
    const v = (i: number) => data[i * 4 + c];
    const gx = v(up + xr) + 2 * v(row + xr) + v(dn + xr) - v(up + xl) - 2 * v(row + xl) - v(dn + xl);
    const gy = v(dn + xl) + 2 * v(dn + x) + v(dn + xr) - v(up + xl) - 2 * v(up + x) - v(up + xr);
    const g = gx * gx + gy * gy;
    if (g > most) most = g;
  }
  return Math.sqrt(most) / 4;
}

/**
 * The background eraser: a round brush that removes, under it, the pixels close to a sampled
 * colour, within the limits; the ones along the boundary of what it takes go in part and keep
 * their colour without the background. Overlapping dabs take the larger amount, so going over a
 * spot twice does not erase more.
 */
export function beginBackgroundErase(image: RgbaImage, start: Vec2, options: BackgroundEraserOptions): BackgroundEraseStroke {
  const { width, height, data } = image;
  const radius = Math.max(0.5, options.size / 2);
  const spacing = Math.max(1, ((options.spacing ?? 25) / 100) * radius * 2);
  const levels = toleranceLevels(options.tolerance);
  const limits = options.limits ?? 'contiguous';
  const gradientLimit = edgeThreshold(levels);
  const coverage = new Uint8Array(width * height);
  const colours = new Map<number, number>();
  const reach = new Uint8Array(width * height);
  const bounds = emptyBounds();
  const sample = [0, 0, 0, 0];
  const bg = new Float32Array(8);
  const protect = options.protect ? channelTables(options.protect, levels) : null;
  let tables: ReturnType<typeof channelTables> | null = null;
  let last: Vec2 = [start[0], start[1]];
  let carry = 0;

  function setSample(c: readonly number[]) {
    if (tables && c[0] === sample[0] && c[1] === sample[1] && c[2] === sample[2] && c[3] === sample[3]) return;
    for (let k = 0; k < 4; k++) sample[k] = c[k];
    tables = channelTables(sample, levels);
  }

  if (options.sampling === 'swatch') setSample(options.swatch ?? [255, 255, 255, 255]);

  const distance = (p: number, c: readonly number[]) =>
    Math.max(Math.abs(data[p] - c[0]), Math.abs(data[p + 1] - c[1]), Math.abs(data[p + 2] - c[2]), Math.abs(data[p + 3] - c[3]));

  function matches(i: number): boolean {
    const t = tables!;
    const p = i << 2;
    if (!(t[0][data[p]] & t[1][data[p + 1]] & t[2][data[p + 2]] & t[3][data[p + 3]])) return false;
    if (!protect || !(protect[0][data[p]] & protect[1][data[p + 1]] & protect[2][data[p + 2]] & protect[3][data[p + 3]])) return true;
    // Within the tolerance of both: it goes with the nearer colour.
    return distance(p, sample) < distance(p, options.protect!);
  }

  // Scratch for one dab, reused.
  let falloff = new Float32Array(0);
  let matched = new Uint8Array(0);
  let stack = new Int32Array(0);

  function dab(cx: number, cy: number, touched: Bounds) {
    const hx = Math.floor(cx);
    const hy = Math.floor(cy);
    const hotspotInside = hx >= 0 && hy >= 0 && hx < width && hy < height;
    if (options.sampling !== 'swatch' && hotspotInside && (options.sampling === 'continuous' || !tables)) {
      const at = (hy * width + hx) * 4;
      setSample([data[at], data[at + 1], data[at + 2], data[at + 3]]);
    }
    if (!tables) return;
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const x1 = Math.min(width, Math.ceil(cx + radius + 1));
    const y1 = Math.min(height, Math.ceil(cy + radius + 1));
    if (x1 <= x0 || y1 <= y0) return;
    const w = x1 - x0;
    const h = y1 - y0;
    if (falloff.length < w * h) {
      falloff = new Float32Array(w * h);
      matched = new Uint8Array(w * h);
      stack = new Int32Array(w * h);
    }

    // The footprint, and what in it matches.
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x < x1; x++) {
        const f = brushFalloff(Math.hypot(x + 0.5 - cx, dy), radius, options.hardness);
        const local = (y - y0) * w + (x - x0);
        falloff[local] = f;
        if (f <= 0) continue;
        const i = y * width + x;
        const ok = matches(i) && (limits !== 'findEdges' || colourGradient(image, x, y) <= gradientLimit);
        reach[i] = limits === 'discontiguous' && ok ? REGION : IN_REACH;
        matched[local] = ok ? 1 : 0;
      }
    }
    if (limits !== 'discontiguous') {
      // Contiguous: from the hotspot through matching pixels; nothing when it is not on one.
      const hl = (hy - y0) * w + (hx - x0);
      if (hotspotInside && hx >= x0 && hx < x1 && hy >= y0 && hy < y1 && falloff[hl] > 0 && matched[hl]) {
        let top = 0;
        stack[top++] = hl;
        reach[hy * width + hx] = REGION;
        while (top > 0) {
          const l = stack[--top];
          const lx = l % w;
          const ly = (l - lx) / w;
          for (let k = 0; k < 4; k++) {
            const nx = lx + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const ny = ly + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nl = ny * w + nx;
            const ni = (ny + y0) * width + nx + x0;
            if (!matched[nl] || falloff[nl] <= 0 || reach[ni] === REGION) continue;
            reach[ni] = REGION;
            stack[top++] = nl;
          }
        }
      }
    }

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const f = falloff[(y - y0) * w + (x - x0)];
        if (f <= 0) continue;
        const i = y * width + x;
        const inside = reach[i] === REGION;
        // A boundary pixel has a 4-neighbour under the brush on the other side.
        const other = (j: number) => reach[j] !== OUT_OF_REACH && (reach[j] === REGION) !== inside;
        const edge = (x > 0 && other(i - 1)) || (x < width - 1 && other(i + 1)) || (y > 0 && other(i - width)) || (y < height - 1 && other(i + width));
        let e = inside ? f : 0;
        let a = -1;
        if (edge) {
          a = edgeMatte(image, reach, i, sample, bg);
          e = f * (a < 0 ? (inside ? 1 : 0) : 1 - a);
        }
        const v = Math.round(255 * e);
        if (v <= coverage[i]) continue;
        coverage[i] = v;
        if (edge && a >= 0 && v < 255 && hasBackgroundColour(bg)) colours.set(i, unblend(data, i * 4, bg, e));
        else colours.delete(i);
      }
    }
    for (let y = y0; y < y1; y++) reach.fill(OUT_OF_REACH, y * width + x0, y * width + x1);
    growBounds(touched, x0, y0, x1, y1);
  }

  const first = emptyBounds();
  dab(start[0], start[1], first);
  if (first.x1 > first.x0) growBounds(bounds, first.x0, first.y0, first.x1, first.y1);

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
    colourAt(i) {
      return colours.get(i) ?? -1;
    },
    bounds,
    sample,
    result() {
      if (!(bounds.x1 > bounds.x0)) return null;
      const c = cropCoverage(coverage, width, height, bounds);
      if (!c || !c.data.some((v) => v > 0)) return null;
      // Pixels erased in full next to kept ones take their colour, against filtering bleed.
      const all = new Map(colours);
      const kept: number[] = [];
      for (let y = Math.max(0, c.y - 1); y < Math.min(height, c.y + c.height + 1); y++) {
        for (let x = Math.max(0, c.x - 1); x < Math.min(width, c.x + c.width + 1); x++) {
          if (coverage[y * width + x] < 255) kept.push(y * width + x);
        }
      }
      padColours(image, kept, (i) => coverage[i], all);
      return { ...c, colour: pairsIn(all, width, c.x, c.y, c.x + c.width, c.y + c.height) };
    }
  };
}
