import type { Vec2 } from '../types';
import { emptyBounds, type Bounds, type EraseRect } from './coverage';
import { edgeMatte, hasBackgroundColour, padColours, pairsIn, unblend, REGION } from './matte';
import { channelTables, sampleColour, type RgbaImage } from './sample';

export type { RgbaImage } from './sample';

/** Photoshop's magic eraser options. */
export type MagicEraseOptions = {
  /** 0–255: how far each channel (R, G, B and A) may be from the sampled colour. */
  tolerance: number;
  /** A soft edge one pixel either side of the boundary, colour-decontaminated; off: a hard edge. */
  antiAlias: boolean;
  /** Only pixels connected to the clicked one (4-connected); off: every matching pixel. */
  contiguous: boolean;
  /** 0–100 %: how much of a matching pixel goes. */
  opacity: number;
  /** The sampled colour is the average of this square round the click (1 = the pixel). */
  sampleSize?: number;
};

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
/** In the map: matches the colour, not (yet) part of the region. */
const MATCH = 1;

/**
 * The tolerance test over the whole image in one pass, reading a pixel at once where the bytes
 * allow it: `value` where a pixel matches, 0 elsewhere.
 */
function matchMap(data: RgbaImage['data'], n: number, tables: ReturnType<typeof channelTables>, value: number): Uint8Array {
  const [r, g, b, a] = tables;
  const map = new Uint8Array(n);
  if (LITTLE_ENDIAN && data.byteOffset % 4 === 0 && data.byteLength >= n * 4) {
    const px = new Uint32Array(data.buffer, data.byteOffset, n);
    for (let i = 0; i < n; i++) {
      const v = px[i];
      if (r[v & 255] & g[(v >>> 8) & 255] & b[(v >>> 16) & 255] & a[v >>> 24]) map[i] = value;
    }
  } else {
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (r[data[p]] & g[data[p + 1]] & b[data[p + 2]] & a[data[p + 3]]) map[i] = value;
    }
  }
  return map;
}

/** Scanline flood fill from `start` over MATCH pixels, turning them to REGION; their bounds. */
function fill(width: number, height: number, map: Uint8Array, start: number): Bounds {
  const b = emptyBounds();
  let stack = new Int32Array(1024);
  let top = 0;
  const push = (i: number) => {
    if (top === stack.length) {
      const bigger = new Int32Array(stack.length * 2);
      bigger.set(stack);
      stack = bigger;
    }
    stack[top++] = i;
  };
  push(start);
  while (top > 0) {
    const i = stack[--top];
    if (map[i] !== MATCH) continue;
    const y = (i / width) | 0;
    const row = y * width;
    let xl = i - row;
    let xr = xl;
    while (xl > 0 && map[row + xl - 1] === MATCH) xl--;
    while (xr < width - 1 && map[row + xr + 1] === MATCH) xr++;
    map.fill(REGION, row + xl, row + xr + 1);
    if (xl < b.x0) b.x0 = xl;
    if (xr + 1 > b.x1) b.x1 = xr + 1;
    if (y < b.y0) b.y0 = y;
    if (y + 1 > b.y1) b.y1 = y + 1;
    // Seed each run of fillable pixels in the rows above and below the span.
    for (let ny = y - 1; ny <= y + 1; ny += 2) {
      if (ny < 0 || ny >= height) continue;
      const nrow = ny * width;
      let run = false;
      for (let j = nrow + xl, end = nrow + xr; j <= end; j++) {
        if (map[j] === MATCH) {
          if (!run) push(j);
          run = true;
        } else {
          run = false;
        }
      }
    }
  }
  // What matched but is not connected is not part of it.
  for (let k = 0; k < map.length; k++) if (map[k] === MATCH) map[k] = 0;
  return b;
}

/**
 * The pixels either side of every boundary of `region` inside the box, each once: where a pixel and
 * its right or lower neighbour differ.
 */
function boundaryPixels(region: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number): Int32Array {
  const seen = new Uint8Array(region.length);
  let out = new Int32Array(4096);
  let count = 0;
  const add = (i: number) => {
    if (seen[i]) return;
    seen[i] = 1;
    if (count === out.length) {
      const bigger = new Int32Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[count++] = i;
  };
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let i = row + x0, end = row + x1 - 1; i < end; i++) {
      if (region[i] !== region[i + 1]) {
        add(i);
        add(i + 1);
      }
    }
    if (y + 1 >= y1) continue;
    for (let i = row + x0, end = row + x1; i < end; i++) {
      if (region[i] !== region[i + width]) {
        add(i);
        add(i + width);
      }
    }
  }
  return out.subarray(0, count);
}

/**
 * What the magic eraser takes away when `image` is clicked at `seed` (frame pixels): every pixel
 * whose channels are all within the tolerance of the sampled colour (connected to the click, or
 * anywhere), by the opacity. With anti-alias, the pixels either side of the region's boundary go
 * by how much of them is the background, and keep the colour they have without it.
 */
