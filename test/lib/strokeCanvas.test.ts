import { afterEach, describe, expect, it, vi } from "vitest";
import { StrokeCanvas } from "@/lib/screencast-draw/StrokeCanvas";

/** A canvas whose 2D context counts its frames (one clearRect each) and strokes. */
function fakeCanvas() {
  const calls = { frames: 0, strokes: 0 };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (key === "clearRect") return () => { calls.frames++; };
      if (key === "stroke") return () => { calls.strokes++; };
      return key in target ? target[key as string] : () => {};
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  });
  const canvas = { width: 100, height: 100, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

const begin = (strokeId: string) => ({
  v: 1 as const, from: "viewer", target: "host", t: 0, kind: "begin" as const,
  strokeId, tool: "brush" as const, color: "#ff0000", width: 0.01, ttlMs: 1000,
  p: [[0.1, 0.1], [0.2, 0.2]] as [number, number][],
});

describe("StrokeCanvas", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("paints on a timer when no animation frame comes", () => {
    // The native app's overlay while its main window is minimised or covered.
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    let now = 0;
    const { canvas, calls } = fakeCanvas();
    const surface = new StrokeCanvas(canvas, () => now);

    surface.ingest(begin("s1"));
    surface.kick();
    expect(calls.frames).toBe(0);

    vi.advanceTimersByTime(60);
    expect(calls.frames).toBe(1);
    expect(calls.strokes).toBeGreaterThan(0);

    surface.ingest({ v: 1, from: "viewer", target: "host", t: 0, kind: "end", strokeId: "s1" });
    now = 5_000;
    vi.advanceTimersByTime(60);
    expect(surface.hasStrokes()).toBe(false);

    // Nothing alive: the loop has stopped.
    const frames = calls.frames;
    vi.advanceTimersByTime(500);
    expect(calls.frames).toBe(frames);
  });

  it("an animation frame paints once, and the timer behind it does not paint again", () => {
    vi.useFakeTimers();
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queued.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { canvas, calls } = fakeCanvas();
    const surface = new StrokeCanvas(canvas, () => 0);

    surface.ingest(begin("s1"));
    surface.kick();
    queued.shift()!(0);
    expect(calls.frames).toBe(1);

    // The stale timer from the first schedule was cleared; only the new one is pending.
    vi.advanceTimersByTime(49);
    expect(calls.frames).toBe(1);
    surface.stop();
  });
});
