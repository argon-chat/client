import type { RenderTransform, Vec2 } from '../types';

/** Mask rasters are kept at source resolution up to this long side. */
export const MAX_MASK_SIDE = 2048;

export function maskResolution(width: number, height: number, max = MAX_MASK_SIDE): Vec2 {
  const long = Math.max(width, height);
  if (long <= max) return [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
  const k = max / long;
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

// ─── Premultiplied alpha ───────────────────────────────────────────
// The shader samples a premultiplied texture (so filtering never pulls in the colour of transparent
// texels), un-premultiplies for the colour maths and premultiplies again on output. These are the
// same steps on 0–1 floats, for the CPU paths and for tests.

export type Rgba = [number, number, number, number];

export function premultiply([r, g, b, a]: Rgba): Rgba {
  return [r * a, g * a, b * a, a];
}

export function unpremultiply([r, g, b, a]: Rgba): Rgba {
  if (a <= 1e-5) return [0, 0, 0, 0];
  return [Math.min(1, r / a), Math.min(1, g / a), Math.min(1, b / a), a];
}

/** Blend two straight-alpha colours the way a filtering sampler does over a premultiplied texture. */
export function mixPremultiplied(x: Rgba, y: Rgba, t: number): Rgba {
  const px = premultiply(x);
  const py = premultiply(y);
  return unpremultiply([
    px[0] + (py[0] - px[0]) * t,
    px[1] + (py[1] - px[1]) * t,
    px[2] + (py[2] - px[2]) * t,
    px[3] + (py[3] - px[3]) * t,
  ]);
}

/** Straight-alpha RGBA8 with the mask multiplied into its alpha (colour untouched). */
export function applyMaskToRgba(rgba: Uint8ClampedArray, mask: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rgba);
  const n = Math.min(mask.length, rgba.length >> 2);
  for (let i = 0; i < n; i++) {
    const at = i * 4 + 3;
    out[at] = Math.round((rgba[at] * mask[i]) / 255);
  }
  return out;
}

// ─── Feathering ────────────────────────────────────────────────────

function boxBlurPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const lines = horizontal ? h : w;
  const len = horizontal ? w : h;
  const stride = horizontal ? 1 : w;
  const norm = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w : line;
    const at = (i: number) => base + Math.min(len - 1, Math.max(0, i)) * stride;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[at(i)];
    for (let i = 0; i < len; i++) {
      dst[base + i * stride] = sum * norm;
      sum += src[at(i + r + 1)] - src[at(i - r)];
    }
  }
}

/**
 * Softens the mask's edges over about `radius` pixels (two box passes each way: a tent filter).
 * Flat regions stay exactly 0 or 255; the edge ramp keeps its midpoint.
 */
export function featherMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.round(radius);
  if (r <= 0 || width <= 0 || height <= 0) return mask.slice();
  const a = Float32Array.from(mask);
  const b = new Float32Array(a.length);
  const half = Math.max(1, Math.round(r / 2));
  boxBlurPass(a, b, width, height, half, true);
  boxBlurPass(b, a, width, height, half, false);
  boxBlurPass(a, b, width, height, half, true);
  boxBlurPass(b, a, width, height, half, false);
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i]);
  return out;
}

// ─── Canvas ↔ source mapping ───────────────────────────────────────
// The vertex shader moves a source pixel to the canvas as: centre it, mirror and zoom, rotate by
// -rotation, re-centre in the viewport, add the translation. Perspective is not modelled here.

export function sourceToCanvas(point: Vec2, t: RenderTransform, viewport: Vec2, imageSize: Vec2): Vec2 {
  let x = (point[0] - imageSize[0] / 2) * t.flip[0] * t.scale;
  let y = (point[1] - imageSize[1] / 2) * t.flip[1] * t.scale;
  const a = -t.rotation;
  const c = Math.cos(a);
  const s = Math.sin(a);
  [x, y] = [x * c + y * s, y * c - x * s];
  return [x + viewport[0] / 2 + t.translation[0], y + viewport[1] / 2 + t.translation[1]];
}

export function canvasToSource(point: Vec2, t: RenderTransform, viewport: Vec2, imageSize: Vec2): Vec2 {
  const qx = point[0] - viewport[0] / 2 - t.translation[0];
  const qy = point[1] - viewport[1] / 2 - t.translation[1];
  const a = -t.rotation;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = qx * c - qy * s;
  const y = qx * s + qy * c;
  const kx = t.flip[0] * t.scale || 1;
  const ky = t.flip[1] * t.scale || 1;
  return [x / kx + imageSize[0] / 2, y / ky + imageSize[1] / 2];
}

// ─── Outline ───────────────────────────────────────────────────────

export const OUTLINE_MAX_RADIUS = 24;
export const DEFAULT_OUTLINE_COLOR = '#ffffff';

/** An output-pixel radius in canvas pixels, given both scales in pixels per source pixel. */
export function outlineRadiusOnCanvas(radius: number, canvasScale: number, outputScale: number): number {
  if (!(radius > 0) || !(outputScale > 0)) return 0;
  return (radius * canvasScale) / outputScale;
}

/**
 * Jump-flood step sizes for distances up to `maxDistance`: halving powers of two, whose sum reaches
 * it, then one more step of 1 (JFA+1) to mend the flood's few wrong seeds.
 */
export function jfaSteps(maxDistance: number): number[] {
  if (!(maxDistance > 0)) return [];
  let step = 1;
  while (step * 2 - 1 < maxDistance) step *= 2;
  const steps: number[] = [];
  for (let k = step; k >= 1; k /= 2) steps.push(k);
  steps.push(1);
  return steps;
}

/**
 * Coverage of the outline at `distance` from the nearest opaque pixel centre. The shape's edge is
 * half a pixel beyond those centres and the pixel's own extent adds another half, so the ramp is
 * one pixel wide ending at `radius + 1`.
 */
export function outlineCoverage(distance: number, radius: number): number {
  if (!(radius > 0)) return 0;
  return Math.min(1, Math.max(0, radius + 1 - distance));
}
