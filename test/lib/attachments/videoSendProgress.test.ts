/** One loader per video: compress and upload as one value, weighted by the plan's mode, never going back. */
import { describe, test, expect } from "vitest";
import { VideoSendProgress, videoSendShares } from "@/lib/attachments/videoSendProgress";

describe("videoSendShares", () => {
  test.each([
    ["transcode", false, { compress: 0.6, upload: 0.4 }],
    ["remux", false, { compress: 0.25, upload: 0.75 }],
    ["copy", false, { compress: 0, upload: 1 }],
    ["copy", true, { compress: 0.6, upload: 0.4 }],
    ["remux", true, { compress: 0.6, upload: 0.4 }],
  ] as const)("%s (rendered: %s) → %o", (mode, rendered, shares) => {
    expect(videoSendShares(mode, rendered)).toEqual(shares);
  });
});

describe("VideoSendProgress", () => {
  test("a transcode: compressing fills 0.6 (preparation then storyboard), uploading the rest", () => {
    const p = new VideoSendProgress("transcode", false);
    expect(p.step("prepare", 0.5)).toBeCloseTo(0.6 * 0.85 * 0.5);
    expect(p.step("prepare", 1)).toBeCloseTo(0.51);
    expect(p.step("storyboard", 1)).toBeCloseTo(0.6);
    expect(p.step("poster-upload", 1)).toBeCloseTo(0.62);
    expect(p.step("storyboard-upload", 1)).toBeCloseTo(0.64);
    expect(p.step("upload", 0.5)).toBeCloseTo(0.82);
    expect(p.step("upload", 1)).toBeCloseTo(1);
  });

  test("a remux spends most of the ring on the upload", () => {
    const p = new VideoSendProgress("remux", false);
    p.step("prepare", 1);
    expect(p.step("storyboard", 1)).toBeCloseTo(0.25);
    expect(p.step("upload", 1)).toBeCloseTo(0.25 + 0.75 * 0.9);
    expect(p.finish()).toBe(1);
  });

  test("a copy is all upload: compressing leaves the ring at 0", () => {
    const p = new VideoSendProgress("copy", false);
    expect(p.step("prepare", 1)).toBe(0);
    expect(p.step("storyboard", 1)).toBe(0);
    expect(p.step("upload", 0.5)).toBeCloseTo(0.45);
  });

  test("an editor render takes most of the compress share", () => {
    const p = new VideoSendProgress("transcode", true);
    expect(p.step("render", 0.5)).toBeCloseTo(0.6 * 0.75 * 0.5);
    expect(p.step("render", 1)).toBeCloseTo(0.45);
    p.step("prepare", 1);
    expect(p.step("storyboard", 1)).toBeCloseTo(0.6);
  });

  test("never goes back, whatever order or repeats the steps report in", () => {
    const p = new VideoSendProgress("transcode", false);
    const values = [p.step("prepare", 0.8), p.step("prepare", 0.3), p.step("prepare", 0.9), p.step("upload", 0.1), p.step("prepare", 0.2), p.step("upload", Number.NaN)];
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    expect(p.value).toBe(values.at(-1));
  });
});
