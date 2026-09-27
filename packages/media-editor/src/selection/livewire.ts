import type { Vec2 } from '../types';
import type { Bounds } from './coverage';

// Intelligent Scissors (Mortensen & Barrett): a per-pixel cost that is low on edges, and the
// cheapest 8-connected path between two points over it.

export type CostMap = {
  width: number;
  height: number;
  /** 0 on the strongest edges, 255 where the image is flat. */
  cost: Uint8Array;
  /** Edge strength 0–255, for snapping a point to the nearest edge. */
  edge: Uint8Array;
};

const GRADIENT_WEIGHT = 0.75;
const ZERO_CROSSING_WEIGHT = 0.25;
/** Added to every step so that among equally good edges the shorter way wins. */
const STEP_BASE = 0.05;
/** A pull toward the straight line, far weaker than any edge: breaks ties across flat areas. */
const LINE_BIAS = 0.002;
/** Below this, gradients count as noise (of the largest a Sobel on bytes can give). */
const NOISE_FLOOR = 12;

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

function sobelMagnitude(src: Float32Array, w: number, h: number, into: Float32Array): void {
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
      if (g > into[r + x]) into[r + x] = g;
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
  sobelMagnitude(sLum, width, height, grad);
  if (alpha) sobelMagnitude(smooth121(alpha, width, height), width, height, grad);

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
      }
      const c = GRADIENT_WEIGHT * (1 - g) + ZERO_CROSSING_WEIGHT * (zc ? 0 : 1);
      cost[i] = Math.round(c * 255);
      edge[i] = Math.round(g * 255);
    }
  }
  return { width, height, cost, edge };
}

/**
 * The strongest edge within `radius` of `point` (the nearest of equals), or the point itself when
 * there is nothing there worth snapping to.
 */
export function snapToEdge(map: CostMap, point: Vec2, radius: number): Vec2 {
  const px = Math.min(map.width - 1, Math.max(0, Math.round(point[0])));
  const py = Math.min(map.height - 1, Math.max(0, Math.round(point[1])));
  const r = Math.floor(radius);
  if (r <= 0) return [px, py];
  let best = -1;
  let bestD = Infinity;
  let bx = px;
  let by = py;
  for (let y = Math.max(0, py - r); y <= Math.min(map.height - 1, py + r); y++) {
    for (let x = Math.max(0, px - r); x <= Math.min(map.width - 1, px + r); x++) {
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d > r * r) continue;
      const e = map.edge[y * map.width + x];
      if (e > best || (e === best && d < bestD)) {
        best = e;
        bestD = d;
        bx = x;
        by = y;
      }
    }
  }
  return best >= 64 ? [bx, by] : [px, py];
}

export type PathOptions = {
  /** Largest side of the search window; a farther target is pulled in along the line to fit. */
  maxWindow?: number;
  /** Room around the two points' box. */
  pad?: number;
  /** Search exactly here instead (closing the loop needs room to go round). */
  window?: Bounds;
  /** Pixels the path may not use, as x, y pairs (thickened by one pixel; free near both ends). */
  blocked?: ArrayLike<number>;
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
  if (options.window) {
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
  flags.fill(0, 0, size);

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
    for (let k = 0; k < 8; k++) {
      const nx = lx0 + DX[k];
      const ny = ly0 + DY[k];
      if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue;
      const nb = ny * ww + nx;
      if (flags[nb]) continue;
      const gx = nx + wx0;
      const gy = ny + wy0;
      let step = STEP_BASE + cost[gy * width + gx] / 255 + LINE_BIAS * lineDistance(gx, gy);
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
