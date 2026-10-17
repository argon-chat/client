import type { NicknameStyleTuning } from "@/cosmetics/kinds/nickname-style";

export const WEIGHT_MIN = 100;
export const WEIGHT_MAX = 900;
export const WEIGHT_STEP = 100;
export const DEFAULT_WEIGHT = 600;

export const SPACING_MIN = -10;
export const SPACING_MAX = 50;
export const SPACING_STEP = 1;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Null is "as the face draws it"; anything else is snapped to a hundred and kept within 100–900. */
export function withWeight(tuning: NicknameStyleTuning, weight: number | null): NicknameStyleTuning {
  if (weight === null || !Number.isFinite(weight)) {
    return { ...tuning, weight: null };
  }

  const snapped = Math.round(weight / WEIGHT_STEP) * WEIGHT_STEP;

  return { ...tuning, weight: clamp(snapped, WEIGHT_MIN, WEIGHT_MAX) };
}

/** Null is the face's own spacing; anything else is whole hundredths of an em within −10…50. */
export function withLetterSpacing(tuning: NicknameStyleTuning, centiEm: number | null): NicknameStyleTuning {
  if (centiEm === null || !Number.isFinite(centiEm)) {
    return { ...tuning, letterSpacingCentiEm: null };
  }

  return { ...tuning, letterSpacingCentiEm: clamp(Math.round(centiEm), SPACING_MIN, SPACING_MAX) };
}
