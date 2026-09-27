import { encodeOutline } from "./outline";

// The client twin of the server's OutlineTracer: an alpha channel traced into a sticker outline, an
// SVG path in a 512×512 view box packed with encodeOutline. Same constants, same rounding (half to
// even, as .NET's Math.Round), so a file traced here and there gives the same bytes.

export const OUTLINE_MAX_BYTES = 1024;

const MASK_SIDE = 128;
const POINT_BUDGET = 400;
const BASE_TOLERANCE = 2;
const RETRIES = 4;
const VIEW_BOX = 512;
const MIN_CONTOUR_AREA = 48;
const OPAQUE_THRESHOLD = 127;

type Vertex = { x: number; y: number };

/** The alpha bytes of RGBA pixels (an ImageData's `data`). */
export function alphaOf(rgba: ArrayLike<number>): Uint8Array {
  const alpha = new Uint8Array(rgba.length >> 2);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return alpha;
}

/** The outline of `alpha` (one byte per pixel, row-major), or null when nothing is opaque enough. */
export function traceOutline(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  maxBytes = OUTLINE_MAX_BYTES,
): Uint8Array | null {
  if (!(width > 0) || !(height > 0)) throw new RangeError("dimensions must be positive");
  if (alpha.length < width * height) throw new RangeError("the alpha buffer is smaller than width × height");

  const { mask, mw, mh, any, all } = downsample(alpha, width, height);
  if (!any) return null;

  const contours: Vertex[][] = all
    ? [[{ x: 0, y: 0 }, { x: mw, y: 0 }, { x: mw, y: mh }, { x: 0, y: mh }]]
    : trace(mask, mw, mh);

  // Mask coordinates to the 512 view box, aspect kept, centred.
  const scale = VIEW_BOX / Math.max(width, height);
  const sx = (width / mw) * scale;
  const sy = (height / mh) * scale;
  const offsetX = (VIEW_BOX - width * scale) / 2;
  const offsetY = (VIEW_BOX - height * scale) / 2;

  const rings = contours
    .map((c) => c.map((p) => ({ x: offsetX + p.x * sx, y: offsetY + p.y * sy })))
    .map((points) => ({ points, area: Math.abs(signedArea(points)) }))
    .filter((c) => c.area >= MIN_CONTOUR_AREA)
    .sort((a, b) => b.area - a.area)
    .map((c) => c.points);

  if (rings.length === 0) return null;

  let tolerance = BASE_TOLERANCE;
  for (let attempt = 0; attempt <= RETRIES; attempt++, tolerance *= 2) {
    // Null when even the largest contour is over the point budget at this tolerance.
    const path = buildPath(rings, tolerance);
    if (path === null) continue;
    const bytes = encodeOutline(path);
    if (bytes.length <= maxBytes) return bytes;
  }
  return null;
}

function downsample(alpha: ArrayLike<number>, width: number, height: number) {
  const factor = Math.max(1, Math.floor((Math.max(width, height) + MASK_SIDE - 1) / MASK_SIDE));
  const mw = Math.floor((width + factor - 1) / factor);
  const mh = Math.floor((height + factor - 1) / factor);
  const mask = new Uint8Array(mw * mh);
  let any = false;
  let all = true;

  for (let my = 0; my < mh; my++) {
    const y0 = my * factor;
    const y1 = Math.min(y0 + factor, height);
    for (let mx = 0; mx < mw; mx++) {
      const x0 = mx * factor;
      const x1 = Math.min(x0 + factor, width);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) if (alpha[row + x] > OPAQUE_THRESHOLD) count++;
      }
      const set = count * 2 > (x1 - x0) * (y1 - y0);
      mask[my * mw + mx] = set ? 1 : 0;
      any ||= set;
      all &&= set;
    }
  }
  return { mask, mw, mh, any, all };
}

/**
 * Marching squares over pixel centres with a transparent border, so every contour closes. Segments
 * run with the opaque side on the left, which gives holes the opposite winding to their outer
 * contour; saddles join the opaque corners.
 */
