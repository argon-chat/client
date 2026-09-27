import type { ExpressionExportFormat } from '../types';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function toBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

// Chromium encodes WEBP losslessly (VP8L, alpha kept) at quality 1; lower qualities are lossy VP8
// with a separate alpha plane.
const LOSSLESS_WEBP_QUALITY = 1;
const LOSSY_WEBP_QUALITIES = [0.95, 0.9, 0.8, 0.7, 0.6];

async function webp(canvas: AnyCanvas, quality: number): Promise<Blob | null> {
  const blob = await toBlob(canvas, 'image/webp', quality);
  // A browser without a WEBP encoder hands back a PNG instead.
  return blob && blob.type === 'image/webp' ? blob : null;
}

async function png(canvas: AnyCanvas): Promise<Blob> {
  const blob = await toBlob(canvas, 'image/png');
  if (!blob) throw new Error('The canvas could not be encoded');
  return blob;
}

/**
 * Encodes a transparent canvas: lossless WEBP where the browser can, PNG otherwise (or when asked).
 * With `maxBytes`, a file over it is retried as the other lossless format, then as lossy WEBP at
 * falling quality; the smallest attempt is returned when none fits.
 */
export async function encodeTransparentImage(
  canvas: AnyCanvas,
  options: { format?: ExpressionExportFormat; maxBytes?: number } = {}
): Promise<Blob> {
  const format = options.format ?? 'auto';
  const fits = (b: Blob) => options.maxBytes === undefined || b.size <= options.maxBytes;
  const tried: Blob[] = [];

  const first = format === 'png' ? await png(canvas) : (await webp(canvas, LOSSLESS_WEBP_QUALITY)) ?? (await png(canvas));
  if (fits(first)) return first;
  tried.push(first);

  if (format !== 'png') {
    const other = first.type === 'image/webp' ? await png(canvas) : null;
    if (other && fits(other)) return other;
    if (other) tried.push(other);
    for (const quality of LOSSY_WEBP_QUALITIES) {
      const lossy = await webp(canvas, quality);
      if (!lossy) break;
      if (fits(lossy)) return lossy;
      tried.push(lossy);
    }
  }

  return tried.reduce((a, b) => (b.size < a.size ? b : a));
}
