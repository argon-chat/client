import { featherMask } from '../mask/maskMath';

/**
 * Part of a mask frame: `width × height` bytes (0–255) placed at (x, y) of a frame. What a
 * selection covers, or how much a tool erases.
 */
export type CoverageRect = { x: number; y: number; width: number; height: number; data: Uint8Array };

/**
 * An eraser's result: how much each pixel loses, and for the partly erased ones the colour they
 * keep without the background, as pairs (pixel index within the rect, 0xRRGGBB); null when none.
 */
export type EraseRect = CoverageRect & { colour: Uint32Array | null };

/** The colour pairs as a rect-sized RGBA image (alpha 255 where set). */
export function expandColour(pairs: Uint32Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const o = pairs[k] * 4;
    if (o + 3 >= out.length) continue;
    const rgb = pairs[k + 1];
    out[o] = rgb >>> 16;
    out[o + 1] = (rgb >>> 8) & 255;
    out[o + 2] = rgb & 255;
    out[o + 3] = 255;
  }
  return out;
}

/** Half-open pixel bounds. */
export type Bounds = { x0: number; y0: number; x1: number; y1: number };

export function emptyBounds(): Bounds {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function growBounds(b: Bounds, x0: number, y0: number, x1: number, y1: number): void {
  if (x0 < b.x0) b.x0 = x0;
  if (y0 < b.y0) b.y0 = y0;
  if (x1 > b.x1) b.x1 = x1;
  if (y1 > b.y1) b.y1 = y1;
}

/** The part of a full-frame coverage inside `bounds` (or its non-zero pixels); null when empty. */
export function cropCoverage(data: Uint8Array, width: number, height: number, bounds?: Bounds): CoverageRect | null {
  let b = bounds;
  if (!b) {
    b = emptyBounds();
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (data[row + x]) growBounds(b, x, y, x + 1, y + 1);
      }
    }
  }
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(width, Math.ceil(b.x1));
  const y1 = Math.min(height, Math.ceil(b.y1));
  if (!(x1 > x0 && y1 > y0)) return null;
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) out.set(data.subarray((y0 + y) * width + x0, (y0 + y) * width + x1), y * w);
  return { x: x0, y: y0, width: w, height: h, data: out };
}

/**
 * Softens a coverage's edges over about `radius` pixels, growing it first by the blur's reach
 * (clipped to the frame, where the edge value carries on, so the frame's border never fades).
 */
export function featherCoverage(c: CoverageRect, radius: number, frameWidth: number, frameHeight: number): CoverageRect {
  const r = Math.round(radius);
  if (r <= 0) return c;
  const pad = 2 * r + 2;
  const x0 = Math.max(0, c.x - pad);
  const y0 = Math.max(0, c.y - pad);
  const x1 = Math.min(frameWidth, c.x + c.width + pad);
  const y1 = Math.min(frameHeight, c.y + c.height + pad);
  const w = x1 - x0;
  const h = y1 - y0;
  const grown = new Uint8Array(w * h);
  for (let y = 0; y < c.height; y++) grown.set(c.data.subarray(y * c.width, (y + 1) * c.width), (c.y - y0 + y) * w + (c.x - x0));
  return { x: x0, y: y0, width: w, height: h, data: featherMask(grown, w, h, r) };
}

/**
 * What an erase does to a mask: `mask × (1 − coverage)`, or with `outside`, erases everything the
 * coverage does not cover. The same arithmetic the mask canvas does with `destination-out`.
 */
export function eraseWithCoverage(mask: Uint8Array, frameWidth: number, frameHeight: number, c: CoverageRect, outside = false): void {
  if (outside) {
    for (let y = 0; y < frameHeight; y++) {
      const inRows = y >= c.y && y < c.y + c.height;
      const row = y * frameWidth;
      for (let x = 0; x < frameWidth; x++) {
        const inside = inRows && x >= c.x && x < c.x + c.width;
        const keep = inside ? c.data[(y - c.y) * c.width + (x - c.x)] : 0;
        mask[row + x] = Math.round((mask[row + x] * keep) / 255);
      }
    }
    return;
  }
  for (let y = 0; y < c.height; y++) {
    const fy = c.y + y;
    if (fy < 0 || fy >= frameHeight) continue;
    for (let x = 0; x < c.width; x++) {
      const fx = c.x + x;
      if (fx < 0 || fx >= frameWidth) continue;
      const e = c.data[y * c.width + x];
      if (!e) continue;
      const at = fy * frameWidth + fx;
      mask[at] = Math.round((mask[at] * (255 - e)) / 255);
    }
  }
}
