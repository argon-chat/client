import type { RenderTransform, Vec2 } from '../types';

/** Row-major homogeneous matrix for the source plane. */
export type Matrix3 = [number, number, number, number, number, number, number, number, number];
export type Basis2 = [number, number, number, number];
const singular = (): Matrix3 => [NaN, 0, 0, 0, NaN, 0, 0, 0, 1];

export function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  const out = Array<number>(9).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      for (let k = 0; k < 3; k++) out[row * 3 + column] += a[row * 3 + k] * b[k * 3 + column];
    }
  }
  return out as Matrix3;
}

export function inverse(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return singular();
  return [e*i-f*h, c*h-b*i, b*f-c*e, f*g-d*i, a*i-c*g, c*d-a*f, d*h-e*g, b*g-a*h, a*e-b*d]
    .map(value => value / det) as Matrix3;
}

export function project(m: Matrix3, [x, y]: Vec2): Vec2 {
  const w = m[6] * x + m[7] * y + m[8];
  if (Math.abs(w) < 1e-8) return [NaN, NaN];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

/** Exactly the vertex shader: source affine, viewport normalization, Y/X tilt, camera projection. */
export function imageProjection(t: RenderTransform, [w, h]: Vec2, [iw, ih]: Vec2): Matrix3 {
  if (!(w > 0 && h > 0)) return singular();
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation);
  const x = t.flip[0] * t.scale, y = t.flip[1] * t.scale;
  const a = c * x, b = -s * y, d = s * x, e = c * y;
  const affine: Matrix3 = [
    a, b, w / 2 + t.translation[0] - a * iw / 2 - b * ih / 2,
    d, e, h / 2 + t.translation[1] - d * iw / 2 - e * ih / 2,
    0, 0, 1,
  ];
  const [ax, ay] = t.perspective ?? [0, 0];
  const tilt: Matrix3 = [
    Math.cos(ax), 0, 0,
    Math.sin(ax) * Math.sin(ay), Math.cos(ay), 0,
    -Math.sin(ax) * Math.cos(ay) / 2.5, Math.sin(ay) / 2.5, 1,
  ];
  const pixelFromClip: Matrix3 = [w / 2, 0, w / 2, 0, -h / 2, h / 2, 0, 0, 1];
  const clipFromPixel: Matrix3 = [2 / w, 0, -1, 0, -2 / h, 1, 0, 0, 1];
  return multiply(pixelFromClip, multiply(tilt, multiply(clipFromPixel, affine)));
}

/** Exact differential, used for editable DOM handles and brush widths, never raster export. */
export function projectionBasis(m: Matrix3, [x, y]: Vec2): Basis2 {
  const w = m[6] * x + m[7] * y + m[8];
  const u = m[0] * x + m[1] * y + m[2], v = m[3] * x + m[4] * y + m[5];
  const ww = w * w;
  return [(m[0]*w-u*m[6])/ww, (m[3]*w-v*m[6])/ww, (m[1]*w-u*m[7])/ww, (m[4]*w-v*m[7])/ww];
}
export function inverseBasis([a, b, c, d]: Basis2): Basis2 {
  const determinant = a * d - b * c;
  return Math.abs(determinant) > 1e-12 ? [d / determinant, -b / determinant, -c / determinant, a / determinant] : [1, 0, 0, 1];
}
