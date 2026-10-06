import { fitToAspectRatio } from '../geometry';
import type { ExpressionEditorMode, Vec2 } from '../types';

const MAX_DIMENSION = 2560;
const MIN_DIMENSION = 240;
const HD_MAX = { width: 1920, height: 1080 };
const SD_MAX = { width: 1280, height: 720 };

/**
 * Sticker: the longer side is exactly 512, the other keeps the aspect (no padding).
 * Emoji: the crop fits inside 100×100 and the canvas is always 100×100 (transparent padding).
 */
export const EXPRESSION_EXPORT_PRESETS = {
  sticker: { box: 512, pad: false },
  emoji: { box: 100, pad: true },
} as const satisfies Record<ExpressionEditorMode, { box: number; pad: boolean }>;

export interface ExportSizeConstraints {
  sourceWidth: number;
  sourceAspectRatio: number;
  cropAspectRatio: number;
  cropAreaSize: { width: number; height: number };
  zoomScale: number;
  outputMode?: 'video' | 'gif' | ExpressionEditorMode;
  /** The output's short side. */
  forcedQuality?: number;
}

// Nearest, not floor: a 400 px crop computed as 399.9998 must not lose 2 px, which the cover
// mapping would then cut off its sides. The caps are even, so this never rounds past one.
function roundToEven(n: number): number {
  return Math.max(2, 2 * Math.round(n / 2));
}

/** The rendered content of an expression export: `box` on the longer side, at least 1 on the other. */
export function fitExpressionContent(mode: ExpressionEditorMode, cropAspectRatio: number): Vec2 {
  const { box } = EXPRESSION_EXPORT_PRESETS[mode];
  const ratio = cropAspectRatio > 0 && Number.isFinite(cropAspectRatio) ? cropAspectRatio : 1;
  if (ratio >= 1) return [box, Math.min(box, Math.max(1, Math.round(box / ratio)))];
  return [Math.min(box, Math.max(1, Math.round(box * ratio))), box];
}

export type ExpressionExportLayout = {
  /** The file's size. */
  canvas: Vec2;
  /** Where the rendered crop goes in it. */
  content: { x: number; y: number; width: number; height: number };
};

export function computeExpressionLayout(mode: ExpressionEditorMode, cropAspectRatio: number): ExpressionExportLayout {
  const [width, height] = fitExpressionContent(mode, cropAspectRatio);
  const preset = EXPRESSION_EXPORT_PRESETS[mode];
  if (!preset.pad) return { canvas: [width, height], content: { x: 0, y: 0, width, height } };
  const side = preset.box;
  return {
    canvas: [side, side],
    content: { x: Math.floor((side - width) / 2), y: Math.floor((side - height) / 2), width, height }
  };
}

/**
 * Compute final export dimensions respecting codec limits, minimum sizes, and quality presets.
 * For the expression modes this is the rendered content; see `computeExpressionLayout` for the canvas.
 */
export function computeExportDimensions(constraints: ExportSizeConstraints): [number, number] {
  const { sourceWidth, sourceAspectRatio, cropAspectRatio, cropAreaSize, zoomScale, outputMode, forcedQuality } = constraints;

  if (outputMode === 'sticker' || outputMode === 'emoji') {
    return fitExpressionContent(outputMode, cropAspectRatio);
  }

  // Determine how much of the source image is visible through the crop
  const [visibleW] = fitToAspectRatio(sourceAspectRatio, cropAreaSize.width, cropAreaSize.height);
  const [croppedW] = fitToAspectRatio(cropAspectRatio, cropAreaSize.width, cropAreaSize.height);

  let w = (croppedW / (visibleW * zoomScale)) * sourceWidth;
  let h = w / cropAspectRatio;

  // Apply minimum size floor
  if (Math.max(w, h) < MIN_DIMENSION) {
    [w, h] = fitToAspectRatio(cropAspectRatio, MIN_DIMENSION, MIN_DIMENSION);
  }

  // Apply codec maximum ceilings
  if (outputMode === 'gif' && (w > SD_MAX.width || h > SD_MAX.height)) {
    [w, h] = fitToAspectRatio(cropAspectRatio, SD_MAX.width, SD_MAX.height);
  }
  // 1080p either way round: a portrait video keeps 1080 across, as the host's ladder does.
  if (outputMode === 'video') {
    const [boxW, boxH] = cropAspectRatio >= 1 ? [HD_MAX.width, HD_MAX.height] : [HD_MAX.height, HD_MAX.width];
    if (w > boxW || h > boxH) [w, h] = fitToAspectRatio(cropAspectRatio, boxW, boxH);
  }
  if (!outputMode && Math.max(w, h) > MAX_DIMENSION) {
    [w, h] = fitToAspectRatio(cropAspectRatio, MAX_DIMENSION, MAX_DIMENSION);
  }

  // A forced quality is the short side.
  if (forcedQuality) {
    if (cropAspectRatio >= 1) {
      h = forcedQuality;
      w = forcedQuality * cropAspectRatio;
    } else {
      w = forcedQuality;
      h = forcedQuality / cropAspectRatio;
    }
  }

  // Encoders require even dimensions
  return [roundToEven(w), roundToEven(h)];
}
