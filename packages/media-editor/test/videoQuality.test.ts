/**
 * A video's quality is its output's short side, the way the host's ladder counts it: 720 is 1280×720
 * for a landscape frame and 720×1280 for a portrait one. The export, the default and the slider's
 * steps all read it that way, so the editor and the attach window agree on the size that goes out.
 */
import { describe, test, expect } from "vitest";
import { computeExportDimensions } from "../src/finalRender/computeExportDimensions";
import { defaultVideoQuality, resolveOutputQuality, snapVideoQuality } from "../src/constants";

function video(width: number, height: number, forcedQuality?: number) {
  const aspect = width / height;
  return computeExportDimensions({
    sourceWidth: width,
    sourceAspectRatio: aspect,
    cropAspectRatio: aspect,
    cropAreaSize: { width: 800, height: 600 },
    zoomScale: 1,
    outputMode: "video",
    forcedQuality,
  });
}

describe("a video's export size", () => {
  test.each([
    ["1080p landscape, untouched", 1920, 1080, undefined, [1920, 1080]],
    ["1080p portrait keeps 1080 across", 1080, 1920, undefined, [1080, 1920]],
    ["4K landscape is held to 1080p", 3840, 2160, undefined, [1920, 1080]],
    ["4K portrait is held to 1080 across", 2160, 3840, undefined, [1080, 1920]],
    ["720 for a landscape frame", 1920, 1080, 720, [1280, 720]],
    ["720 for a portrait frame: 720 across", 1080, 1920, 720, [720, 1280]],
    ["480 for a square", 1080, 1080, 480, [480, 480]],
  ] as const)("%s", (_, w, h, quality, expected) => {
    expect(video(w, h, quality)).toEqual(expected);
  });
});

describe("the default quality", () => {
  test("is the host's top step when it gives steps", () => {
    expect(defaultVideoQuality({ width: 1920, height: 1080 }, [360, 480, 720])).toBe(720);
  });

  test("else the preset the short side snaps to, either way round", () => {
    expect(defaultVideoQuality({ width: 1920, height: 1080 })).toBe(1080);
    expect(defaultVideoQuality({ width: 1080, height: 1920 })).toBe(1080);
    expect(defaultVideoQuality({ width: 720, height: 1280 })).toBe(720);
    expect(resolveOutputQuality(1000)).toBe(720);
  });
});

describe("a quality on the slider", () => {
  const steps = [360, 480, 720, 1080];
  test.each([
    [720, 720],
    [1080, 1080],
    [600, 480],
    [240, 360],
    [2160, 1080],
  ])("%i shows as %i", (quality, shown) => {
    expect(snapVideoQuality(quality, steps)).toBe(shown);
  });
});
