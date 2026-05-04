import type { Vec2 } from '../types';

interface ExportTransformInput {
  scaledWidth: number;
  scaledHeight: number;
  imageWidth: number;
  imageHeight: number;
  canvasSize: Vec2;
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
export default function getResultTransform({ scaledWidth, scaledHeight, imageWidth, imageHeight, canvasSize, cropOffset, mediaState }: ExportTransformInput) {
  // Fill the output canvas (cover mode — the larger ratio wins)
  const coverScale = Math.max(scaledWidth / imageWidth, scaledHeight / imageHeight);

  // Map display translation to output coordinate space
  const xRatio = scaledWidth / canvasSize[0];
  const yRatio = scaledHeight / canvasSize[1];

  return {
    scale: coverScale,
    rotation: mediaState.rotation,
    translation: [
      mediaState.translation[0] * xRatio,
      mediaState.translation[1] * yRatio,
    ] as Vec2,
    flip: mediaState.flip,
    imageSize: [imageWidth, imageHeight] as Vec2,
  };
}
