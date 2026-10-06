/**
 * The player's arithmetic: time labels, the buffered range under the playhead, storyboard cells,
 * speeds (the menu's steps and the press-and-hold drag) and the frame length.
 */

import { describe, test, expect } from "vitest";
import {
  bufferedEnd,
  clampPlaybackRate,
  estimateFrameDuration,
  formatDuration,
  formatRate,
  formatTime,
  fraction,
  holdStartRate,
  isTextEntryTarget,
  pointerFraction,
  pressesOnSpace,
  scrubTime,
  speedFromDrag,
  stepPlaybackRate,
  stepVolume,
  storyboardFrameAt,
  tooltipCentre,
  DEFAULT_FRAME_SECONDS,
  type TimeRangesLike,
} from "@/lib/video/playerMath";

const ranges = (...pairs: [number, number][]): TimeRangesLike => ({
  length: pairs.length,
  start: (i) => pairs[i][0],
  end: (i) => pairs[i][1],
});

describe("time labels", () => {
  test("minutes and seconds, hours when there are any", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(42.9)).toBe("0:42");
    expect(formatTime(725)).toBe("12:05");
    expect(formatTime(3723)).toBe("1:02:03");
    expect(formatTime(5, true)).toBe("0:00:05");
    expect(formatTime(-3)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
  });

  test("a clip's length rounds", () => {
    expect(formatDuration(41_600)).toBe("0:42");
    expect(formatDuration(400)).toBe("0:00");
    expect(formatDuration(61_499)).toBe("1:01");
  });
});

describe("buffered", () => {
  test("the end of the range holding the playhead", () => {
    expect(bufferedEnd(ranges([0, 4], [10, 20]), 2)).toBe(4);
    expect(bufferedEnd(ranges([0, 4], [10, 20]), 12)).toBe(20);
  });

  test("a playhead in a gap has nothing buffered ahead", () => {
    expect(bufferedEnd(ranges([0, 4], [10, 20]), 7)).toBe(0);
    expect(bufferedEnd(null, 3)).toBe(0);
  });

  test("touching ranges: the later one", () => {
    expect(bufferedEnd(ranges([0, 5], [5, 9]), 5)).toBe(9);
  });

  test("fractions stay within the bar", () => {
    expect(fraction(5, 10)).toBe(0.5);
    expect(fraction(15, 10)).toBe(1);
    expect(fraction(5, 0)).toBe(0);
    expect(pointerFraction(150, 100, 200)).toBe(0.25);
    expect(pointerFraction(50, 100, 200)).toBe(0);
    expect(pointerFraction(400, 100, 200)).toBe(1);
  });

  test("a scrub to the right edge stops short of the end", () => {
    expect(scrubTime(1, 30)).toBeCloseTo(29.9);
    expect(scrubTime(0.5, 30)).toBe(15);
    expect(scrubTime(0.5, 0)).toBe(0);
  });

  test("the tooltip is pushed in at the edges", () => {
    expect(tooltipCentre(5, 400, 100)).toBe(50);
    expect(tooltipCentre(200, 400, 100)).toBe(200);
    expect(tooltipCentre(398, 400, 100)).toBe(350);
    expect(tooltipCentre(10, 80, 100)).toBe(40);
  });
});

describe("storyboard", () => {
  const map = { frameWidth: 160, frameHeight: 90, columns: 4, frameCount: 10, intervalMs: 2000 };

  test("frame i covers [i·interval, (i+1)·interval), row-major", () => {
    expect(storyboardFrameAt(map, 0)).toEqual({ index: 0, x: 0, y: 0, width: 160, height: 90 });
    expect(storyboardFrameAt(map, 1999)).toMatchObject({ index: 0 });
    expect(storyboardFrameAt(map, 2000)).toMatchObject({ index: 1, x: 160, y: 0 });
    expect(storyboardFrameAt(map, 9000)).toMatchObject({ index: 4, x: 0, y: 90 });
    expect(storyboardFrameAt(map, 15_000)).toMatchObject({ index: 7, x: 480, y: 90 });
  });

  test("past the end it is the last frame, before the start the first", () => {
    expect(storyboardFrameAt(map, 60_000)).toMatchObject({ index: 9, x: 160, y: 180 });
    expect(storyboardFrameAt(map, -5)).toMatchObject({ index: 0 });
  });

  test("a map that cannot be cut has no frames", () => {
    expect(storyboardFrameAt({ ...map, columns: 0 }, 0)).toBeNull();
    expect(storyboardFrameAt({ ...map, frameCount: 0 }, 0)).toBeNull();
    expect(storyboardFrameAt(null, 0)).toBeNull();
  });
});

