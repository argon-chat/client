import type { Vec2 } from '../types';
import type { Bounds } from './coverage';

// Intelligent Scissors (Mortensen & Barrett): a per-pixel cost that is low on edges, and the
// cheapest 8-connected path between two points over it. The link cost adds the gradient-direction
// term, so the path runs along an edge rather than across it.

export type CostMap = {
  width: number;
  height: number;
  /** 0 on the strongest edges, 255 where the image is flat (gradient and zero crossing). */
  cost: Uint8Array;
  /** Edge strength relative to the image's strong edges, 0–255. */
  edge: Uint8Array;
  /** Absolute contrast: about the step, in levels, across the edge (for Edge Contrast). */
  contrast: Uint8Array;
  /** Unit gradient direction × 127 (0 where flat). */
  dirX: Int8Array;
  dirY: Int8Array;
};

const GRADIENT_WEIGHT = 0.75;
const ZERO_CROSSING_WEIGHT = 0.25;
/** Of a link's cost: the pixel's own (gradient and zero crossing) and the direction term. */
const STATIC_WEIGHT = 0.86;
const DIRECTION_WEIGHT = 0.14;
/** Added to every step so that among equally good edges the shorter way wins. */
const STEP_BASE = 0.05;
/** A pull toward the straight line, far weaker than any edge: breaks ties across flat areas. */
const LINE_BIAS = 0.002;
/** Below this, gradients count as noise (of the largest a Sobel on bytes can give). */
const NOISE_FLOOR = 12;
/** A sharp step of Δ levels gives a smoothed Sobel of 3Δ. */
const STEP_GAIN = 3;
/** Photoshop's default Edge Contrast, 10 %, in levels. */
export const DEFAULT_EDGE_CONTRAST = 26;

function smooth121(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      const l = src[r + (x > 0 ? x - 1 : x)];
      const c = src[r + x];
      const rr = src[r + (x < w - 1 ? x + 1 : x)];
      tmp[r + x] = (l + 2 * c + rr) * 0.25;
    }
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w;
    const r = y * w;
    const dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) out[r + x] = (tmp[up + x] + 2 * tmp[r + x] + tmp[dn + x]) * 0.25;
  }
  return out;
}

/** The larger of `into` and this image's gradient per pixel, with its direction. */
function sobelMagnitude(src: Float32Array, w: number, h: number, into: Float32Array, gxOut: Float32Array, gyOut: Float32Array): void {
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w;
    const r = y * w;
    const dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < w - 1 ? x + 1 : x;
      const gx = src[up + xr] + 2 * src[r + xr] + src[dn + xr] - src[up + xl] - 2 * src[r + xl] - src[dn + xl];
      const gy = src[dn + xl] + 2 * src[dn + x] + src[dn + xr] - src[up + xl] - 2 * src[up + x] - src[up + xr];
      const g = Math.sqrt(gx * gx + gy * gy);
      if (g > into[r + x]) {
        into[r + x] = g;
        gxOut[r + x] = gx;
        gyOut[r + x] = gy;
      }
    }
  }
}

/**
 * The cost of each pixel of a straight-RGBA image: the inverted, normalised gradient of its
 * (smoothed) luminance — and alpha, so a transparent image's outline counts — plus a Laplacian
 * zero-crossing term that pins the path to the middle of an edge.
 */
