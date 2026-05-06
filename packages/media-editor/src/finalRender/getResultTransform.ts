import type { Vec2 } from '../types';

interface ExportTransformInput {
  scaledWidth: number;
  scaledHeight: number;
  imageWidth: number;
  imageHeight: number;
  cropOffset: { left: number; top: number; width: number; height: number };
  mediaState: {
    scale: number;
    rotation: number;
    translation: Vec2;
    flip: Vec2;
  };
}

/**
 * Compute the GPU transform parameters for final export rendering.
 * Maps from display-space editing state to output-canvas coordinates.
 */
export default function getResultTransform({ scaledWidth, scaledHeight, imageWidth, imageHeight, cropOffset, mediaState }: ExportTransformInput) {
  // Fill the output canvas (cover mode — the larger ratio wins)
  const coverScale = Math.max(scaledWidth / imageWidth, scaledHeight / imageHeight);

  // The user's translation is relative to the crop area (not the full canvas which includes padding).
  // Map from crop-area-relative pixels to output-canvas pixels.
  const xRatio = scaledWidth / cropOffset.width;
  const yRatio = scaledHeight / cropOffset.height;

  return {
    // coverScale fills the output at zoom=1; multiply by user zoom so only the
    // visible portion of the source is rendered (the output dimensions already
    // account for zoom via computeExportDimensions, but the shader still needs
    // the zoom factor to avoid showing the full image squeezed down).
    scale: coverScale * mediaState.scale,
    rotation: mediaState.rotation,
    translation: [
      mediaState.translation[0] * xRatio,
      mediaState.translation[1] * yRatio,
    ] as Vec2,
    flip: mediaState.flip,
    imageSize: [imageWidth, imageHeight] as Vec2,
  };
}
