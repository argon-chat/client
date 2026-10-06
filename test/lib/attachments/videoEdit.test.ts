/**
 * A media-editor result for a video, as what the composer does with it: geometry, trim, sound and
 * quality become preparation preferences of the source (no frame rendered); anything that changes
 * the pixels, or a turn that is not a quarter turn, needs the editor's own render.
 */
import { describe, test, expect } from "vitest";
import type { EditingMediaState, SourceVideoTransform, VideoEditSummary } from "@argon/media-editor";
import { rungForEditorQuality, videoEditDecision } from "@/lib/attachments/videoEdit";

function state(patch: Partial<EditingMediaState> = {}): EditingMediaState {
  return {
    scale: 1,
    rotation: 0,
    translation: [0, 0],
    flip: [1, 1],
    perspective: [0, 0],
    currentImageRatio: 16 / 9,
    currentVideoTime: 0,
    videoCropStart: 0,
    videoCropLength: 1,
    videoThumbnailPosition: 0,
    videoMuted: false,
    videoQuality: 1080,
    adjustments: { enhance: 0, brightness: 0 } as EditingMediaState["adjustments"],
    curves: { r: [0, 0], g: [0, 0], b: [0, 0] },
    selective: { hue: 0, range: 0, shift: 0, sat: 0, luma: 0 },
    resizableLayers: [],
    brushDrawnLines: [],
    outline: { enabled: false, radius: 8, color: "#fff" },
    mask: { source: null, feather: 0, strokes: [] },
    history: [],
    redoHistory: [],
    ...patch,
  };
}

const WHOLE: SourceVideoTransform = { rotate: 0, flip: false, crop: null, width: 1920, height: 1080 };

function summary(patch: Partial<VideoEditSummary> = {}): VideoEditSummary {
  return { transform: WHOLE, pixelEdits: false, quality: null, duration: 10, ...patch };
}

describe("videoEditDecision", () => {
  test.each([
    ["nothing changed", state(), summary(), { trim: null, crop: null, rotate: 0, flip: false, mute: false, quality: null, coverMs: null }],
    [
      "a trim of 10 %–60 % of 10 s, the cover carried to its start",
      state({ videoCropStart: 0.1, videoCropLength: 0.5, videoThumbnailPosition: 0.1 }),
      summary(),
      { trim: { startMs: 1_000, endMs: 6_000 }, coverMs: 1_000 },
    ],
    [
      "a cover picked inside the trim",
      state({ videoCropStart: 0.2, videoCropLength: 0.5, videoThumbnailPosition: 0.45 }),
      summary(),
      { trim: { startMs: 2_000, endMs: 7_000 }, coverMs: 4_500 },
    ],
    ["a cover alone", state({ videoThumbnailPosition: 0.3 }), summary(), { trim: null, coverMs: 3_000 }],
    ["muted", state({ videoMuted: true }), summary(), { mute: true }],
    [
      "a quarter turn, a mirror and a crop, as the editor measured them",
      state(),
      summary({ transform: { rotate: 270, flip: true, crop: { left: 0, top: 420, width: 1080, height: 1080 }, width: 1080, height: 1080 } }),
      { rotate: 270, flip: true, crop: { left: 0, top: 420, width: 1080, height: 1080 } },
    ],
    ["480p picked for a 16:9 frame", state(), summary({ quality: 480 }), { quality: 480 }],
    [
      "720p picked for a 9:16 frame: 405 px across lands on 360",
      state(),
      summary({ quality: 720, transform: { ...WHOLE, rotate: 90, width: 1080, height: 1920 } }),
      { quality: 360 },
    ],
    ["the duration from the source when the editor had none", state({ videoCropStart: 0.5, videoCropLength: 0.5 }), summary({ duration: 0 }), { trim: { startMs: 15_000, endMs: 30_000 } }],
  ] as const)("%s → convert", (_, s, sum, expected) => {
    const decision = videoEditDecision(s, sum, 30_000);
    expect(decision.path).toBe("convert");
    if (decision.path === "convert") expect(decision.prefs).toMatchObject(expected);
  });

  test.each([
    ["a brush stroke", summary({ pixelEdits: true }), "pixels"],
    ["a text or sticker layer", summary({ pixelEdits: true }), "pixels"],
    ["an adjustment or a preset", summary({ pixelEdits: true }), "pixels"],
    ["a free rotation (or a perspective tilt)", summary({ transform: null }), "angle"],
    ["painted and turned freely", summary({ pixelEdits: true, transform: null }), "pixels"],
  ] as const)("%s → render (%s)", (_, sum, reason) => {
    expect(videoEditDecision(state(), sum, 30_000)).toEqual({ path: "render", reason });
  });
});

describe("rungForEditorQuality", () => {
  test.each([
    [1080, 16 / 9, 1080],
    [720, 16 / 9, 720],
    [600, 16 / 9, 480],
    [240, 16 / 9, 360],
    [1080, 9 / 16, 480],
    [1080, 1, 1080],
  ])("%ip at aspect %f → %s", (height, aspect, rung) => {
    expect(rungForEditorQuality(height, aspect)).toBe(rung);
  });
});