export function computeCostMap(rgba: ArrayLike<number>, width: number, height: number): CostMap {
  const n = width * height;
  const lum = new Float32Array(n);
  let alpha: Float32Array | null = null;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    lum[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    if (rgba[p + 3] !== 255 && !alpha) alpha = new Float32Array(n).fill(255);
    if (alpha) alpha[i] = rgba[p + 3];
  }
  if (alpha) {
    // Transparent pixels have no colour to speak of; their luminance is the alpha edge's business.
    for (let i = 0; i < n; i++) lum[i] *= alpha[i] / 255;
  }

  const sLum = smooth121(lum, width, height);
  const grad = new Float32Array(n);
  const gxs = new Float32Array(n);
  const gys = new Float32Array(n);
  sobelMagnitude(sLum, width, height, grad, gxs, gys);
  if (alpha) sobelMagnitude(smooth121(alpha, width, height), width, height, grad, gxs, gys);

  // Normalise by a high percentile of the real (above-noise) gradients, not the maximum, so one
  // harsh edge does not flatten the rest.
  const BINS = 1024;
  const MAX = 1443; // 4·255·√2
  const hist = new Uint32Array(BINS);
  let counted = 0;
  let gMax = 0;
  for (let i = 0; i < n; i++) {
    const g = grad[i];
    if (g > gMax) gMax = g;
    if (g <= NOISE_FLOOR) continue;
    hist[Math.min(BINS - 1, Math.floor((g / MAX) * BINS))]++;
    counted++;
  }
  let gRef = gMax;
  if (counted > 0) {
    let seen = 0;
    const want = counted * 0.98;
    for (let b = 0; b < BINS; b++) {
      seen += hist[b];
      if (seen >= want) {
        gRef = ((b + 1) / BINS) * MAX;
        break;
      }
    }
  }
  gRef = Math.max(gRef, NOISE_FLOOR * 2);

  // Laplacian of the smoothed luminance; a pixel is on the crossing when a neighbour has the other
  // sign and it is the one closer to zero.
  const lap = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : y) * width;
    const r = y * width;
    const dn = (y < height - 1 ? y + 1 : y) * width;
    for (let x = 0; x < width; x++) {
      const xl = x > 0 ? x - 1 : x;
      const xr = x < width - 1 ? x + 1 : x;
      lap[r + x] = sLum[up + x] + sLum[dn + x] + sLum[r + xl] + sLum[r + xr] - 4 * sLum[r + x];
    }
  }

  const cost = new Uint8Array(n);
  const edge = new Uint8Array(n);
  const contrast = new Uint8Array(n);
  const dirX = new Int8Array(n);
  const dirY = new Int8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const g = Math.min(1, grad[i] / gRef);
      let zc = false;
      if (grad[i] > NOISE_FLOOR) {
        const v = lap[i];
        const av = Math.abs(v);
        const cross = (j: number) => {
          const u = lap[j];
          return ((v > 0 && u < 0) || (v < 0 && u > 0) || (v === 0 && u !== 0)) && av <= Math.abs(u);
        };
        zc = (x > 0 && cross(i - 1)) || (x < width - 1 && cross(i + 1)) || (y > 0 && cross(i - width)) || (y < height - 1 && cross(i + width));
        const k = 127 / grad[i];
        dirX[i] = Math.round(gxs[i] * k);
        dirY[i] = Math.round(gys[i] * k);
      }
      const c = GRADIENT_WEIGHT * (1 - g) + ZERO_CROSSING_WEIGHT * (zc ? 0 : 1);
      cost[i] = Math.round(c * 255);
      edge[i] = Math.round(g * 255);
      contrast[i] = Math.min(255, Math.round(grad[i] / STEP_GAIN));
    }
  }
  return { width, height, cost, edge, contrast, dirX, dirY };
}

/** Edge Contrast 1–100 % as the levels an edge must step by to attract the path. */
export const contrastLevels = (percent: number) => Math.round((Math.min(100, Math.max(0, percent)) / 100) * 255);

/**
 * The strongest edge within `radius` of `point` whose contrast reaches `minContrast` (the nearest
 * of equals), or the point itself when there is none.
 */
export function snapToEdge(map: CostMap, point: Vec2, radius: number, minContrast = DEFAULT_EDGE_CONTRAST): Vec2 {
  const px = Math.min(map.width - 1, Math.max(0, Math.round(point[0])));
  const py = Math.min(map.height - 1, Math.max(0, Math.round(point[1])));
  const r = Math.floor(radius);
  if (r <= 0) return [px, py];
  const floor = Math.max(1, minContrast);
  let best = -1;
  let bestD = Infinity;
  let bx = px;
  let by = py;
  for (let y = Math.max(0, py - r); y <= Math.min(map.height - 1, py + r); y++) {
    for (let x = Math.max(0, px - r); x <= Math.min(map.width - 1, px + r); x++) {
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d > r * r) continue;
      const i = y * map.width + x;
      if (map.contrast[i] < floor) continue;
      const e = map.edge[i];
      if (e > best || (e === best && d < bestD)) {
        best = e;
        bestD = d;
        bx = x;
        by = y;
      }
    }
  }
  return best >= 0 ? [bx, by] : [px, py];
}

/** Where the path may go: within `radius` of the pointer's trail (x, y pairs). */
export type Corridor = { points: ArrayLike<number>; radius: number };