function trace(mask: Uint8Array, mw: number, mh: number): Vertex[][] {
  const w = mw + 2;
  const h = mh + 2;
  const next = new Int32Array(w * h * 2).fill(-1);

  const sample = (px: number, py: number) => px >= 1 && px <= mw && py >= 1 && py <= mh && mask[(py - 1) * mw + px - 1] === 1;
  const horizontalKey = (px: number, py: number) => (py * w + px) * 2;
  const verticalKey = (px: number, py: number) => (py * w + px) * 2 + 1;
  // Padded sample (px, py) is mask pixel (px - 1, py - 1), centred at (px - 0.5, py - 0.5).
  const keyToPoint = (k: number): Vertex => {
    const cell = k >> 1;
    const px = cell % w;
    const py = Math.floor(cell / w);
    return (k & 1) === 0 ? { x: px, y: py - 0.5 } : { x: px - 0.5, y: py };
  };

  const corner = [false, false, false, false];
  const edge = [0, 0, 0, 0];

  for (let cy = 0; cy < h - 1; cy++) {
    for (let cx = 0; cx < w - 1; cx++) {
      corner[0] = sample(cx, cy);
      corner[1] = sample(cx + 1, cy);
      corner[2] = sample(cx + 1, cy + 1);
      corner[3] = sample(cx, cy + 1);
      if (corner[0] === corner[1] && corner[1] === corner[2] && corner[2] === corner[3]) continue;

      // Clockwise: top, right, bottom, left; edge k runs from corner k to corner k+1.
      edge[0] = horizontalKey(cx, cy);
      edge[1] = verticalKey(cx + 1, cy);
      edge[2] = horizontalKey(cx, cy + 1);
      edge[3] = verticalKey(cx, cy);

      const saddle = corner[0] === corner[2] && corner[1] === corner[3];
      let exit = -1;
      for (let k = 0; k < 4; k++) if (corner[k] && !corner[(k + 1) & 3]) exit = k;
      for (let k = 0; k < 4; k++) {
        if (corner[k] || !corner[(k + 1) & 3]) continue;
        next[edge[k]] = edge[saddle ? (k + 3) & 3 : exit];
      }
    }
  }

  const contours: Vertex[][] = [];
  for (let start = 0; start < next.length; start++) {
    if (next[start] < 0) continue;
    const ring: Vertex[] = [];
    let key = start;
    while (next[key] >= 0) {
      ring.push(keyToPoint(key));
      const following = next[key];
      next[key] = -1;
      key = following;
    }
    if (ring.length >= 3) contours.push(ring);
  }
  return contours;
}

/** .NET's Math.Round: halves go to the even neighbour. */
function roundHalfEven(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value % 1) === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
}

function buildPath(rings: Vertex[][], tolerance: number): string | null {
  let path = "";
  let budget = POINT_BUDGET;

  for (const ring of rings) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of simplify(ring, tolerance)) {
      const x = roundHalfEven(p.x);
      const y = roundHalfEven(p.y);
      if (xs.length > 0 && xs[xs.length - 1] === x && ys[ys.length - 1] === y) continue;
      xs.push(x);
      ys.push(y);
    }
    if (xs.length > 1 && xs[0] === xs[xs.length - 1] && ys[0] === ys[ys.length - 1]) {
      xs.pop();
      ys.pop();
    }
    if (xs.length < 3) continue;
    if (xs.length > budget) break;
    budget -= xs.length;

    path += `M${xs[0]},${ys[0]}l`;
    for (let i = 1; i < xs.length; i++) {
      // A minus sign separates on its own; a comma before it would cost a byte.
      const dx = xs[i] - xs[i - 1];
      const dy = ys[i] - ys[i - 1];
      path += i === 1 || dx < 0 ? `${dx}` : `,${dx}`;
      path += dy < 0 ? `${dy}` : `,${dy}`;
    }
    path += "z";
  }
  return path.length === 0 ? null : path;
}

/** Douglas–Peucker on a closed ring, anchored at vertex 0 and the vertex farthest from it. */
function simplify(ring: Vertex[], tolerance: number): Vertex[] {
  const n = ring.length;
  if (n <= 4) return [...ring];

  let far = 0;
  let best = -1;
  for (let i = 1; i < n; i++) {
    const d = distance2(ring[0], ring[i]);
    if (d > best) {
      best = d;
      far = i;
    }
  }

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, n],
  ];

  while (stack.length) {
    const [from, to] = stack.pop()!;
    if (to - from < 2) continue;
    const a = ring[from];
    const b = ring[to % n];
    let index = -1;
    let max = tolerance;
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistance(ring[i], a, b);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (index < 0) continue;
    keep[index] = 1;
    stack.push([from, index], [index, to]);
  }

  return ring.filter((_, i) => keep[i] === 1);
}

const distance2 = (a: Vertex, b: Vertex) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

function segmentDistance(p: Vertex, a: Vertex, b: Vertex): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.sqrt(distance2(p, a));
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.sqrt(distance2(p, { x: a.x + t * dx, y: a.y + t * dy }));
}

function signedArea(ring: Vertex[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return sum / 2;
}
