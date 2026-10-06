/**
 * A media-editor result for a video, as what the composer does with it: geometry, trim, sound and
 * quality become preparation preferences of the source (no frame rendered); anything that changes
 * the pixels, or a turn that is not a quarter turn, needs the editor's own render.
 */
import { describe, test, expect } from "vitest";
import type { EditingMediaState, SourceVideoTransform, VideoEditSummary } from "@argon/media-editor";
import { editorStateFor, qualityRungs, rungForEditorQuality, syncEditorState, videoEditDecision } from "@/lib/attachments/videoEdit";

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
      "720p picked for a 9:16 frame: a quality is the short side, 720 across",
      state(),
      summary({ quality: 720, transform: { ...WHOLE, rotate: 90, width: 1080, height: 1920 } }),
      { quality: 720 },
    ],
    ["1080p picked, a raise rather than a drop, is kept too", state(), summary({ quality: 1080 }), { quality: 1080 }],
    ["the slider left where it opened keeps the composer's quality", state({ videoQuality: 720 }), summary({ quality: null }), { quality: null }],
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
    expect(videoEditDecision(state(), sum, 30_000)).toEqual({ path: "render", reason, mute: false, quality: null });
  });

  test("a render still carries the editor's sound and picked quality into the composer", () => {
    expect(videoEditDecision(state({ videoMuted: true }), summary({ pixelEdits: true, quality: 480 }), 30_000)).toEqual({
      path: "render",
      reason: "pixels",
      mute: true,
      quality: 480,
    });
  });
});

describe("rungForEditorQuality", () => {
  test.each([
    [1080, 1080],
    [720, 720],
    [600, 480],
    [240, 360],
    [1081, 1080],
  ])("a short side of %i → %s", (shortSide, rung) => {
    expect(rungForEditorQuality(shortSide)).toBe(rung);
  });
});

describe("the composer's sound and quality, in the editor and back", () => {
  const LANDSCAPE = { width: 1920, height: 1080 };

  test("the rungs a frame reaches: never above its short side, the lowest always", () => {
    expect(qualityRungs(1920, 1080)).toEqual([360, 480, 720, 1080]);
    expect(qualityRungs(1080, 1920)).toEqual([360, 480, 720, 1080]);
    expect(qualityRungs(1280, 720)).toEqual([360, 480, 720]);
    expect(qualityRungs(854, 480)).toEqual([360, 480]);
    expect(qualityRungs(320, 180)).toEqual([360]);
  });

  test.each([
    ["auto opens at the top rung the source reaches", { mute: false, quality: "auto" }, LANDSCAPE, { videoMuted: false, videoQuality: 1080 }],
    ["a rung opens at itself", { mute: true, quality: 480 }, LANDSCAPE, { videoMuted: true, videoQuality: 480 }],
    ["original opens at the top rung", { mute: false, quality: "original" }, { width: 1280, height: 720 }, { videoMuted: false, videoQuality: 720 }],
    ["a rung above the source opens at the source's top", { mute: false, quality: 1080 }, { width: 1280, height: 720 }, { videoQuality: 720 }],
  ] as const)("%s", (_, prefs, source, expected) => {
    expect(editorStateFor(prefs, source)).toMatchObject(expected);
  });

  test("a reopened edit keeps its trim and crop and takes the composer's sound and quality", () => {
    const saved = state({ videoCropStart: 0.2, videoCropLength: 0.5, scale: 1.4, videoMuted: false, videoQuality: 1080 });
    const opened = editorStateFor({ mute: true, quality: 720 }, LANDSCAPE, saved);
    expect(opened).toMatchObject({ videoCropStart: 0.2, videoCropLength: 0.5, scale: 1.4, videoMuted: true, videoQuality: 720 });
    expect(saved.videoMuted).toBe(false);
  });

  test("a change in the attach window is written into the saved state, and comes back unchanged", () => {
    const saved = state({ videoCropStart: 0.1, videoMuted: false, videoQuality: 1080 });
    const synced = syncEditorState(saved, { mute: true, quality: 480 }, LANDSCAPE);
    expect(synced).toMatchObject({ videoCropStart: 0.1, videoMuted: true, videoQuality: 480 });

    // Opened with that state and left alone, the editor hands back the same sound and no new quality.
    const back = videoEditDecision(synced, summary({ quality: null }), 30_000);
    expect(back.path === "convert" && back.prefs).toMatchObject({ mute: true, quality: null });
  });
});
