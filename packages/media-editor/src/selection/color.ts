// Colour distance for the erasers: CIE76 ΔE in L*a*b* (D65), with alpha as a fourth axis so an
// opaque colour never matches a transparent pixel.

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const WHITE_X = 0.95047;
const WHITE_Z = 1.08883;
const EPSILON = 216 / 24389;
const KAPPA = 24389 / 27;

const f = (t: number) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);

/** sRGB bytes → L*a*b*, written to `out` at `offset`. */
export function rgbToLabInto(r: number, g: number, b: number, out: Float32Array | number[], offset = 0): void {
  const lr = SRGB_TO_LINEAR[r];
  const lg = SRGB_TO_LINEAR[g];
  const lb = SRGB_TO_LINEAR[b];
  const fx = f((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / WHITE_X);
  const fy = f(0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb);
  const fz = f((0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / WHITE_Z);
  out[offset] = 116 * fy - 16;
  out[offset + 1] = 500 * (fx - fy);
  out[offset + 2] = 200 * (fy - fz);
}

export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  rgbToLabInto(r, g, b, out);
  return out;
}

export function deltaE76(p: ArrayLike<number>, q: ArrayLike<number>): number {
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Full transparency against full opacity counts as ΔE 100, the distance from black to white. */
const ALPHA_WEIGHT = 100 / 255;

/**
 * The 0–100 tolerance slider as a ΔE threshold: 0 is the exact colour, 25 ≈ 19 (clearly different
 * colours stay), 50 = 50, 100 = 150 (nearly everything).
 */
export function toleranceToDeltaE(tolerance: number): number {
  const t = Math.min(100, Math.max(0, tolerance));
  return t * (0.5 + t / 100);
}

/** Width of the anti-aliased ramp past the threshold. */
export function matchBand(threshold: number): number {
  return Math.max(1.5, threshold * 0.35);
}

/** 1 up to the threshold, falling linearly to 0 across the band after it. */
export function colourMatch(distance: number, threshold: number, band = matchBand(threshold)): number {
  if (distance <= threshold) return 1;
  const t = (distance - threshold) / band;
  return t >= 1 ? 0 : 1 - t;
}

export type ColourDistance = (r: number, g: number, b: number, a: number) => number;

/**
 * Distance from one colour (straight RGBA bytes). Photos repeat colours, so a small direct-mapped
 * cache keyed by the packed RGBA skips most of the Lab conversions.
 */
export function distanceFrom(r: number, g: number, b: number, a: number, cacheBits = 14): ColourDistance {
  const seed = new Float32Array(3);
  rgbToLabInto(r, g, b, seed);
  const lab = new Float32Array(3);
  const keys = new Float64Array(1 << cacheBits).fill(-1);
  const values = new Float32Array(1 << cacheBits);
  const shift = 32 - cacheBits;
  return (pr, pg, pb, pa) => {
    const key = ((pr << 24) | (pg << 16) | (pb << 8) | pa) >>> 0;
    const slot = Math.imul(key, 0x9e3779b1) >>> shift;
    if (keys[slot] === key) return values[slot];
    rgbToLabInto(pr, pg, pb, lab);
    const da = (pa - a) * ALPHA_WEIGHT;
    const d = Math.sqrt((lab[0] - seed[0]) ** 2 + (lab[1] - seed[1]) ** 2 + (lab[2] - seed[2]) ** 2 + da * da);
    keys[slot] = key;
    values[slot] = d;
    return d;
  };
}
