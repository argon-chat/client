import type { Vec2 } from '../types';
import { fitToAspectRatio, rotatePoint } from '../geometry';

export interface CropBoundsInput {
  rotation: number;
  translation: Vec2;
  scale: number;
  mediaSize: Vec2;
  currentImageRatio: number;
  cropOffset: { left: number; top: number; width: number; height: number };
  extendCrop?: [Vec2, Vec2];
}

export interface CropBoundingBox {
  cropMinX: number;
  cropMaxX: number;
  cropMinY: number;
  cropMaxY: number;
  imageMinX: number;
  imageMaxX: number;
  imageMinY: number;
  imageMaxY: number;
}

/**
 * Compute bounding boxes for the image and crop region after transforms.
 * All coordinates are relative to the crop area center.
 *
 * The coordinate system here uses screen convention (Y positive = down)
 * to match the WebGPU shader which flips Y for clip space.
 */
export function computeCropBounds(input: CropBoundsInput): CropBoundingBox {
  const {
    scale,
    translation,
    rotation,
    mediaSize,
    currentImageRatio,
    cropOffset,
    extendCrop = [[0, 0], [0, 0]],
  } = input;

  const [mw, mh] = mediaSize;
  const [imgW, imgH] = fitToAspectRatio(mw / mh, cropOffset.width, cropOffset.height);

  // Four corners of the image in local space (centered at origin)
  const halfW = imgW / 2;
  const halfH = imgH / 2;
  const corners: Vec2[] = [
    [-halfW,  halfH],
    [ halfW,  halfH],
    [ halfW, -halfH],
    [-halfW, -halfH],
  ];

  // Transform each corner: rotate → scale → translate → un-rotate (for axis-aligned bounds)
  // The shader rotates CW on screen for positive rotation; rotatePoint(pt, R) in Y-down = CW.
  const imagePoints = corners.map(pt => {
    let [x, y] = rotatePoint(pt, rotation);
    x *= scale;
    y *= scale;
    x += translation[0];
    y += translation[1];
    return rotatePoint([x, y], -rotation);
  });

  // Compute actual min/max from all transformed corners (not hardcoded indices)
  const imageXs = imagePoints.map(p => p[0]);
  const imageYs = imagePoints.map(p => p[1]);

  // Crop area corners
  const [cropW, cropH] = fitToAspectRatio(currentImageRatio, cropOffset.width, cropOffset.height);
  const cHalfW = cropW / 2;
  const cHalfH = cropH / 2;
  const [[ex0, ey0], [ex1, ey1]] = extendCrop;

  const cropCorners: Vec2[] = [
    [-cHalfW + ex0,  cHalfH + ey0],
    [-cHalfW + cropW + ex1,  cHalfH + ey0],
    [-cHalfW + cropW + ex1,  cHalfH - cropH + ey1],
    [-cHalfW + ex0,  cHalfH - cropH + ey1],
  ];

  // Rotate crop corners into the same un-rotated comparison frame
  const rotatedCropPts = cropCorners.map(pt => rotatePoint(pt, -rotation));
  const cropXs = rotatedCropPts.map(p => p[0]);
  const cropYs = rotatedCropPts.map(p => p[1]);

  return {
    cropMinX: Math.min(...cropXs),
    cropMaxX: Math.max(...cropXs),
    cropMinY: Math.min(...cropYs),
    cropMaxY: Math.max(...cropYs),
    imageMinX: Math.min(...imageXs),
    imageMaxX: Math.max(...imageXs),
    imageMinY: Math.min(...imageYs),
    imageMaxY: Math.max(...imageYs),
  };
}
