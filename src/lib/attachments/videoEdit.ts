import type { EditingMediaState, VideoEditSummary } from "@argon/media-editor";
import { VIDEO_LADDER, type VideoCrop, type VideoQuality, type VideoRotation, type VideoRung, type VideoTrim } from "@/lib/video/plan";

/** A media-editor result for a video, as preparation preferences of the source file. */
export interface VideoEditPrefs {
  trim: VideoTrim | null;
  /** In the turned, mirrored frame, display pixels of the source. */
  crop: VideoCrop | null;
  rotate: VideoRotation;
  flip: boolean;
  mute: boolean;
  /** Set only when a quality was picked in the editor. */
  quality: VideoQuality | null;
  /** The cover frame, ms of the source; null when it was left where it starts. */
  coverMs: number | null;
}

/**
 * `convert`: only trim, crop, quarter turns, mirroring, quality and sound changed — the converter
 * applies them to the source (no frame is rendered). `render`: the pixels changed (drawing, text,
 * stickers, adjustments, presets, curves) or the view is turned by a free angle, and only the
 * editor's own export reproduces that; sound and quality still become preferences.
 */
export type VideoEditDecision =
  | { path: "convert"; prefs: VideoEditPrefs }
  | { path: "render"; reason: "pixels" | "angle"; mute: boolean; quality: VideoQuality | null };

/** The rungs a frame reaches on its short side, never above it (nothing is upscaled); the lowest always. */
export function qualityRungs(width: number, height: number): VideoRung[] {
  const short = Math.min(width, height);
  return VIDEO_LADDER.filter((rung, i) => rung <= short || i === 0);
}

/** The ladder rung an editor quality (an output short side) lands on. */
export function rungForEditorQuality(shortSide: number): VideoRung {
  const fitting = VIDEO_LADDER.filter((rung) => rung <= shortSide + 1);
  return fitting.length ? fitting[fitting.length - 1] : VIDEO_LADDER[0];
}

/** The editor's quality for a send quality: the rung itself, or the top rung for Auto and Original. */
export function editorQualityFor(quality: VideoQuality, rungs: readonly number[]): number {
  const top = rungs[rungs.length - 1];
  return typeof quality === "number" ? Math.min(quality, top) : top;
}

type SyncedPrefs = { mute: boolean; quality: VideoQuality };
type Frame = { width: number; height: number };

/** What the editor opens with: the last edit's state, with the sound and quality the composer has now. */
export function editorStateFor(prefs: SyncedPrefs, source: Frame, saved?: EditingMediaState | null): Partial<EditingMediaState> {
  return {
    ...(saved ?? {}),
    videoMuted: prefs.mute,
    videoQuality: editorQualityFor(prefs.quality, qualityRungs(source.width, source.height)),
  };
}

/** A saved editor state after the sound or quality changed in the attach window. */
export function syncEditorState(state: EditingMediaState, prefs: SyncedPrefs, source: Frame): EditingMediaState {
  return { ...state, ...editorStateFor(prefs, source) } as EditingMediaState;
}

export function videoEditDecision(state: EditingMediaState, summary: VideoEditSummary, sourceDurationMs: number): VideoEditDecision {
  const mute = !!state.videoMuted;
  const quality = summary.quality ? rungForEditorQuality(summary.quality) : null;
  if (summary.pixelEdits) return { path: "render", reason: "pixels", mute, quality };
  const transform = summary.transform;
  if (!transform) return { path: "render", reason: "angle", mute, quality };

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
      mute,
      quality,
      coverMs,
    },
  };
}
