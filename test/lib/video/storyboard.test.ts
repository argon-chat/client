/**
 * The storyboard sprite's layout: at most 120 frames on a round interval, 160 px wide, ten to a row,
 * nothing for a video under 8 s.
 */

import { describe, test, expect } from "vitest";
import { storyboardGeometry, STORYBOARD_MAX_FRAMES } from "@/lib/video/storyboard";

const WIDE = 16 / 9;

describe("storyboardGeometry", () => {
  test("nothing under 8 s", () => {
    expect(storyboardGeometry(7_999, WIDE)).toBeNull();
    expect(storyboardGeometry(0, WIDE)).toBeNull();
    expect(storyboardGeometry(Number.NaN, WIDE)).toBeNull();
  });

  test("nothing for a frame without a shape", () => {
    expect(storyboardGeometry(60_000, 0)).toBeNull();
    expect(storyboardGeometry(60_000, Number.POSITIVE_INFINITY)).toBeNull();
  });

  test.each([
    // duration, interval, frames, columns, rows
    [8_000, 1_000, 8, 8, 1],
    [8_500, 1_000, 9, 9, 1],
    [120_000, 1_000, 120, 10, 12],
    [121_000, 2_000, 61, 10, 7],
    [240_000, 2_000, 120, 10, 12],
    [600_000, 5_000, 120, 10, 12],
    [601_000, 10_000, 61, 10, 7],
    [3_600_000, 30_000, 120, 10, 12],
    [3_601_000, 60_000, 61, 10, 7],
    [10_800_000, 120_000, 90, 10, 9],
  ])("%i ms → every %i ms, %i frames in %i columns × %i rows", (duration, intervalMs, frameCount, columns, rows) => {
    expect(storyboardGeometry(duration, WIDE)).toMatchObject({ intervalMs, frameCount, columns, rows });
  });

  test("frames are 160 px wide, height by aspect, even", () => {
    expect(storyboardGeometry(60_000, WIDE)).toMatchObject({ frameWidth: 160, frameHeight: 90, spriteWidth: 1600, spriteHeight: 540 });
    expect(storyboardGeometry(60_000, 9 / 16)).toMatchObject({ frameWidth: 160, frameHeight: 284 });
    expect(storyboardGeometry(60_000, 4 / 3)).toMatchObject({ frameWidth: 160, frameHeight: 120 });
    expect(storyboardGeometry(60_000, 100)).toMatchObject({ frameWidth: 160, frameHeight: 2 });
  });

  test("a very tall frame is capped at 480 px and narrowed", () => {
    expect(storyboardGeometry(60_000, 0.1)).toMatchObject({ frameWidth: 48, frameHeight: 480 });
  });

  test("never more than 120 frames, never fewer than one, always covering the whole video", () => {
    for (let duration = 8_000; duration < 20_000_000; duration = Math.ceil(duration * 1.37)) {
      const g = storyboardGeometry(duration, WIDE)!;
      expect(g.frameCount).toBeGreaterThanOrEqual(1);
      expect(g.frameCount).toBeLessThanOrEqual(STORYBOARD_MAX_FRAMES);
      expect(g.frameCount * g.intervalMs).toBeGreaterThanOrEqual(duration);
      expect((g.frameCount - 1) * g.intervalMs).toBeLessThan(duration);
      expect(g.rows * g.columns).toBeGreaterThanOrEqual(g.frameCount);
      expect((g.rows - 1) * g.columns).toBeLessThan(g.frameCount);
    }
  });
});
