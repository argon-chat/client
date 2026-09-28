/** Straight (not premultiplied) RGBA bytes. */
export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };

export type Rgba = [number, number, number, number];

/** Photoshop's sample sizes: the average of a square around the pixel, 1 being the pixel itself. */
export const SAMPLE_SIZES = [1, 3, 5, 11] as const;

/** The average colour of the `size`×`size` square centred on (x, y), clipped to the image. */
export function sampleColour(image: RgbaImage, x: number, y: number, size = 1): Rgba {
  const { width, height, data } = image;
  const cx = Math.min(width - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(height - 1, Math.max(0, Math.floor(y)));
  const half = Math.max(0, Math.floor(size / 2));
  const x0 = Math.max(0, cx - half);
  const x1 = Math.min(width - 1, cx + half);
  const y0 = Math.max(0, cy - half);
  const y1 = Math.min(height - 1, cy + half);
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const p = (yy * width + xx) * 4;
      r += data[p];
      g += data[p + 1];
      b += data[p + 2];
      a += data[p + 3];
      n++;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
}

/**
 * Photoshop's tolerance test as four lookup tables: a pixel matches when each of its channels is
 * within `tolerance` (0–255) of the colour's.
 */
export function channelTables(colour: readonly number[], tolerance: number): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const t = Math.min(255, Math.max(0, Math.round(tolerance)));
  const tables = [0, 1, 2, 3].map((c) => {
    const table = new Uint8Array(256);
    const lo = Math.max(0, colour[c] - t);
    const hi = Math.min(255, colour[c] + t);
    table.fill(1, lo, hi + 1);
    return table;
  });
  return tables as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
}

export function hexToRgba(hex: string): Rgba {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const v = Number.parseInt(full, 16);
  if (!Number.isFinite(v)) return [0, 0, 0, 255];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('');
}
