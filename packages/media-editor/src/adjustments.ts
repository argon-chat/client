export interface AdjustmentDef {
  uniform: string;
  labelKey: string;
  icon: string;
  /** [min, max] — unipolar effects use [0, 100], bipolar use [-100, 100] */
  range: [number, number];
}

export const ADJUSTMENTS = {
  enhance:    { uniform: 'uEnhance',    labelKey: 'media_editor_enhance',    icon: 'sparkles',    range: [0, 100] },
  brightness: { uniform: 'uBrightness', labelKey: 'media_editor_brightness', icon: 'sun',         range: [-100, 100] },
  contrast:   { uniform: 'uContrast',   labelKey: 'media_editor_contrast',   icon: 'contrast',    range: [-100, 100] },
  saturation: { uniform: 'uSaturation', labelKey: 'media_editor_saturation', icon: 'droplets',    range: [-100, 100] },
  warmth:     { uniform: 'uWarmth',     labelKey: 'media_editor_warmth',     icon: 'thermometer', range: [-100, 100] },
  fade:       { uniform: 'uFade',       labelKey: 'media_editor_fade',       icon: 'cloud-fog',   range: [0, 100] },
  highlights: { uniform: 'uHighlights', labelKey: 'media_editor_highlights', icon: 'sunrise',     range: [-100, 100] },
  shadows:    { uniform: 'uShadows',    labelKey: 'media_editor_shadows',    icon: 'moon',        range: [-100, 100] },
  vignette:   { uniform: 'uVignette',   labelKey: 'media_editor_vignette',   icon: 'aperture',    range: [0, 100] },
  grain:      { uniform: 'uGrain',      labelKey: 'media_editor_grain',      icon: 'scan-line',   range: [0, 100] },
  sharpen:    { uniform: 'uSharpen',    labelKey: 'media_editor_sharpen',    icon: 'diamond',     range: [0, 100] },
} as const satisfies Record<string, AdjustmentDef>;

export type AdjustmentKey = keyof typeof ADJUSTMENTS;

/** Ordered list for UI rendering */
export const adjustmentKeys: AdjustmentKey[] = Object.keys(ADJUSTMENTS) as AdjustmentKey[];

/** Array format for UI iteration */
export const adjustmentsConfig = adjustmentKeys.map(key => ({
  key,
  ...ADJUSTMENTS[key],
  to100: ADJUSTMENTS[key].range[0] === 0,
}));

export type AdjustmentsConfig = typeof adjustmentsConfig;
