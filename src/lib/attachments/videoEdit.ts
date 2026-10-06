import type { EditingMediaState, VideoEditSummary } from "@argon/media-editor";
import { VIDEO_LADDER, type VideoCrop, type VideoQuality, type VideoRotation, type VideoTrim } from "@/lib/video/plan";

/** A media-editor result for a video, as preparation preferences of the source file. */
export interface VideoEditPrefs {
  trim: VideoTrim | null;
  /** In the turned, mirrored frame, display pixels of the source. */
  crop: VideoCrop | null;
  rotate: VideoRotation;
  flip: boolean;
  mute: boolean;
  /** Set only when a lower quality was picked in the editor. */
  quality: VideoQuality | null;
  /** The cover frame, ms of the source; null when it was left where it starts. */
  coverMs: number | null;
}

/**
 * `convert`: only trim, crop, quarter turns, mirroring, quality and sound changed — the converter
 * applies them to the source (no frame is rendered). `render`: the pixels changed (drawing, text,
 * stickers, adjustments, presets, curves) or the view is turned by a free angle, and only the
 * editor's own export reproduces that.
 */
export type VideoEditDecision =
  | { path: "convert"; prefs: VideoEditPrefs }
  | { path: "render"; reason: "pixels" | "angle" };

/** The ladder rung an editor quality (an output height) lands on for a frame of this aspect. */
export function rungForEditorQuality(height: number, aspect: number): VideoQuality {
  const shortSide = aspect >= 1 ? height : height * aspect;
  const fitting = VIDEO_LADDER.filter((rung) => rung <= shortSide + 1);
  return fitting.length ? fitting[fitting.length - 1] : VIDEO_LADDER[0];
}

export function videoEditDecision(state: EditingMediaState, summary: VideoEditSummary, sourceDurationMs: number): VideoEditDecision {
  if (summary.pixelEdits) return { path: "render", reason: "pixels" };
  const transform = summary.transform;
  if (!transform) return { path: "render", reason: "angle" };

  const durationMs = summary.duration > 0 ? summary.duration * 1000 : sourceDurationMs;
  const startMs = Math.round(Math.max(0, state.videoCropStart) * durationMs);
  const endMs = Math.round(Math.min(1, state.videoCropStart + state.videoCropLength) * durationMs);
  const trim = startMs <= 1 && endMs >= durationMs - 1 ? null : { startMs, endMs };

  const pristineCover = state.videoThumbnailPosition <= 0 && state.videoCropStart <= 0;
  const coverMs = pristineCover
    ? null
    : Math.min(endMs, Math.max(startMs, Math.round(state.videoThumbnailPosition * durationMs)));

  return {
    path: "convert",
    prefs: {
      trim,
      crop: transform.crop ? { ...transform.crop } : null,
      rotate: transform.rotate,
      flip: transform.flip,
      mute: !!state.videoMuted,
      quality: summary.quality ? rungForEditorQuality(summary.quality, transform.width / transform.height) : null,
      coverMs,
    },
  };
}