describe("speed", () => {
  test("Alt+= and Alt+- step through the menu's speeds", () => {
    expect(stepPlaybackRate(1, 1)).toBe(1.25);
    expect(stepPlaybackRate(1, -1)).toBe(0.75);
    expect(stepPlaybackRate(2.5, 1)).toBe(2.5);
    expect(stepPlaybackRate(0.5, -1)).toBe(0.5);
    expect(stepPlaybackRate(1.4, 1)).toBe(1.5);
    expect(stepPlaybackRate(1.4, -1)).toBe(1.25);
  });

  test("a custom speed is held to the slider's range", () => {
    expect(clampPlaybackRate(0.1)).toBe(0.25);
    expect(clampPlaybackRate(7)).toBe(4);
    expect(clampPlaybackRate(1.333)).toBe(1.33);
    expect(clampPlaybackRate(NaN)).toBe(1);
    expect(formatRate(1.5)).toBe("1.5");
    expect(formatRate(2)).toBe("2");
  });

  test("a hold from normal speed plays at 2×, from another speed at that speed", () => {
    expect(holdStartRate(1)).toBe(2);
    expect(holdStartRate(1.5)).toBe(1.5);
  });

  test("dragging moves a hundredth per pixel, a fifth of that below 1×", () => {
    expect(speedFromDrag(2, 50)).toBeCloseTo(2.5);
    expect(speedFromDrag(2, -50)).toBeCloseTo(1.5);
    // 2× → 1× takes 100 px; the next 100 px only buy 0.2.
    expect(speedFromDrag(2, -200)).toBeCloseTo(0.8);
    expect(speedFromDrag(0.5, 100)).toBeCloseTo(0.7);
    // From 0.5×, 250 px lift it to 1× and the rest goes at the normal rate.
    expect(speedFromDrag(0.5, 300)).toBeCloseTo(1.5);
    expect(speedFromDrag(2, 10_000)).toBe(5);
    expect(speedFromDrag(2, -10_000)).toBe(0.2);
  });
});

describe("volume, frames, keys", () => {
  test("volume steps stay within 0..1", () => {
    expect(stepVolume(0.5, 0.05)).toBe(0.55);
    expect(stepVolume(0.98, 0.05)).toBe(1);
    expect(stepVolume(0.02, -0.05)).toBe(0);
  });

  test("a frame is the smallest sane gap between frames seen", () => {
    expect(estimateFrameDuration([1 / 30, 2 / 30, 1 / 30])).toBeCloseTo(1 / 30);
    expect(estimateFrameDuration([1 / 60, 1 / 30])).toBeCloseTo(1 / 60);
    expect(estimateFrameDuration([0.0001, 0.5])).toBe(DEFAULT_FRAME_SECONDS);
    expect(estimateFrameDuration([])).toBe(DEFAULT_FRAME_SECONDS);
  });

  test("Space belongs to a focused button or link, not to the player", () => {
    const button = document.createElement("button");
    const icon = button.appendChild(document.createElement("span"));
    expect(pressesOnSpace(button)).toBe(true);
    expect(pressesOnSpace(icon)).toBe(true);
    const link = document.createElement("a");
    link.href = "https://argon.gl";
    expect(pressesOnSpace(link)).toBe(true);
    const range = document.createElement("input");
    range.type = "range";
    expect(pressesOnSpace(range)).toBe(false);
    const body = document.createElement("div");
    body.tabIndex = 0;
    expect(pressesOnSpace(body)).toBe(false);
    expect(pressesOnSpace(null)).toBe(false);
  });

  test("keys belong to text fields, not to sliders and buttons", () => {
    const input = document.createElement("input");
    expect(isTextEntryTarget(input)).toBe(true);
    input.type = "range";
    expect(isTextEntryTarget(input)).toBe(false);
    expect(isTextEntryTarget(document.createElement("textarea"))).toBe(true);
    expect(isTextEntryTarget(document.createElement("button"))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
