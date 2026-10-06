/**
 * The size check after preparing: an output over the server's limit (a hardware encoder overshooting
 * its bitrate) fails as `output-too-large`, and prepareWithinLimit plans once more one rung lower,
 * with progress that carries on rather than starting over.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const { convertVideo, describeMp4, count, distribution } = vi.hoisted(() => ({
  convertVideo: vi.fn(),
  describeMp4: vi.fn(),
  count: vi.fn(),
  distribution: vi.fn(),
}));

vi.mock("@/lib/video/convert", () => ({ convertVideo, describeMp4 }));
vi.mock("@/lib/telemetry/metrics", () => {
  const metrics = { count, distribution, gauge: vi.fn() };
  return { metrics, default: metrics };
});

import { prepareVideo, prepareWithinLimit } from "@/lib/video/transcode";
import { planVideo, type VideoEncoderAvailability, type VideoPlan, type VideoPrefs } from "@/lib/video/plan";
import { VideoPrepareError } from "@/lib/video/errors";
import type { VideoProbe } from "@/lib/video/probe";

const MB = 1024 * 1024;
const ENCODERS: VideoEncoderAvailability = { avc: true, aac: true, memoryBudgetBytes: 512 * MB };

/** 3 s of 1080p HEVC at 5 Mbps: planned at 1080p ≈ 1.96 MB, at 720p ≈ 1.04 MB. */
const PROBE: VideoProbe = {
  size: 2 * MB,
  container: "mp4",
  width: 1920,
  height: 1080,
  rotation: 0,
  durationMs: 3_000,
  fps: 30,
  videoCodec: "hevc",
  videoCodecString: "hvc1.1.6.L120.90",
  audioCodec: "aac",
  hasAudio: true,
  canDecodeVideo: true,
  canDecodeAudio: true,
  bitrate: 5_000_000,
  audioBitrate: 128_000,
  fastStart: true,
  pixelAspectRatio: 1,
  headerDurationMs: 3_000,
  videoTrackCount: 1,
  audioTrackCount: 1,
};

const PREFS: VideoPrefs = { quality: "auto", maxBytes: 2.5 * MB };
const source = new Blob([new Uint8Array(16)], { type: "video/mp4" });

/** Each conversion returns the next of `sizes` bytes and reports `progress` along the way. */
function converting(sizes: number[], progress: number[][] = []) {
  const plans: VideoPlan[] = [];
  convertVideo.mockImplementation(async (_file: Blob, plan: VideoPlan, options: { onProgress?: (f: number) => void }) => {
    plans.push(plan);
    for (const f of progress[plans.length - 1] ?? []) options.onProgress?.(f);
    return new ArrayBuffer(sizes[plans.length - 1] ?? sizes.at(-1)!);
  });
  describeMp4.mockImplementation(async () => {
    const plan = plans.at(-1)!;
    return { width: plan.width, height: plan.height, durationMs: plan.durationMs, hasAudio: true, codecString: "avc1.640028" };
  });
  return plans;
}

beforeEach(() => {
  convertVideo.mockReset();
  describeMp4.mockReset();
  count.mockReset();
  distribution.mockReset();
});

describe("output-too-large", () => {
  test("prepareVideo refuses an output over the plan's maxBytes", async () => {
    converting([2.6 * MB]);
    const plan = planVideo(PROBE, PREFS, ENCODERS);
    expect(plan).toMatchObject({ mode: "transcode", height: 1080, maxBytes: 2.5 * MB });

    const error = await prepareVideo(source, plan, { onMainThread: true }).catch((e) => e);

    expect(error).toBeInstanceOf(VideoPrepareError);
    expect(error.code).toBe("output-too-large");
    expect(count).toHaveBeenCalledWith("video.prepare", { mode: "transcode", result: "failed", error: "output-too-large" });
  });

  test("prepareWithinLimit plans one rung lower and prepares that; progress carries on", async () => {
    const plans = converting([2.6 * MB, 1 * MB], [[0.5, 0.8], [0.2, 0.6, 0.9]]);
    const seen: number[] = [];

    const result = await prepareWithinLimit(source, PROBE, PREFS, ENCODERS, { onMainThread: true, onProgress: (f) => seen.push(f) });

    expect(plans.map((p) => p.height)).toEqual([1080, 720]);
    expect(result.plan).toMatchObject({ mode: "transcode", width: 1280, height: 720 });
    expect(result.prepared?.blob.size).toBe(1 * MB);
    expect(seen).toEqual([0.5, 0.8, 0.9]);
  });

  test("it steps down once: a second overshoot is thrown", async () => {
    const plans = converting([2.6 * MB, 2.6 * MB]);
    await expect(prepareWithinLimit(source, PROBE, PREFS, ENCODERS, { onMainThread: true })).rejects.toMatchObject({ code: "output-too-large" });
    expect(plans).toHaveLength(2);
  });

  test("nothing below 360p: thrown", async () => {
    const plans = converting([2.6 * MB]);
    const small = { ...PROBE, width: 640, height: 360 };
    await expect(prepareWithinLimit(source, small, PREFS, ENCODERS, { onMainThread: true })).rejects.toMatchObject({ code: "output-too-large" });
    expect(plans).toHaveLength(1);
  });

  test("the original quality is not stepped down", async () => {
    const plans = converting([2.6 * MB]);
    const mov = { ...PROBE, container: "mov" as const, videoCodec: "avc" as const, videoCodecString: "avc1.640028" };
    const prefs = { ...PREFS, quality: "original" as const };
    await expect(prepareWithinLimit(source, mov, prefs, ENCODERS, { onMainThread: true })).rejects.toMatchObject({ code: "output-too-large" });
    expect(plans).toHaveLength(1);
    expect(plans[0].mode).toBe("remux");
  });

  test("an original plan comes back without preparing", async () => {
    converting([1]);
    const result = await prepareWithinLimit(source, PROBE, { ...PREFS, quality: "original" }, ENCODERS);
    expect(result).toMatchObject({ plan: { mode: "original", reason: "user-original" }, prepared: null });
    expect(convertVideo).not.toHaveBeenCalled();
  });

  test("an output within the limit goes through on the first plan", async () => {
    const plans = converting([2 * MB]);
    const result = await prepareWithinLimit(source, PROBE, PREFS, ENCODERS, { onMainThread: true });
    expect(plans).toHaveLength(1);
    expect(result.prepared).toMatchObject({ mode: "transcode", width: 1920, height: 1080 });
    expect(count).toHaveBeenCalledWith("video.prepare", { mode: "transcode", result: "ok" });
  });
});
