import type { AdjustmentKey } from './adjustments';

export interface Preset {
  id: string;
  labelKey: string;
  values: Partial<Record<AdjustmentKey, number>>;
}

export const PRESETS: Preset[] = [
  {
    id: 'none',
    labelKey: 'media_editor_preset_none',
    values: {},
  },
  {
    id: 'vivid',
    labelKey: 'media_editor_preset_vivid',
    values: { saturation: 0.4, contrast: 0.15, brightness: 0.05 },
  },
  {
    id: 'warm_film',
    labelKey: 'media_editor_preset_warm_film',
    values: { warmth: 0.35, fade: 0.15, grain: 0.2, vignette: 0.3, saturation: -0.1 },
  },
  {
    id: 'cool_tone',
    labelKey: 'media_editor_preset_cool_tone',
    values: { warmth: -0.3, brightness: 0.05, contrast: 0.1, saturation: -0.15 },
  },
  {
    id: 'noir',
    labelKey: 'media_editor_preset_noir',
    values: { saturation: -1.0, contrast: 0.35, vignette: 0.5, grain: 0.15 },
  },
  {
    id: 'faded',
    labelKey: 'media_editor_preset_faded',
    values: { fade: 0.4, saturation: -0.2, brightness: 0.1, contrast: -0.1 },
  },
  {
    id: 'dramatic',
    labelKey: 'media_editor_preset_dramatic',
    values: { contrast: 0.4, shadows: -0.3, highlights: 0.2, saturation: 0.1, vignette: 0.4 },
  },
  {
    id: 'sunrise',
    labelKey: 'media_editor_preset_sunrise',
    values: { warmth: 0.5, brightness: 0.15, highlights: 0.3, saturation: 0.2 },
  },
  {
    id: 'cyberpunk',
    labelKey: 'media_editor_preset_cyberpunk',
    values: { chromatic: 0.3, glitch: 0.15, saturation: 0.3, contrast: 0.2, warmth: -0.2 },
  },
  {
    id: 'dreamy',
    labelKey: 'media_editor_preset_dreamy',
    values: { tiltShift: 0.4, fade: 0.2, brightness: 0.1, warmth: 0.15, saturation: 0.15 },
  },
  {
    id: 'retro',
    labelKey: 'media_editor_preset_retro',
    values: { grain: 0.35, fade: 0.3, warmth: 0.2, saturation: -0.2, vignette: 0.35, contrast: 0.1 },
  },
];
