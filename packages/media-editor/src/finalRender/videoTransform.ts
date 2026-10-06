import { fitToAspectRatio } from '../geometry';
import type { Vec2 } from '../types';
import type { EditingMediaState } from '../store/editorStore';

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface SourceCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The editor's geometry as a converter takes it (mediabunny's order): turn the source clockwise by
 * `rotate`, mirror it horizontally when `flip`, then cut `crop` out of that frame. Sizes are display
 * pixels of the source.
 */
export interface SourceVideoTransform {
  rotate: QuarterTurn;
  flip: boolean;
  /** null: the whole (turned) frame. */
  crop: SourceCrop | null;
  /** The frame after all three. */
  width: number;
  height: number;
}

type GeometryState = Pick<EditingMediaState, 'scale' | 'rotation' | 'translation' | 'flip' | 'perspective' | 'currentImageRatio'>;

const TURN_EPSILON = 1e-3;

/**
 * The crop, quarter turn and mirror of `state` in source pixels, or null when the view is turned by
 * an angle that is not a quarter turn or tilted in perspective (then only rendering reproduces it).
 *
 * The editor draws a source pixel `p` at `R(rotation) · F(flip) · k · (p − centre) + translation`
 * (crop-area pixels, origin at the crop's centre, y down, clockwise), with `k` the crop-area pixels per
 * source pixel. `R · F` equals mediabunny's mirror-after-turn for the turn and mirror chosen here, so
 * the crop rect maps into the turned frame as `(q − translation) / k + centre'`.
 */
export function sourceVideoTransform(state: GeometryState, mediaSize: Vec2, cropArea: { width: number; height: number }): SourceVideoTransform | null {
  const [mediaW, mediaH] = mediaSize;
  if (!(mediaW > 0 && mediaH > 0 && cropArea.width > 0 && cropArea.height > 0)) return null;
  if (Math.abs(state.perspective?.[0] ?? 0) > 1e-6 || Math.abs(state.perspective?.[1] ?? 0) > 1e-6) return null;

  const turns = state.rotation / (Math.PI / 2);
  const whole = Math.round(turns);
  if (Math.abs(turns - whole) > TURN_EPSILON) return null;
  const theta = ((whole % 4) + 4) % 4 * 90;

  const mirrorX = state.flip[0] < 0;
  const mirrorY = state.flip[1] < 0;
  let rotate: number;
  let flip: boolean;
  if (!mirrorX && !mirrorY) [rotate, flip] = [theta, false];
  else if (mirrorX && !mirrorY) [rotate, flip] = [-theta, true];
  else if (!mirrorX && mirrorY) [rotate, flip] = [180 - theta, true];
  else [rotate, flip] = [theta + 180, false];
  rotate = (((rotate % 360) + 360) % 360) as QuarterTurn;

  const [frameW, frameH] = rotate % 180 === 0 ? [mediaW, mediaH] : [mediaH, mediaW];
  const imageRatio = mediaW / mediaH;
  const cropRatio = state.currentImageRatio > 0 ? state.currentImageRatio : imageRatio;
  const [fittedW] = fitToAspectRatio(imageRatio, cropArea.width, cropArea.height);
  const [cropW, cropH] = fitToAspectRatio(cropRatio, cropArea.width, cropArea.height);
  const k = (state.scale * fittedW) / mediaW;
  if (!(k > 0)) return null;

  const [tx, ty] = state.translation;
  const rawLeft = frameW / 2 + (-cropW / 2 - tx) / k;
  const rawTop = frameH / 2 + (-cropH / 2 - ty) / k;
  const left = clampInt(rawLeft, 0, frameW - 2);
  const top = clampInt(rawTop, 0, frameH - 2);
  const width = clampInt(rawLeft + cropW / k, left + 2, frameW) - left;
  const height = clampInt(rawTop + cropH / k, top + 2, frameH) - top;

  const full = left === 0 && top === 0 && width === frameW && height === frameH;
  return {
    rotate: rotate as QuarterTurn,
    flip,
    crop: full ? null : { left, top, width, height },
    width,
    height,
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

const zero = (v: number | undefined) => Math.abs(v ?? 0) < 1e-6;

/**
 * Whether the state changes the pixels themselves (drawing, text, stickers, adjustments, presets,
 * curves, selective colour, perspective, a mask or outline), as opposed to only where the frame is
 * cut, turned and mirrored.
 */
export function hasPixelEdits(state: EditingMediaState): boolean {
  if (state.brushDrawnLines.length || state.resizableLayers.length) return true;
  if (Object.values(state.adjustments).some((v) => !zero(v))) return true;
  const { r, g, b } = state.curves ?? { r: [0, 0], g: [0, 0], b: [0, 0] };
  if (![...r, ...g, ...b].every((v) => zero(v))) return true;
  if (state.selective && Object.values(state.selective).some((v) => !zero(v))) return true;
  if (!zero(state.perspective?.[0]) || !zero(state.perspective?.[1])) return true;
  if (state.mask && (state.mask.source !== null || state.mask.strokes.length)) return true;
  if (state.outline?.enabled) return true;
  return false;
}
