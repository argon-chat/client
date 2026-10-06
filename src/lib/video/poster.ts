import { CanvasSink } from "mediabunny";
import { canvasToWebp } from "./image";
import { thumbHashOf } from "./thumbhash";
import { withDecodableTrack, withinFrameTimeout } from "./frames";

export interface VideoPoster {
  /** image/webp (image/jpeg where the browser cannot write WebP). */
  blob: Blob;
  width: number;
  height: number;
  thumbHash: string;
}

export const POSTER_QUALITY = 0.85;

/** Even size within `maxSide` on the long side, aspect kept, never upscaled. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const even = (x: number) => Math.max(2, Math.round((x * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * The frame shown at `atMs` (or the first one, if `atMs` is before it), at most `maxSide` on its
 * long side, with its ThumbHash. Decodes: on a browser that cannot decode `src`'s codec it rejects
 * at once with VideoPrepareError `undecodable` (also when no frame comes within 15 s), and with
 * `aborted` when `signal` fires.
 */
export async function extractPoster(
  src: Blob,
  atMs: number,
  { maxSide = 720, signal }: { maxSide?: number; signal?: AbortSignal } = {},
): Promise<VideoPoster> {
  return withDecodableTrack(src, signal, async (track, checkAbort) => {
    const size = fitWithin(await track.getDisplayWidth(), await track.getDisplayHeight(), maxSide);
    const sink = new CanvasSink(track, { ...size, fit: "contain" });

    const at = Math.max(0, atMs) / 1000;
    let frame = await withinFrameTimeout(sink.getCanvas(at));
    checkAbort();
    frame ??= await withinFrameTimeout(sink.getCanvas(await track.getFirstTimestamp()));
    checkAbort();
    if (!frame) throw new Error("The video has no frame to make a poster of");

    const { canvas } = frame;
    const blob = await canvasToWebp(canvas, POSTER_QUALITY);
    return { blob, width: canvas.width, height: canvas.height, thumbHash: thumbHashOf(canvas, canvas.width, canvas.height) };
  });
}
