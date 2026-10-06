/**
 * The video player's arithmetic, apart from the component so it can be tested on its own: time
 * labels, the buffered range under the playhead, storyboard cells, playback-rate steps and the
 * press-and-hold speed drag.
 */
import type { VideoStoryboard } from "@argon/glue";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** "0:42", "12:05", "1:02:03". `withHours` keeps the hour field for a clip shorter than one, so elapsed and total line up. */
export function formatTime(seconds: number, withHours = false): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 || withHours ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A clip's length as its badge shows it: rounded, so 41.6 s reads 0:42. */
export function formatDuration(ms: number): string {
  return formatTime(Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
}

export interface TimeRangesLike {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
}

/**
 * Where the buffered data playback reads from ends: the end of the range that holds `currentTime`
 * (the latest-starting one, should two touch). 0 when the playhead sits in a gap.
 */
export function bufferedEnd(ranges: TimeRangesLike | null | undefined, currentTime: number): number {
  if (!ranges) return 0;
  let start = -1;
  let end = 0;
  for (let i = 0; i < ranges.length; i++) {
    const s = ranges.start(i);
    const e = ranges.end(i);
    if (s <= currentTime + 0.01 && currentTime <= e + 0.25 && s >= start) {
      start = s;
      end = e;
    }
  }
  return end;
}

/** `value / total` held to 0..1; 0 when the total is not known yet. */
export function fraction(value: number, total: number): number {
  return total > 0 && Number.isFinite(value) ? clamp(value / total, 0, 1) : 0;
}

/** Where along a bar the pointer is, 0..1. */
export function pointerFraction(clientX: number, left: number, width: number): number {
  return width > 0 ? clamp((clientX - left) / width, 0, 1) : 0;
}

/** A scrub stops just short of the end, so dragging to the right edge does not end the video. */
export function scrubTime(f: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return clamp(f * duration, 0, Math.max(0, duration - 0.1));
}

/** The centre of a tooltip `width` wide pointing at `x` on a bar `barWidth` wide, pushed in so it stays over the bar. */
export function tooltipCentre(x: number, barWidth: number, width: number): number {
  if (barWidth <= width) return barWidth / 2;
  return clamp(x, width / 2, barWidth - width / 2);
}

export interface StoryboardCell {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The sprite cell for a moment: frame i covers [i·intervalMs, (i+1)·intervalMs), row-major,
 * `columns` per row. Past the last frame it is the last frame. Null for a map that cannot be cut.
 */
export function storyboardFrameAt(map: VideoStoryboard | null | undefined, timeMs: number): StoryboardCell | null {
  if (!map || !(map.frameCount > 0 && map.columns > 0 && map.intervalMs > 0 && map.frameWidth > 0 && map.frameHeight > 0)) return null;
  const index = clamp(Math.floor((Number.isFinite(timeMs) ? timeMs : 0) / map.intervalMs), 0, map.frameCount - 1);
  return {
    index,
    x: (index % map.columns) * map.frameWidth,
    y: Math.floor(index / map.columns) * map.frameHeight,
    width: map.frameWidth,
    height: map.frameHeight,
  };
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5] as const;
/** The custom-speed slider's range. */
export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 4;

export function clampPlaybackRate(rate: number): number {
  return Number.isFinite(rate) ? clamp(Math.round(rate * 100) / 100, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE) : 1;
}

export function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/** Alt+= / Alt+-: the next listed speed up or down from wherever it is now, custom speeds included. */
export function stepPlaybackRate(current: number, direction: 1 | -1): number {
  if (direction > 0) return PLAYBACK_RATES.find((r) => r > current + 0.005) ?? PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
  for (let i = PLAYBACK_RATES.length - 1; i >= 0; i--) if (PLAYBACK_RATES[i] < current - 0.005) return PLAYBACK_RATES[i];
  return PLAYBACK_RATES[0];
}

/** "1", "1.5", "1.25" — the number in front of the ×. */
export function formatRate(rate: number): string {
  return String(Math.round(rate * 100) / 100);
}

// Press-and-hold speed (tweb's speedDragHandler semantics): holding a playing video at 1× plays it
// at 2×; dragging sideways moves the speed a hundredth per pixel, five times slower below 1×.
export const HOLD_MIN_RATE = 0.2;
export const HOLD_MAX_RATE = 5;
const RATE_PER_PX = 1 / 100;
const BELOW_ONE = 0.2;

/** The speed a hold starts at: 2× from normal speed, otherwise the speed already chosen. */
export function holdStartRate(current: number): number {
  return sameRate(current, 1) ? 2 : current;
}

/** The speed after dragging `dx` pixels from a hold that started at `start`. */
export function speedFromDrag(start: number, dx: number): number {
  const change = dx * RATE_PER_PX;
  let speed: number;
  if (start < 1) {
    // Below 1× a pixel buys a fifth as much, until 1× is reached; past it, the normal rate.
    const borrowed = Math.min((1 - start) / BELOW_ONE, change);
    speed = start + borrowed * BELOW_ONE + Math.max(0, change - borrowed);
  } else if (start + change < 1) {
    speed = 1 - (1 - start - change) * BELOW_ONE;
  } else {
    speed = start + change;
  }
  return clamp(speed, HOLD_MIN_RATE, HOLD_MAX_RATE);
}

/** Volume after a step, held to 0..1 and to two decimals. */
export function stepVolume(volume: number, delta: number): number {
  return clamp(Math.round(((Number.isFinite(volume) ? volume : 1) + delta) * 100) / 100, 0, 1);
}

export const DEFAULT_FRAME_SECONDS = 1 / 30;

/**
 * One frame's length from the media times of frames seen while playing: the smallest gap, since a
 * dropped frame only ever makes a gap longer. Outside 1/120..1/10 s it is noise; then 1/30.
 */
export function estimateFrameDuration(gaps: readonly number[]): number {
  let best = Infinity;
  for (const gap of gaps) if (gap >= 1 / 120 && gap <= 1 / 10 && gap < best) best = gap;
  return Number.isFinite(best) ? best : DEFAULT_FRAME_SECONDS;
}

const PRESSABLE =
  'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="checkbox"], [role="switch"], [role="tab"], [role="option"], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"], input[type="reset"]';

/** Whether Space on this target presses something (a focused button or link), and so is not the player's. */
export function pressesOnSpace(target: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return target.closest(PRESSABLE) !== null;
}

/** Whether a key press belongs to something being typed into: text fields, not sliders or buttons. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  if (target.tagName !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file"].includes(type);
}
