import { readTopLevelBoxes, type BoxSource, type Mp4Box } from "./mp4Boxes";

/** How much playback the prefix should hold after the header. */
export const PRELOAD_SECONDS = 1.5;

/** The end of `moov` plus 1.5 s at `bitrateBps`, never past `total`. */
export function preloadPrefixAfter(moov: Mp4Box, total: number, bitrateBps: number): number {
  const headerEnd = Math.min(total, moov.offset + moov.size);
  const media = Number.isFinite(bitrateBps) && bitrateBps > 0 ? Math.ceil((bitrateBps * PRELOAD_SECONDS) / 8) : 0;
  return Math.min(total, headerEnd + Math.min(total - headerEnd, media));
}

/**
 * How many leading bytes of a fast-start MP4 hold the header and about the first 1.5 s of media, so
 * a player can warm up with one range request: the end of `moov` plus 1.5 s at the file's bitrate.
 * 0 when the file has no `moov` to point at.
 */
export async function computePreloadPrefixSize(mp4: BoxSource, bitrateBps: number): Promise<number> {
  const total = mp4 instanceof Uint8Array ? mp4.length : mp4.size;
  const boxes = await readTopLevelBoxes(mp4, { until: (b) => b.type === "moov" });
  const moov = boxes.find((b) => b.type === "moov");
  return moov ? preloadPrefixAfter(moov, total, bitrateBps) : 0;
}
