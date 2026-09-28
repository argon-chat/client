import type { RgbaImage } from './sample';

// Colour decontamination for the erasers' anti-aliased edges. A pixel on the boundary of an erased
// region is usually a blend of the erased (background) colour and the colour beside it: `px =
// a·fg + (1 − a)·bg`. Its foreground share `a` is its position on the line from the local
// background to the neighbouring colour that explains it best; erasing `1 − a` of it and giving it
// back `fg = (px − (1 − a)·bg) / a` leaves no background rim on the cut-out edge.

/** Region codes in the erasers' scratch maps (REGION is 255: the map is then a full erase). */
export const OUT_OF_REACH = 0;
export const IN_REACH = 1;
export const REGION = 255;

/** Background and neighbour closer than this (RGB distance) are not told apart. */
const MIN_CONTRAST_SQ = 24 * 24;
/** How far off the blend line a pixel may sit: 12 levels, or a quarter of the contrast. */
const RESIDUAL_FLOOR_SQ = 12 * 12;
const RESIDUAL_SHARE_SQ = 0.25 * 0.25;
const RADIUS = 2;

/** A kept share below this is too little to un-blend reliably: the neighbour's colour weighs in. */
const RELIABLE_SHARE = 0.25;

/**
 * The foreground share (0–1) of pixel `i`, a pixel on the boundary of `region` (codes above), or
 * −1 when it is no blend of the background and a neighbouring colour. `bg` gets the local
 * background (the mean of the region's pixels around it, or `fallback`) as RGBA in 0–3 and the
 * neighbouring colour that explains the pixel as RGB in 4–6.
 */
export function edgeMatte(image: RgbaImage, region: Uint8Array, i: number, fallback: readonly number[], bg: Float32Array): number {
  const { width, height, data } = image;
  const x = i % width;
  const y = (i - x) / width;
  const x0 = Math.max(0, x - RADIUS);
  const x1 = Math.min(width - 1, x + RADIUS);
  const y0 = Math.max(0, y - RADIUS);
  const y1 = Math.min(height - 1, y + RADIUS);

  // The region's pixels away from its boundary (the ones on it are blends themselves), or any.
  let br = 0, bgn = 0, bb = 0, ba = 0, bn = 0;
  let ar = 0, ag = 0, ab = 0, aa = 0, an = 0;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const j = yy * width + xx;
      if (j === i || region[j] !== REGION) continue;
      const q = j * 4;
      const interior =
        (xx === 0 || region[j - 1] === REGION) &&
        (xx === width - 1 || region[j + 1] === REGION) &&
        (yy === 0 || region[j - width] === REGION) &&
        (yy === height - 1 || region[j + width] === REGION);
      if (interior) {
        br += data[q];
        bgn += data[q + 1];
        bb += data[q + 2];
        ba += data[q + 3];
        bn++;
      } else {
        ar += data[q];
        ag += data[q + 1];
        ab += data[q + 2];
        aa += data[q + 3];
        an++;
      }
    }
  }
  if (!bn && an) {
    br = ar;
    bgn = ag;
    bb = ab;
    ba = aa;
    bn = an;
  }
  if (bn) {
    bg[0] = br / bn;
    bg[1] = bgn / bn;
    bg[2] = bb / bn;
    bg[3] = ba / bn;
  } else {
    bg[0] = fallback[0];
    bg[1] = fallback[1];
    bg[2] = fallback[2];
    bg[3] = fallback[3];
  }

  const p = i * 4;
  const vr = data[p] - bg[0];
  const vg = data[p + 1] - bg[1];
  const vb = data[p + 2] - bg[2];
  let best = -1;
  let share = 0;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const j = yy * width + xx;
      if (region[j] === REGION) continue;
      const q = j * 4;
      const dr = data[q] - bg[0];
      const dg = data[q + 1] - bg[1];
      const db = data[q + 2] - bg[2];
      const dd = dr * dr + dg * dg + db * db;
      // The farthest colour that explains the pixel: a nearer one may itself be a blend.
      if (dd < MIN_CONTRAST_SQ || dd <= best) continue;
      const t = Math.min(1, Math.max(0, (vr * dr + vg * dg + vb * db) / dd));
      const er = vr - t * dr;
      const eg = vg - t * dg;
      const eb = vb - t * db;
      if (er * er + eg * eg + eb * eb > Math.max(RESIDUAL_FLOOR_SQ, RESIDUAL_SHARE_SQ * dd)) continue;
      best = dd;
      share = t;
      bg[4] = data[q];
      bg[5] = data[q + 1];
      bg[6] = data[q + 2];
    }
  }
  return best < 0 ? -1 : share;
}

/**
 * The colour pixel `p` (byte offset) keeps once `e` (0–1) of it, the background (`m`'s 0–2 from
 * `edgeMatte`), is taken out: (px − e·bg) / (1 − e). The less of it is kept, the more that
 * division magnifies noise, so a pixel keeping under a quarter leans on the neighbouring colour
 * (`m`'s 4–6) instead.
 */
export function unblend(data: RgbaImage['data'], p: number, m: ArrayLike<number>, e: number): number {
  const kept = 1 - e;
  const k = 1 / kept;
  const w = Math.min(1, kept / RELIABLE_SHARE);
  const channel = (c: number) => {
    const u = Math.min(255, Math.max(0, (data[p + c] - e * m[c]) * k));
    return Math.round(m[4 + c] + w * (u - m[4 + c]));
  };
  return (channel(0) << 16) | (channel(1) << 8) | channel(2);
}

/** A background with no colour to speak of (mostly transparent) is not taken out of a pixel. */
export const hasBackgroundColour = (bg: ArrayLike<number>) => bg[3] >= 250;

/** Frame-indexed colours as pairs indexed within the box; null when none falls in it. */
export function pairsIn(colours: Map<number, number>, width: number, x0: number, y0: number, x1: number, y1: number): Uint32Array | null {
  if (!colours.size) return null;
  const out = new Uint32Array(colours.size * 2);
  let k = 0;
  for (const [i, rgb] of colours) {
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0 || y < y0 || x >= x1 || y >= y1) continue;
    out[k++] = (y - y0) * (x1 - x0) + (x - x0);
    out[k++] = rgb;
  }
  return k ? out.slice(0, k) : null;
}

/**
 * Colour padding: a pixel erased in full next to one that stays takes that one's colour. It is
 * invisible itself, but the export and the view filter the image when they scale it, and the
 * erased background's colour would otherwise bleed into the kept edge.
 */
export function padColours(image: RgbaImage, kept: ArrayLike<number>, erased: (i: number) => number, colours: Map<number, number>): void {
  const { width, height, data } = image;
  const pads = new Map<number, number>();
  for (let k = 0; k < kept.length; k++) {
    const i = kept[k];
    if (erased(i) >= 255) continue;
    let c = colours.get(i);
    if (c === undefined) {
      const p = i * 4;
      c = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2];
    }
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if ((!dx && !dy) || nx < 0 || nx >= width) continue;
        const j = ny * width + nx;
        if (erased(j) >= 255 && !colours.has(j) && !pads.has(j)) pads.set(j, c);
      }
    }
  }
  for (const [j, c] of pads) colours.set(j, c);
}
