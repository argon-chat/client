import type { FontKey, FontInfo, TextStyle, BrushType } from './types';

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

