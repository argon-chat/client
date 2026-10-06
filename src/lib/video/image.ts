/** Canvas helpers that work both on the page and in a worker. */

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function context2d(canvas: AnyCanvas): Context2D {
  const ctx = canvas.getContext("2d") as Context2D | null;
  if (!ctx) throw new Error("No 2D canvas context");
  return ctx;
}

async function encode(canvas: AnyCanvas, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * The canvas as WebP, or as JPEG where the browser cannot write WebP (Safari hands back a PNG
 * instead, which would be several times larger).
 */
export async function canvasToWebp(canvas: AnyCanvas, quality: number): Promise<Blob> {
  const webp = await encode(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return webp;
  const jpeg = await encode(canvas, "image/jpeg", quality);
  if (jpeg) return jpeg;
  throw new Error("The canvas could not be encoded");
}
