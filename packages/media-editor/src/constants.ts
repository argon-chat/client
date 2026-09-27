import type { FontKey, FontInfo, TextStyle, BrushType, Vec2 } from './types';

// ─── Font registry ─────────────────────────────────────────────────

export const FONT_REGISTRY: Record<FontKey, FontInfo> = {
  roboto:    { fontFamily: "'Roboto'",          fontWeight: 500, baseline: 0.75 },
  suez:      { fontFamily: "'Suez One'",        fontWeight: 400, baseline: 0.75 },
  bubbles:   { fontFamily: "'Rubik Bubbles'",   fontWeight: 400, baseline: 0.75 },
  playwrite: { fontFamily: "'Playwrite BE VLG'", fontWeight: 400, baseline: 0.85 },
  chewy:     { fontFamily: "'Chewy'",           fontWeight: 400, baseline: 0.75 },
  courier:   { fontFamily: "'Courier Prime'",   fontWeight: 700, baseline: 0.65 },
  fugaz:     { fontFamily: "'Fugaz One'",       fontWeight: 400, baseline: 0.75 },
  sedan:     { fontFamily: "'Sedan'",           fontWeight: 400, baseline: 0.75 },
};

// ─── Text layer layout ─────────────────────────────────────────────
// TextLayers.vue lays a text layer out with these and the export (drawTextLayer) repeats it.

export const TEXT_PLACEHOLDER = 'Text';
export const TEXT_LINE_HEIGHT = 1.2;
export const TEXT_OUTLINE_WIDTH = 2;
/** `background` style, [x, y]. */
export const TEXT_BACKGROUND_PADDING: Vec2 = [8, 4];
export const TEXT_BACKGROUND_RADIUS = 4;
/** The layer box's `border-2 p-1` and its `min-w-[40px] min-h-[24px]`. */
export const TEXT_BOX_INSET = 6;
export const TEXT_BOX_MIN_SIZE: Vec2 = [40, 24];

// ─── Default values ────────────────────────────────────────────────

export const DEFAULT_TEXT_STYLE: TextStyle = {
  alignment: 'left',
  style: 'outline',
  color: '#ffffff',
  font: 'roboto',
  size: 40,
};

export const DEFAULT_BRUSH = {
  brush: 'pen' as BrushType,
  color: '#fe4438',
  size: 18,
};

// ─── Video output quality presets ──────────────────────────────────

export const QUALITY_PRESETS = [240, 360, 480, 600, 720, 1080] as const;

export function resolveOutputQuality(videoHeight: number): number {
  const SNAP_THRESHOLD = 0.8;
  for (let i = QUALITY_PRESETS.length - 1; i > 0; i--) {
    const upper = QUALITY_PRESETS[i], lower = QUALITY_PRESETS[i - 1];
    if (videoHeight > lower + (upper - lower) * SNAP_THRESHOLD) return upper;
  }
  return QUALITY_PRESETS[0];
}

