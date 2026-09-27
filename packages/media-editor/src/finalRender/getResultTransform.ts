import { fitToAspectRatio } from '../geometry';
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
    currentImageRatio: number;
  };
}

/**
 * The GPU transform that puts the crop rect onto a `scaledWidth × scaledHeight` output.
 *
 * Editor units (CropHandles, computeCropBounds): at scale 1 the image is contained in the crop area,
 * the crop rect is `currentImageRatio` contained in it and centred, and the translation is in those
 * pixels. So one crop-area pixel becomes `k` output pixels, where `k` maps the crop rect onto the
 * output (the larger of the two ratios, so a rounded output size never leaves an empty edge).
 */
export default function getResultTransform({ scaledWidth, scaledHeight, imageWidth, imageHeight, cropOffset, mediaState }: ExportTransformInput) {
  const imageRatio = imageWidth / imageHeight;
  const cropRatio = mediaState.currentImageRatio > 0 ? mediaState.currentImageRatio : imageRatio;
  const [fittedWidth] = fitToAspectRatio(imageRatio, cropOffset.width, cropOffset.height);
  const [cropWidth, cropHeight] = fitToAspectRatio(cropRatio, cropOffset.width, cropOffset.height);
  const k = Math.max(scaledWidth / cropWidth, scaledHeight / cropHeight);

  return {
    scale: mediaState.scale * (fittedWidth / imageWidth) * k,
    rotation: mediaState.rotation,
    translation: [mediaState.translation[0] * k, mediaState.translation[1] * k] as Vec2,
    flip: mediaState.flip,
    imageSize: [imageWidth, imageHeight] as Vec2,
  };
}