export type PathOptions = {
  /** Largest side of the search window; a farther target is pulled in along the line to fit. */
  maxWindow?: number;
  /** Room around the two points' box. */
  pad?: number;
  /** Search exactly here instead (closing the loop needs room to go round). */
  window?: Bounds;
  /** Pixels the path may not use, as x, y pairs (thickened by one pixel; free near both ends). */
  blocked?: ArrayLike<number>;
  /** Edges weaker than this (levels) do not attract the path: they cost what a flat area does. */
  contrast?: number;
  /** Search only here (the window becomes its box); the magnetic lasso's Width round the trail. */
  corridor?: Corridor;
};

export type LiveWirePath = {
  /** x, y pairs from the start to `end`. */
  points: Int32Array;
  /** Where it ends: the target, or the target pulled into the window. */
  end: Vec2;
  /** The target was out of reach of the window. */
  clamped: boolean;
  /** No way round what was blocked: a straight line. */
  straight: boolean;
  /** Pixels settled by the search. */
  visited: number;
};

let dist = new Float32Array(0);
let prev = new Int32Array(0);
let flags = new Uint8Array(0);
let heapNode = new Int32Array(1024);
let heapKey = new Float32Array(1024);

/** Search buffers up to this many pixels (a live window's worth) stay allocated between searches. */
const KEEP_BUFFER = 640 * 640;

function ensureBuffers(size: number, shrink = false) {
  if (dist.length < size || shrink) {
    dist = new Float32Array(size);
    prev = new Int32Array(size);
    flags = new Uint8Array(size);
  }
}

const DONE = 1;
const BLOCKED = 2;

function straightLine(fx: number, fy: number, tx: number, ty: number): Int32Array {
  const steps = Math.max(Math.abs(tx - fx), Math.abs(ty - fy));
  const out = new Int32Array((steps + 1) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    out[i * 2] = Math.round(fx + (tx - fx) * t);
    out[i * 2 + 1] = Math.round(fy + (ty - fy) * t);
  }
  return out;
}

