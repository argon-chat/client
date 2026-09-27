import type { Vec2 } from '../types';
import { fitToAspectRatio, rotatePoint } from '../geometry';

export interface QuarterTurnInput {
  scale: number;
  translation: Vec2;
  currentImageRatio: number;
  cropArea: { width: number; height: number };
  /** A fixed crop ratio (1:1, 4:3…) stays; a free one swaps its sides with the image. */
  fixedRatio: boolean;
}

export interface QuarterTurn {
  ratio: number;
  /** The view is scaled by this about the crop centre. */
  factor: number;
  scale: number;
  translation: Vec2;
}

/**
 * Rotate left by 90° keeping the crop: the view turns about the crop's centre, then is scaled so the
 * turned crop still covers the new crop rect (exactly, for a free ratio). Expects a rotation that is
 * a whole number of quarter turns.
 */
export function quarterTurnLeft({ scale, translation, currentImageRatio, cropArea, fixedRatio }: QuarterTurnInput): QuarterTurn {
  const ratio = fixedRatio ? currentImageRatio : 1 / currentImageRatio;
  const [cropW, cropH] = fitToAspectRatio(currentImageRatio, cropArea.width, cropArea.height);
  const [nextW, nextH] = fitToAspectRatio(ratio, cropArea.width, cropArea.height);
  // Turned, the old crop is cropH wide and cropW tall.
  const factor = Math.max(nextW / cropH, nextH / cropW);
  const [tx, ty] = rotatePoint(translation, -Math.PI / 2);
  return { ratio, factor, scale: scale * factor, translation: [tx * factor, ty * factor] };
}
