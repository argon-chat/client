import type { Vec2 } from '../types';
import { distanceFrom, toleranceToDeltaE, type ColourDistance } from './color';
import { cropCoverage, emptyBounds, featherCoverage, growBounds, type CoverageRect } from './coverage';

/** Straight (not premultiplied) RGBA bytes. */
export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };

export type MagicEraseOptions = {
  /** 0–100, see `toleranceToDeltaE`. */
  tolerance: number;
  /** Only the region connected to the clicked pixel; off: that colour everywhere. */
  contiguous: boolean;
  /** Frame pixels. */
  feather: number;
};

/** How far around an edge pixel the colour it blends toward is looked for. */
const MATTE_RADIUS = 2;

/**
 * How much of an edge pixel just outside the erased region goes: it is taken as a blend of the
 * clicked colour and the farthest colour next to it (the subject), erased by the clicked colour's
 * share — `1 − d(pixel) / d(subject)` — so the cut is anti-aliased like the edge it follows.
 */
function matte(
  i: number,
  width: number,
  height: number,
  region: Uint8Array,
  distance: (i: number) => number,
  threshold: number
): number {
  const d = distance(i);
  const x = i % width;
  const y = (i - x) / width;
  let far = d;
  for (let yy = Math.max(0, y - MATTE_RADIUS); yy <= Math.min(height - 1, y + MATTE_RADIUS); yy++) {
    for (let xx = Math.max(0, x - MATTE_RADIUS); xx <= Math.min(width - 1, x + MATTE_RADIUS); xx++) {
      const j = yy * width + xx;
      if (region[j]) continue;
      const dj = distance(j);
      if (dj > far) far = dj;
    }
  }
  if (far <= threshold || far <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - d / far));
}

/**
 * How much the magic eraser takes away when `image` is clicked at `seed` (frame pixels): every
 * pixel within the tolerance of the clicked colour fully, and the pixels along the region's edge in
 * part (see `matte`).
 */
export function magicErase(image: RgbaImage, seed: Vec2, options: MagicEraseOptions): CoverageRect | null {
  const { width, height, data } = image;
  const sx = Math.floor(seed[0]);
  const sy = Math.floor(seed[1]);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return null;

  const threshold = toleranceToDeltaE(options.tolerance);
  const s = (sy * width + sx) * 4;
  const colour: ColourDistance = distanceFrom(data[s], data[s + 1], data[s + 2], data[s + 3]);
  const distance = (i: number) => {
    const p = i * 4;
    return colour(data[p], data[p + 1], data[p + 2], data[p + 3]);
  };
  const n = width * height;
  const region = new Uint8Array(n);
  const erase = new Uint8Array(n);
  const bounds = emptyBounds();

  if (options.contiguous) {
    // Breadth-first, 4-connected, through every pixel within the tolerance.
    const seen = new Uint8Array(n);
    let queue = new Int32Array(Math.min(n, 1 << 16));
    let head = 0;
    let tail = 0;
    const push = (i: number) => {
      if (tail === queue.length) {
        if (head > 0) {
          queue.copyWithin(0, head, tail);
          tail -= head;
          head = 0;
        }
        if (tail === queue.length) {
          const bigger = new Int32Array(Math.min(n, queue.length * 2));
          bigger.set(queue);
          queue = bigger;
        }
      }
      queue[tail++] = i;
    };
    const start = sy * width + sx;
    seen[start] = 1;
    region[start] = 1;
    push(start);
    const visit = (i: number) => {
      if (seen[i]) return;
      seen[i] = 1;
      if (distance(i) > threshold) return;
      region[i] = 1;
      push(i);
    };
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      if (x > 0) visit(i - 1);
      if (x < width - 1) visit(i + 1);
      if (i >= width) visit(i - width);
      if (i < n - width) visit(i + width);
    }
  } else {
    for (let i = 0; i < n; i++) if (distance(i) <= threshold) region[i] = 1;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (region[i]) {
        erase[i] = 255;
        growBounds(bounds, x, y, x + 1, y + 1);
        continue;
      }
      const edge = (x > 0 && region[i - 1]) || (x < width - 1 && region[i + 1]) || (y > 0 && region[i - width]) || (y < height - 1 && region[i + width]);
      if (!edge) continue;
      const v = Math.round(255 * matte(i, width, height, region, distance, threshold));
      if (v <= 0) continue;
      erase[i] = v;
      growBounds(bounds, x, y, x + 1, y + 1);
    }
  }

  const cropped = cropCoverage(erase, width, height, bounds);
  if (!cropped) return null;
  return featherCoverage(cropped, options.feather, width, height);
}
