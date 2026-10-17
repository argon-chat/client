/**
 * What is actually on screen, read back pixel by pixel.
 *
 * For the questions the DOM cannot answer about itself: whether a shadow or a clipped background was
 * painted at a point. A screenshot of the viewport, decoded into a canvas, sampled in CSS pixels.
 */
import { page } from "vitest/browser";

export interface ScreenPixels {
  /** Red, green, blue and alpha at a viewport point, in CSS pixels. */
  at(x: number, y: number): [number, number, number, number];
}

export async function screenPixels(): Promise<ScreenPixels> {
  const base64 = await page.screenshot({ save: false });
  const image = new Image();

  image.src = `data:image/png;base64,${base64}`;
  await image.decode();

  const canvas = document.createElement("canvas");

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext("2d", { willReadFrequently: true })!;

  context.drawImage(image, 0, 0);

  const scale = image.naturalWidth / window.innerWidth;

  return {
    at(x, y) {
      const [red, green, blue, alpha] = context.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data;

      return [red, green, blue, alpha];
    },
  };
}
