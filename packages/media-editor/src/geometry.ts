import type { Vec2 } from './types';

/** Restrict a value to a [min, max] interval. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Linear interpolation between two scalars at factor t ∈ [0, 1]. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Element-wise linear interpolation of numeric arrays. */
export function mixArray(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => mix(v, b[i], t));
}

/** Re-map a value from one range to another. */
export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
}

/** Euclidean distance between two 2D points. */
export function pointDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Rotate a point around the origin by a given angle (radians). */
export function rotatePoint(point: Vec2, angle: number): Vec2 {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return [point[0] * c - point[1] * s, point[0] * s + point[1] * c];
}

/**
 * Fit dimensions to an aspect ratio within a bounding box.
 * Returns the largest [width, height] that fits inside (vw × vh) while keeping the given ratio.
 */
export function fitToAspectRatio(ratio: number, vw: number, vh: number): Vec2 {
  if (vw / ratio > vh) vw = vh * ratio;
  else vh = vw / ratio;
  return [vw, vh];
}

/**
 * Compute how much larger one viewport appears relative to another
 * when both are fitted to the same aspect ratio.
 */
export function computeViewportScaleRatio(ratio: number, vw1: number, vh1: number, vw2: number, vh2: number): number {
  [vw1, vh1] = fitToAspectRatio(ratio, vw1, vh1);
  [vw2, vh2] = fitToAspectRatio(ratio, vw2, vh2);
  return Math.max(vw1 / vw2, vh1 / vh2);
}