export function magicErase(image: RgbaImage, seed: Vec2, options: MagicEraseOptions): EraseRect | null {
  const { width, height, data } = image;
  const sx = Math.floor(seed[0]);
  const sy = Math.floor(seed[1]);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;
  const opacity = Math.min(1, Math.max(0, options.opacity / 100));
  if (opacity <= 0) return null;

  const n = width * height;
  const sample = sampleColour(image, sx, sy, options.sampleSize ?? 1);
  const tables = channelTables(sample, options.tolerance);

  let region: Uint8Array;
  let b: Bounds;
  if (options.contiguous) {
    region = matchMap(data, n, tables, MATCH);
    const start = sy * width + sx;
    if (region[start] !== MATCH) return null;
    b = fill(width, height, region, start);
  } else {
    region = matchMap(data, n, tables, REGION);
    b = emptyBounds();
    for (let y = 0; y < height; y++) {
      const row = region.subarray(y * width, (y + 1) * width);
      const first = row.indexOf(REGION);
      if (first < 0) continue;
      const last = row.lastIndexOf(REGION);
      if (first < b.x0) b.x0 = first;
      if (last + 1 > b.x1) b.x1 = last + 1;
      if (y < b.y0) b.y0 = y;
      b.y1 = y + 1;
    }
  }
  if (!(b.x1 > b.x0)) return null;

  // The soft edge reaches one pixel past the region.
  const pad = options.antiAlias ? 1 : 0;
  const x0 = Math.max(0, b.x0 - pad);
  const y0 = Math.max(0, b.y0 - pad);
  const x1 = Math.min(width, b.x1 + pad);
  const y1 = Math.min(height, b.y1 + pad);
  const w = x1 - x0;
  const h = y1 - y0;

  // Inside the region, the opacity; the region is REGION (255) there, so at full opacity a copy.
  const out = new Uint8Array(w * h);
  const full = Math.round(255 * opacity);
  for (let y = 0; y < h; y++) {
    const src = (y0 + y) * width + x0;
    if (full === REGION) {
      out.set(region.subarray(src, src + w), y * w);
      continue;
    }
    for (let x = 0; x < w; x++) if (region[src + x]) out[y * w + x] = full;
  }
  const coverageAt = (i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    return x < x0 || y < y0 || x >= x1 || y >= y1 ? 0 : out[(y - y0) * w + (x - x0)];
  };
  // The boundary, one pixel either side of the region.
  const band = boundaryPixels(region, width, Math.max(0, b.x0 - 1), Math.max(0, b.y0 - 1), Math.min(width, b.x1 + 1), Math.min(height, b.y1 + 1));
  const colours = new Map<number, number>();

  if (!options.antiAlias) {
    if (full === 255) padColours(image, band, coverageAt, colours);
    return { x: x0, y: y0, width: w, height: h, data: out, colour: pairsIn(colours, width, x0, y0, x1, y1) };
  }

  const bg = new Float32Array(8);
  const used = emptyBounds();
  for (let k = 0; k < band.length; k++) {
    const i = band[k];
    const x = i % width;
    const y = (i - x) / width;
    const inside = region[i] === REGION;
    const a = edgeMatte(image, region, i, sample, bg);
    // Not a blend: all background inside the region, all subject outside it.
    const e = (a < 0 ? (inside ? 1 : 0) : 1 - a) * opacity;
    const v = Math.round(255 * e);
    out[(y - y0) * w + (x - x0)] = v;
    if (v <= 0) continue;
    if (!inside) {
      if (x < used.x0) used.x0 = x;
      if (x + 1 > used.x1) used.x1 = x + 1;
      if (y < used.y0) used.y0 = y;
      if (y + 1 > used.y1) used.y1 = y + 1;
    }
    if (a < 0 || v >= 255 || !hasBackgroundColour(bg)) continue;
    colours.set(i, unblend(data, i * 4, bg, e));
  }
  if (full === 255) padColours(image, band, coverageAt, colours);

  // The pad keeps only the band pixels that lost something.
  const cx0 = Math.min(b.x0, used.x0);
  const cy0 = Math.min(b.y0, used.y0);
  const cx1 = Math.max(b.x1, used.x1);
  const cy1 = Math.max(b.y1, used.y1);
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  let coverage = out;
  if (cx0 !== x0 || cy0 !== y0 || cw !== w || ch !== h) {
    coverage = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      const from = (cy0 - y0 + y) * w + (cx0 - x0);
      coverage.set(out.subarray(from, from + cw), y * cw);
    }
  }
  return { x: cx0, y: cy0, width: cw, height: ch, data: coverage, colour: pairsIn(colours, width, cx0, cy0, cx1, cy1) };
}
