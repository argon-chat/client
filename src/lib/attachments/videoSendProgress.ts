import type { VideoPrepareMode } from "@/lib/video/plan";

/**
 * One loader per video in the optimistic bubble: compressing and uploading as a single 0..1 that
 * only goes forward. The shares follow how long each part usually takes for the plan's mode.
 *
 *   transcode         compress 0.60 · upload 0.40
 *   remux             compress 0.25 · upload 0.75
 *   copy              compress 0    · upload 1
 *   editor-rendered   compress 0.60 · upload 0.40
 *
 * Compressing is the editor's render (when there is one), the preparation, and the storyboard
 * taken from the result; uploading is the poster, the storyboard and the video itself.
 */

export type VideoSendStep = "render" | "prepare" | "storyboard" | "poster-upload" | "storyboard-upload" | "upload";

export interface VideoSendShares {
  compress: number;
  upload: number;
}

export function videoSendShares(mode: VideoPrepareMode, rendered: boolean): VideoSendShares {
  if (rendered || mode === "transcode") return { compress: 0.6, upload: 0.4 };
  if (mode === "remux") return { compress: 0.25, upload: 0.75 };
  return { compress: 0, upload: 1 };
}

/** How the compress share splits between its steps. */
const COMPRESS_STEPS: Partial<Record<VideoSendStep, number>> = { prepare: 0.85, storyboard: 0.15 };
const COMPRESS_STEPS_RENDERED: Partial<Record<VideoSendStep, number>> = { render: 0.75, prepare: 0.15, storyboard: 0.1 };
/** How the upload share splits: the two pictures are small, the video is the transfer. */
const UPLOAD_STEPS: Partial<Record<VideoSendStep, number>> = { "poster-upload": 0.05, "storyboard-upload": 0.05, upload: 0.9 };

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** The combined progress of one video's send. */
export class VideoSendProgress {
  private readonly reached = new Map<VideoSendStep, number>();
  private current = 0;

  constructor(
    readonly mode: VideoPrepareMode,
    readonly rendered: boolean,
  ) {}

  get value(): number {
    return this.current;
  }

  /** `step` got to `fraction` (0..1); returns the combined value, which never goes back. */
  step(step: VideoSendStep, fraction: number): number {
    this.reached.set(step, Math.max(this.reached.get(step) ?? 0, clamp01(fraction)));
    const shares = videoSendShares(this.mode, this.rendered);
    const sum = (weights: Partial<Record<VideoSendStep, number>>) =>
      Object.entries(weights).reduce((acc, [key, w]) => acc + (w ?? 0) * (this.reached.get(key as VideoSendStep) ?? 0), 0);
    const compressSteps = this.rendered ? COMPRESS_STEPS_RENDERED : COMPRESS_STEPS;
    this.current = Math.max(this.current, clamp01(shares.compress * sum(compressSteps) + shares.upload * sum(UPLOAD_STEPS)));
    return this.current;
  }

  /** Everything is done (steps that did not happen, a missing poster, count as done). */
  finish(): number {
    this.current = 1;
    return 1;
  }
}
