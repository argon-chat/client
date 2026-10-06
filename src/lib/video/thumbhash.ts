import { rgbaToThumbHash } from "thumbhash";
import { context2d, createCanvas } from "./image";

/** The longest side a ThumbHash is computed from (the format's own limit is 100). */
export const THUMBHASH_MAX_DIM = 100;

/** Base64 of the hash bytes, the format attachments already carry. */
export function thumbHashToBase64(hash: Uint8Array): string {
  let binary = "";
  for (const byte of hash) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The ThumbHash of an image, scaled into ≤100×100 with its aspect kept, as base64. */
export function thumbHashOf(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(THUMBHASH_MAX_DIM / width, THUMBHASH_MAX_DIM / height, 1);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = createCanvas(w, h);
  const ctx = context2d(canvas);
  ctx.drawImage(source, 0, 0, w, h);
  return thumbHashToBase64(rgbaToThumbHash(w, h, ctx.getImageData(0, 0, w, h).data));
}
