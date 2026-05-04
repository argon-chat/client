import { fitToAspectRatio } from '../geometry';

const MAX_DIMENSION = 2560;
const MIN_DIMENSION = 240;
const HD_MAX = { width: 1920, height: 1080 };
const SD_MAX = { width: 1280, height: 720 };

export interface ExportSizeConstraints {
  sourceWidth: number;
  sourceAspectRatio: number;
  cropAspectRatio: number;
  cropAreaSize: { width: number; height: number };
  zoomScale: number;
  outputMode?: 'video' | 'gif';
  forcedQuality?: number;
}

function roundToEven(n: number): number {
  const floored = Math.floor(n);
  return floored % 2 === 0 ? floored : floored - 1;
}

/**
 * Compute final export dimensions respecting codec limits, minimum sizes, and quality presets.
 */
export function computeExportDimensions(constraints: ExportSizeConstraints): [number, number] {
  const { sourceWidth, sourceAspectRatio, cropAspectRatio, cropAreaSize, zoomScale, outputMode, forcedQuality } = constraints;

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
  if (outputMode === 'video' && (w > HD_MAX.width || h > HD_MAX.height)) {
    [w, h] = fitToAspectRatio(cropAspectRatio, HD_MAX.width, HD_MAX.height);
  }
  if (!outputMode && Math.max(w, h) > MAX_DIMENSION) {
    [w, h] = fitToAspectRatio(cropAspectRatio, MAX_DIMENSION, MAX_DIMENSION);
  }

  // Override with forced quality height if specified
  if (forcedQuality) {
    h = forcedQuality;
    w = forcedQuality * cropAspectRatio;
  }

  // Encoders require even dimensions
  return [roundToEven(w), roundToEven(h)];
}
