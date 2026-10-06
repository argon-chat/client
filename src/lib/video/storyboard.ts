import { CanvasSink } from "mediabunny";
import type { VideoStoryboard } from "@argon/glue";
import { canvasToWebp, context2d, createCanvas } from "./image";
import { withDecodableTrack, withinFrameTimeout } from "./frames";

/** Shorter videos get no storyboard: scrubbing them shows the frames themselves. */
export const STORYBOARD_MIN_DURATION_MS = 8_000;
export const STORYBOARD_MAX_FRAMES = 120;
export const STORYBOARD_FRAME_WIDTH = 160;
export const STORYBOARD_COLUMNS = 10;
/** A very tall frame is capped here and narrowed instead, keeping the sprite well within WebP's 16383 px. */
export const STORYBOARD_MAX_FRAME_HEIGHT = 480;
export const STORYBOARD_QUALITY = 0.7;
const INTERVAL_STEPS = [1_000, 2_000, 5_000, 10_000, 15_000, 20_000, 30_000, 60_000];

export interface StoryboardGeometry extends VideoStoryboard {
  rows: number;
  spriteWidth: number;
  spriteHeight: number;
}

export interface VideoStoryboardSprite {
  /** image/webp (image/jpeg where the browser cannot write WebP). */
  blob: Blob;
  storyboard: VideoStoryboard;
}

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

/**
 * The sprite layout for a video of `durationMs` whose frames are `aspect` (width / height) wide:
 * at most 120 frames on a 1 / 2 / 5 / 10 / 15 / 20 / 30 / 60 s step (whole minutes beyond), each
 * 160 px wide, ten to a row. null below 8 s.
 */
export function storyboardGeometry(durationMs: number, aspect: number): StoryboardGeometry | null {
  if (!(durationMs >= STORYBOARD_MIN_DURATION_MS) || !(aspect > 0) || !Number.isFinite(aspect)) return null;

  const raw = Math.max(1_000, Math.ceil(durationMs / STORYBOARD_MAX_FRAMES / 1_000) * 1_000);
  const intervalMs = INTERVAL_STEPS.find((step) => step >= raw) ?? Math.ceil(raw / 60_000) * 60_000;
  const frameCount = Math.min(STORYBOARD_MAX_FRAMES, Math.max(1, Math.ceil(durationMs / intervalMs)));

  let frameWidth = STORYBOARD_FRAME_WIDTH;
  let frameHeight = even(frameWidth / aspect);
  if (frameHeight > STORYBOARD_MAX_FRAME_HEIGHT) {
    frameHeight = STORYBOARD_MAX_FRAME_HEIGHT;
    frameWidth = even(frameHeight * aspect);
  }

  const columns = Math.min(STORYBOARD_COLUMNS, frameCount);
  const rows = Math.ceil(frameCount / columns);
  return {
    frameWidth,
    frameHeight,
    columns,
    frameCount,
    intervalMs,
    rows,
    spriteWidth: columns * frameWidth,
    spriteHeight: rows * frameHeight,
  };
}


/**
 * One WebP sprite of frames taken every `intervalMs` (frame i is the picture at i × intervalMs),
 * row-major, as the player's scrub preview. null for a video shorter than 8 s (without opening it).
 * Decodes, like {@link extractPoster}: rejects with VideoPrepareError `undecodable` on a browser that
 * cannot decode `src`'s codec, and with `aborted` when `signal` fires (checked between frames).
 */
export async function buildStoryboard(
  src: Blob,
  durationMs: number,
  { signal }: { signal?: AbortSignal } = {},
): Promise<VideoStoryboardSprite | null> {
  if (!(durationMs >= STORYBOARD_MIN_DURATION_MS)) return null;

  return withDecodableTrack(src, signal, async (track, checkAbort) => {
    const geometry = storyboardGeometry(durationMs, (await track.getDisplayWidth()) / (await track.getDisplayHeight()));
    if (!geometry) return null;

    const { frameWidth, frameHeight, columns, frameCount, intervalMs } = geometry;
    const sink = new CanvasSink(track, { width: frameWidth, height: frameHeight, fit: "contain", poolSize: 2 });
    const sprite = createCanvas(geometry.spriteWidth, geometry.spriteHeight);
    const ctx = context2d(sprite);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, sprite.width, sprite.height);

    const firstSec = await track.getFirstTimestamp();
    const timestamps = Array.from({ length: frameCount }, (_, i) => Math.max(firstSec, (i * intervalMs) / 1000));
    const frames = sink.canvasesAtTimestamps(timestamps);
    let previous: { x: number; y: number } | null = null;
    try {
      for (let i = 0; i < frameCount; i++) {
        checkAbort();
        const next = await withinFrameTimeout(frames.next());
        if (next.done) break;
        const x = (i % columns) * frameWidth;
        const y = Math.floor(i / columns) * frameHeight;
        if (next.value) {
          ctx.drawImage(next.value.canvas, x, y, frameWidth, frameHeight);
          previous = { x, y };
        } else if (previous) {
          ctx.drawImage(sprite, previous.x, previous.y, frameWidth, frameHeight, x, y, frameWidth, frameHeight);
        }
      }
    } finally {
      void frames.return(undefined).catch(() => {});
    }
    checkAbort();

    const blob = await canvasToWebp(sprite, STORYBOARD_QUALITY);
    return { blob, storyboard: { frameWidth, frameHeight, columns, frameCount, intervalMs } };
  });
}
