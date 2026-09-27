import type { Vec2 } from '../types';
import { maskResolution } from '../mask/maskMath';
import type { RgbaImage } from './magicEraser';

/** The source image at the mask's resolution (≤ 2048 on the long side), straight RGBA. */
export type WorkingImage = RgbaImage & {
  /** Working pixels per source pixel (the mask's scale). */
  scale: number;
};

export function readWorkingImage(image: CanvasImageSource, mediaSize: Vec2): WorkingImage {
  const [width, height] = maskResolution(mediaSize[0], mediaSize[1]);
  const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  canvas.width = 0;
  canvas.height = 0;
  return { width, height, data, scale: width / mediaSize[0] };
}

/** A copy of the pixels that can be transferred to a worker. */
export function copyPixels(image: RgbaImage): Uint8ClampedArray<ArrayBuffer> {
  return new Uint8ClampedArray(image.data);
}
