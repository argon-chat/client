/**
 * Poster and storyboard on a browser that cannot decode the video: a typed `undecodable` at once
 * rather than a hang, also when the decoder never answers; a cancel is `aborted`.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => ({
  canDecode: true,
  inputs: 0,
  getCanvas: (() => Promise.resolve(null)) as (t: number) => Promise<unknown>,
  disposed: 0,
  pending: [] as Array<(e: Error) => void>,
}));

vi.mock("mediabunny", () => {
  const track = {
    canDecode: async () => m.canDecode,
    getCodecParameterString: async () => "avc1.640028",
    getDisplayWidth: async () => 1920,
    getDisplayHeight: async () => 1080,
    getFirstTimestamp: async () => 0,
  };
  class Input {
    constructor() {
      m.inputs++;
    }
    getPrimaryVideoTrack = async () => track;
    dispose() {
      m.disposed++;
      for (const reject of m.pending.splice(0)) reject(new Error("Input disposed"));
    }
  }
  class CanvasSink {
    getCanvas(t: number) {
      return m.getCanvas(t);
    }
    async *canvasesAtTimestamps() {
      yield await m.getCanvas(0);
    }
  }
  return { ALL_FORMATS: [], BlobSource: class {}, Input, CanvasSink };
});

import { extractPoster } from "@/lib/video/poster";
import { buildStoryboard } from "@/lib/video/storyboard";
import { FRAME_TIMEOUT_MS } from "@/lib/video/frames";
import { VideoPrepareError } from "@/lib/video/errors";

const src = new Blob([new Uint8Array(8)]);

beforeEach(() => {
  m.canDecode = true;
  m.inputs = 0;
  m.disposed = 0;
  m.pending = [];
  m.getCanvas = () => Promise.resolve(null);
});

afterEach(() => vi.useRealTimers());

describe("poster and storyboard on an undecodable video", () => {
  test("extractPoster rejects with undecodable and disposes the input", async () => {
    m.canDecode = false;
    const error = await extractPoster(src, 1_000).catch((e) => e);
    expect(error).toBeInstanceOf(VideoPrepareError);
    expect(error.code).toBe("undecodable");
    expect(m.disposed).toBeGreaterThan(0);
  });

  test("buildStoryboard rejects with undecodable", async () => {
    m.canDecode = false;
    await expect(buildStoryboard(src, 60_000)).rejects.toMatchObject({ code: "undecodable" });
  });

  test("buildStoryboard of a short video is null without opening it", async () => {
    m.canDecode = false;
    expect(await buildStoryboard(src, 5_000)).toBeNull();
    expect(m.inputs).toBe(0);
  });

  test("a decoder that never answers is undecodable after the frame timeout", async () => {
    vi.useFakeTimers();
    m.getCanvas = () => new Promise(() => {});
    const poster = extractPoster(src, 1_000).catch((e) => e);
    await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS + 1);
    expect(await poster).toMatchObject({ code: "undecodable" });

    const board = buildStoryboard(src, 60_000).catch((e) => e);
    await vi.advanceTimersByTimeAsync(FRAME_TIMEOUT_MS + 1);
    expect(await board).toMatchObject({ code: "undecodable" });
  });

  test("a cancel is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractPoster(src, 0, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    await expect(buildStoryboard(src, 60_000, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(m.inputs).toBe(0);
  });

  test("a cancel while a frame is decoding disposes the input, which ends the decode: aborted", async () => {
    const controller = new AbortController();
    // As mediabunny does: disposing the input rejects the reads in flight.
    m.getCanvas = () => new Promise((_, reject) => m.pending.push(reject));
    const poster = extractPoster(src, 0, { signal: controller.signal }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 0));
    expect(m.pending).toHaveLength(1);
    controller.abort();
    expect(await poster).toMatchObject({ code: "aborted", name: "AbortError" });
    expect(m.disposed).toBeGreaterThan(0);
  });
});
