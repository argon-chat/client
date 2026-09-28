import type { Vec2 } from '../types';
import { featherCoverage, type CoverageRect } from './coverage';

/** Sub-scanlines per pixel row; across a row the coverage is exact. */
const SUBSAMPLES = 5;

/**
 * Anti-aliased coverage of a closed polygon (non-zero winding, so a lasso that loops over itself
 * still selects the loop), clipped to a `frameWidth × frameHeight` frame. Null when nothing is inside.
 */
export function rasterizePolygon(points: readonly Vec2[], frameWidth: number, frameHeight: number): CoverageRect | null {
  const n = points.length;
  if (n < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  const x0 = Math.max(0, Math.floor(minX));
  const y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(frameWidth, Math.ceil(maxX));
  const y1 = Math.min(frameHeight, Math.ceil(maxY));
  if (!(x1 > x0 && y1 > y0)) return null;
  const w = x1 - x0;
  const h = y1 - y0;

  // Edges top to bottom, horizontal ones dropped (they never cross a scanline).
  const eTop = new Float64Array(n);
  const eBottom = new Float64Array(n);
  const eX = new Float64Array(n);
  const eSlope = new Float64Array(n);
  const eDir = new Int8Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % n];
    if (ay === by || !Number.isFinite(ax + ay + bx + by)) continue;
    const down = by > ay;
    const [tx, ty, bY] = down ? [ax, ay, by] : [bx, by, ay];
    eTop[m] = ty;
    eBottom[m] = bY;
    eX[m] = tx;
    eSlope[m] = (bx - ax) / (by - ay);
    eDir[m] = down ? 1 : -1;
    m++;
  }
  const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => eTop[a] - eTop[b]);

  const out = new Uint8Array(w * h);
  const cover = new Float32Array(w + 1);
  const diff = new Float32Array(w + 2);
  let active: number[] = [];
  let next = 0;
  const xs: number[] = [];
  const dirs: number[] = [];

  const span = (xa: number, xb: number) => {
    const a = Math.max(0, xa - x0);
    const b = Math.min(w, xb - x0);
    if (b <= a) return;
    const ia = Math.floor(a);
    const ib = Math.floor(b);
    if (ia === ib) {
      cover[ia] += b - a;
      return;
    }
    cover[ia] += ia + 1 - a;
    diff[ia + 1] += 1;
    diff[ib] -= 1;
    if (ib < w) cover[ib] += b - ib;
  };

  for (let row = 0; row < h; row++) {
    cover.fill(0);
    diff.fill(0);
    for (let k = 0; k < SUBSAMPLES; k++) {
      const y = y0 + row + (k + 0.5) / SUBSAMPLES;
      while (next < m && eTop[order[next]] <= y) active.push(order[next++]);
      active = active.filter((e) => eBottom[e] > y);
      if (active.length < 2) continue;

      xs.length = 0;
      dirs.length = 0;
      for (const e of active) {
        if (eTop[e] > y) continue;
        const x = eX[e] + (y - eTop[e]) * eSlope[e];
        // Insertion keeps them sorted: a scanline crosses few edges.
        let j = xs.length;
        xs.push(x);
        dirs.push(eDir[e]);
        while (j > 0 && xs[j - 1] > x) {
          xs[j] = xs[j - 1];
          dirs[j] = dirs[j - 1];
          j--;
        }
        xs[j] = x;
        dirs[j] = eDir[e];
      }
      let wind = 0;
      let start = 0;
      for (let i = 0; i < xs.length; i++) {
        const before = wind;
        wind += dirs[i];
        if (before === 0 && wind !== 0) start = xs[i];
        else if (before !== 0 && wind === 0) span(start, xs[i]);
      }
    }
    let run = 0;
    const base = row * w;
    for (let i = 0; i < w; i++) {
      run += diff[i];
      const v = (run + cover[i]) / SUBSAMPLES;
      out[base + i] = v >= 1 ? 255 : v <= 0 ? 0 : Math.round(v * 255);
    }
  }
  return { x: x0, y: y0, width: w, height: h, data: out };
}

/**
 * A selection's coverage in a mask frame: source-pixel points scaled by `scale`, anti-aliased (or
 * a hard edge: a pixel is in when its centre half is), then feathered.
 */
export function selectionCoverage(
  points: readonly Vec2[],
  feather: number,
  frameWidth: number,
  frameHeight: number,
  scale = 1,
  antiAlias = true
): CoverageRect | null {
  const scaled = scale === 1 ? points : points.map((p) => [p[0] * scale, p[1] * scale] as Vec2);
  const c = rasterizePolygon(scaled, frameWidth, frameHeight);
  if (!c) return null;
  if (!antiAlias) for (let i = 0; i < c.data.length; i++) c.data[i] = c.data[i] >= 128 ? 255 : 0;
  return featherCoverage(c, feather * scale, frameWidth, frameHeight);
}

/** Twice the signed area; its sign is the winding. */
export function polygonArea(points: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Ramer–Douglas–Peucker: drops points within `epsilon` of the line through their neighbours. */
export function simplifyPath(points: readonly Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]] as Vec2);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = len > 0 ? Math.abs(dy * (px - ax) - dx * (py - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (at >= 0 && worst > epsilon) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push([points[i][0], points[i][1]]);
  return out;
}