/** The cheapest 8-connected path from `from` to `to` (pixel coordinates), searched in a window. */
export function findPath(map: CostMap, from: Vec2, to: Vec2, options: PathOptions = {}): LiveWirePath {
  const { width, height, cost } = map;
  const clampX = (v: number) => Math.min(width - 1, Math.max(0, Math.round(v)));
  const clampY = (v: number) => Math.min(height - 1, Math.max(0, Math.round(v)));
  const fx = clampX(from[0]);
  const fy = clampY(from[1]);
  let tx = clampX(to[0]);
  let ty = clampY(to[1]);
  let clamped = false;

  let wx0: number, wy0: number, wx1: number, wy1: number;
  const corridor = options.corridor && options.corridor.points.length >= 2 ? options.corridor : null;
  if (corridor) {
    const cp = corridor.points;
    const r = Math.max(1, corridor.radius);
    let minX = Math.min(fx, tx), minY = Math.min(fy, ty), maxX = Math.max(fx, tx), maxY = Math.max(fy, ty);
    for (let i = 0; i + 1 < cp.length; i += 2) {
      minX = Math.min(minX, cp[i]);
      minY = Math.min(minY, cp[i + 1]);
      maxX = Math.max(maxX, cp[i]);
      maxY = Math.max(maxY, cp[i + 1]);
    }
    wx0 = Math.max(0, Math.floor(minX - r - 1));
    wy0 = Math.max(0, Math.floor(minY - r - 1));
    wx1 = Math.min(width, Math.ceil(maxX + r + 2));
    wy1 = Math.min(height, Math.ceil(maxY + r + 2));
  } else if (options.window) {
    wx0 = Math.max(0, Math.min(Math.floor(options.window.x0), fx, tx));
    wy0 = Math.max(0, Math.min(Math.floor(options.window.y0), fy, ty));
    wx1 = Math.min(width, Math.max(Math.ceil(options.window.x1), fx + 1, tx + 1));
    wy1 = Math.min(height, Math.max(Math.ceil(options.window.y1), fy + 1, ty + 1));
  } else {
    const maxWindow = options.maxWindow ?? 320;
    const pad = Math.max(1, Math.min(options.pad ?? 24, Math.floor((maxWindow - 2) / 4)));
    const span = maxWindow - 2 * pad - 1;
    const k = Math.min(1, span / Math.max(1, Math.abs(tx - fx)), span / Math.max(1, Math.abs(ty - fy)));
    if (k < 1) {
      tx = clampX(fx + (tx - fx) * k);
      ty = clampY(fy + (ty - fy) * k);
      clamped = true;
    }
    wx0 = Math.max(0, Math.min(fx, tx) - pad);
    wy0 = Math.max(0, Math.min(fy, ty) - pad);
    wx1 = Math.min(width, Math.max(fx, tx) + pad + 1);
    wy1 = Math.min(height, Math.max(fy, ty) + pad + 1);
  }
  const ww = wx1 - wx0;
  const wh = wy1 - wy0;
  const size = ww * wh;
  ensureBuffers(size);
  dist.fill(Infinity, 0, size);
  flags.fill(corridor ? BLOCKED : 0, 0, size);

  if (corridor) {
    // Open every pixel within the radius of the trail's segments (capsules).
    const cp = corridor.points;
    const r = Math.max(1, corridor.radius);
    const r2 = r * r;
    const count = cp.length >> 1;
    for (let s = 0; s < Math.max(1, count - 1); s++) {
      const ax = cp[s * 2];
      const ay = cp[s * 2 + 1];
      const bx = count > 1 ? cp[s * 2 + 2] : ax;
      const by = count > 1 ? cp[s * 2 + 3] : ay;
      const dx = bx - ax;
      const dy = by - ay;
      const ll = dx * dx + dy * dy;
      const sx0 = Math.max(wx0, Math.floor(Math.min(ax, bx) - r));
      const sy0 = Math.max(wy0, Math.floor(Math.min(ay, by) - r));
      const sx1 = Math.min(wx1 - 1, Math.ceil(Math.max(ax, bx) + r));
      const sy1 = Math.min(wy1 - 1, Math.ceil(Math.max(ay, by) + r));
      for (let y = sy0; y <= sy1; y++) {
        const row = (y - wy0) * ww - wx0;
        for (let x = sx0; x <= sx1; x++) {
          const t = ll > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / ll)) : 0;
          const ex = x - ax - dx * t;
          const ey = y - ay - dy * t;
          if (ex * ex + ey * ey <= r2) flags[row + x] = 0;
        }
      }
    }
    flags[(fy - wy0) * ww + (fx - wx0)] = 0;
    flags[(ty - wy0) * ww + (tx - wx0)] = 0;
  }

  if (options.blocked) {
    const b = options.blocked;
    const FREE = 4;
    for (let i = 0; i + 1 < b.length; i += 2) {
      for (let k = 0; k < 5; k++) {
        const x = b[i] + (k === 1 ? 1 : k === 2 ? -1 : 0);
        const y = b[i + 1] + (k === 3 ? 1 : k === 4 ? -1 : 0);
        if (x < wx0 || y < wy0 || x >= wx1 || y >= wy1) continue;
        if (Math.max(Math.abs(x - fx), Math.abs(y - fy)) <= FREE || Math.max(Math.abs(x - tx), Math.abs(y - ty)) <= FREE) continue;
        flags[(y - wy0) * ww + (x - wx0)] = BLOCKED;
      }
    }
  }

  // Distance to the from→to segment, for the tie-break toward straight.
  const lx = tx - fx;
  const ly = ty - fy;
  const ll = lx * lx + ly * ly;
  const lineDistance = (x: number, y: number) => {
    if (ll === 0) return Math.hypot(x - fx, y - fy);
    const t = Math.min(1, Math.max(0, ((x - fx) * lx + (y - fy) * ly) / ll));
    return Math.hypot(x - fx - lx * t, y - fy - ly * t);
  };

  const start = (fy - wy0) * ww + (fx - wx0);
  const goal = (ty - wy0) * ww + (tx - wx0);
  let heapSize = 0;
  const push = (node: number, key: number) => {
    if (heapSize === heapNode.length) {
      const nn = new Int32Array(heapSize * 2);
      nn.set(heapNode);
      heapNode = nn;
      const nk = new Float32Array(heapSize * 2);
      nk.set(heapKey);
      heapKey = nk;
    }
    let i = heapSize++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapKey[parent] <= key) break;
      heapNode[i] = heapNode[parent];
      heapKey[i] = heapKey[parent];
      i = parent;
    }
    heapNode[i] = node;
    heapKey[i] = key;
  };
  const pop = (): number => {
    const top = heapNode[0];
    const lastNode = heapNode[--heapSize];
    const lastKey = heapKey[heapSize];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= heapSize) break;
      if (c + 1 < heapSize && heapKey[c + 1] < heapKey[c]) c++;
      if (heapKey[c] >= lastKey) break;
      heapNode[i] = heapNode[c];
      heapKey[i] = heapKey[c];
      i = c;
    }
    heapNode[i] = lastNode;
    heapKey[i] = lastKey;
    return top;
  };

  dist[start] = 0;
  prev[start] = -1;
  push(start, 0);
  let visited = 0;
  let reached = false;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1];
  const DY = [0, 0, 1, -1, 1, -1, 1, -1];
  const SQRT2 = Math.SQRT2;
  const { contrast, dirX, dirY } = map;
  const minContrast = Math.max(1, options.contrast ?? 0);
  const DIRECTION = DIRECTION_WEIGHT * (2 / (3 * Math.PI));

  while (heapSize > 0) {
    const key = heapKey[0];
    const node = pop();
    if (flags[node] & DONE) continue;
    if (key > dist[node]) continue;
    flags[node] |= DONE;
    visited++;
    if (node === goal) {
      reached = true;
      break;
    }
    const lx0 = node % ww;
    const ly0 = (node - lx0) / ww;
    const p = (ly0 + wy0) * width + lx0 + wx0;
    const pEdge = contrast[p] >= minContrast && (dirX[p] !== 0 || dirY[p] !== 0);
    for (let k = 0; k < 8; k++) {
      const nx = lx0 + DX[k];
      const ny = ly0 + DY[k];
      if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue;
      const nb = ny * ww + nx;
      if (flags[nb]) continue;
      const gx = nx + wx0;
      const gy = ny + wy0;
      const q = gy * width + gx;
      const qEdge = contrast[q] >= minContrast;
      let step = STEP_BASE + STATIC_WEIGHT * (qEdge ? cost[q] : 255) / 255 + LINE_BIAS * lineDistance(gx, gy);
      if (pEdge && qEdge && (dirX[q] !== 0 || dirY[q] !== 0)) {
        // Along the edge: the link against the edge directions (perpendicular to the gradients).
        const inv = k >= 4 ? Math.SQRT1_2 : 1;
        let lx = DX[k] * inv;
        let ly = DY[k] * inv;
        const px = dirY[p] / 127;
        const py = -dirX[p] / 127;
        let dp = px * lx + py * ly;
        if (dp < 0) {
          dp = -dp;
          lx = -lx;
          ly = -ly;
        }
        const dq = lx * (dirY[q] / 127) - ly * (dirX[q] / 127);
        step += DIRECTION * (Math.acos(Math.min(1, dp)) + Math.acos(Math.max(-1, Math.min(1, dq))));
      }
      if (k >= 4) step *= SQRT2;
      const nd = key + step;
      if (nd < dist[nb]) {
        dist[nb] = nd;
        prev[nb] = node;
        push(nb, nd);
      }
    }
  }

  let points: Int32Array;
  if (!reached) {
    points = straightLine(fx, fy, tx, ty);
  } else {
    let count = 0;
    for (let at = goal; at !== -1; at = prev[at]) count++;
    points = new Int32Array(count * 2);
    let i = count - 1;
    for (let at = goal; at !== -1; at = prev[at], i--) {
      const x = at % ww;
      points[i * 2] = x + wx0;
      points[i * 2 + 1] = (at - x) / ww + wy0;
    }
  }
  // A closing search can span the image; its buffers are not kept for the small ones that follow.
  if (dist.length > KEEP_BUFFER) ensureBuffers(0, true);
  if (heapNode.length > KEEP_BUFFER * 4) {
    heapNode = new Int32Array(1024);
    heapKey = new Float32Array(1024);
  }
  return { points, end: [tx, ty], clamped, straight: !reached, visited };
}

/** Length of an x, y pair path. */
export function pathLength(points: ArrayLike<number>): number {
  let len = 0;
  for (let i = 2; i + 1 < points.length; i += 2) len += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  return len;
}

/** How many leading points of the path lie within `length` of its start. */
export function pointsWithin(points: ArrayLike<number>, length: number): number {
  let len = 0;
  const n = points.length >> 1;
  for (let i = 1; i < n; i++) {
    len += Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]);
    if (len > length) return i;
  }
  return n;
}
