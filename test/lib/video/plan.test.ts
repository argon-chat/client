/**
 * The preparation plan: copy what is already right, repackage what only has the wrong box, re-encode
 * the rest on Telegram's ladder and bitrates, and give up (send as a file) when this browser cannot
 * do it or nothing fits the size limit.
 */

import { describe, test, expect } from "vitest";
import {
  avcProfileOf,
  durationsAgree,
  estimateOutputBytes,
  LOW_MEMORY_BUDGET_BYTES,
  MEMORY_BUDGET_BYTES,
  planVideo,
  rungBelow,
  rungOf,
  scaledDimensions,
  tierOf,
  videoBitrate,
  videoMemoryBudget,
  type VideoEncoderAvailability,
  type VideoPrefs,
} from "@/lib/video/plan";
import type { VideoProbe } from "@/lib/video/probe";

const MB = 1024 * 1024;
const ALL: VideoEncoderAvailability = { avc: true, aac: true };

function probe(over: Partial<VideoProbe> = {}): VideoProbe {
  return {
    size: 20 * MB,
    container: "mp4",
    width: 1920,
    height: 1080,
    rotation: 0,
    durationMs: 30_000,
    fps: 30,
    videoCodec: "avc",
    videoCodecString: "avc1.640028",
    audioCodec: "aac",
    hasAudio: true,
    canDecodeVideo: true,
    canDecodeAudio: true,
    bitrate: 5_000_000,
    audioBitrate: 128_000,
    fastStart: true,
    pixelAspectRatio: 1,
    headerDurationMs: 30_000,
    videoTrackCount: 1,
    audioTrackCount: 1,
    ...over,
  };
}

const prefs = (over: Partial<VideoPrefs> = {}): VideoPrefs => ({ quality: "auto", maxBytes: 100 * MB, ...over });

const HEVC = { videoCodec: "hevc", videoCodecString: "hvc1.1.6.L120.90" } as const;

describe("mode", () => {
  test.each([
    ["H.264 + AAC MP4, moov first, within 1080p", probe(), prefs(), "copy", "copy"],
    ["silent H.264 MP4", probe({ hasAudio: false, audioCodec: null, audioTrackCount: 0, audioBitrate: 0 }), prefs(), "copy", "none"],
    ["a MOV of H.264 + AAC", probe({ container: "mov" }), prefs(), "remux", "copy"],
    ["an MP4 with moov at the end", probe({ fastStart: false }), prefs(), "remux", "copy"],
    ["an MKV of H.264 + Opus", probe({ container: "mkv", audioCodec: "opus" }), prefs(), "remux", "aac"],
    ["muted", probe(), prefs({ mute: true }), "remux", "none"],
    ["a second audio track", probe({ audioTrackCount: 2 }), prefs(), "remux", "copy"],
    ["HEVC", probe(HEVC), prefs(), "transcode", "copy"],
    ["4K H.264", probe({ width: 3840, height: 2160, bitrate: 30_000_000 }), prefs(), "transcode", "copy"],
    ["1080p H.264 at 20 Mbps", probe({ bitrate: 20_000_000 }), prefs(), "transcode", "copy"],
    ["H.264 High 10", probe({ videoCodecString: "avc1.6e0028" }), prefs(), "transcode", "copy"],
    ["odd-sized H.264", probe({ width: 1919 }), prefs(), "transcode", "copy"],
    ["VP9 + Opus WebM", probe({ container: "webm", videoCodec: "vp9", videoCodecString: "vp09.00.40.08", audioCodec: "opus" }), prefs(), "transcode", "aac"],
    ["a 720p cap on a 1080p H.264", probe(), prefs({ quality: 720 }), "transcode", "copy"],
    ["a trim", probe(), prefs({ trim: { startMs: 1_000, endMs: 5_000 } }), "transcode", "copy"],
    ["a crop", probe(), prefs({ crop: { left: 0, top: 0, width: 1080, height: 1080 } }), "transcode", "copy"],
    ["a rotation", probe(), prefs({ rotate: 90 }), "transcode", "copy"],
    ["a mirror", probe(), prefs({ flip: true }), "transcode", "copy"],
    ["muted HEVC", probe(HEVC), prefs({ mute: true }), "transcode", "none"],
    ["'original' on a MOV", probe({ container: "mov" }), prefs({ quality: "original" }), "remux", "copy"],
    ["'original' on a 4K H.264 MP4", probe({ width: 3840, height: 2160, bitrate: 40_000_000, size: 90 * MB }), prefs({ quality: "original" }), "copy", "copy"],
    ["a trim that keeps everything", probe(), prefs({ trim: { startMs: 0, endMs: 30_000 } }), "copy", "copy"],
    ["anamorphic H.264 (4:3 pixels)", probe({ pixelAspectRatio: 4 / 3 }), prefs(), "transcode", "copy"],
    ["anamorphic H.264 in a MOV", probe({ container: "mov", pixelAspectRatio: 0.9 }), prefs(), "transcode", "copy"],
    ["pixels within 1 % of square", probe({ pixelAspectRatio: 1.008 }), prefs(), "copy", "copy"],
    ["120 fps H.264", probe({ fps: 120 }), prefs(), "transcode", "copy"],
    ["mvhd 5 s longer than the packets (an edit list)", probe({ headerDurationMs: 35_000 }), prefs(), "remux", "copy"],
    ["no mvhd duration", probe({ headerDurationMs: null }), prefs(), "remux", "copy"],
    ["mvhd within the server's tolerance", probe({ headerDurationMs: 30_900 }), prefs(), "copy", "copy"],
  ] as const)("%s → %s", (_, p, pr, mode, audio) => {
    const plan = planVideo(p, pr, ALL);
    expect(plan.mode).toBe(mode);
    expect(plan.audio).toBe(audio);
    expect(plan.reason).toBeNull();
    expect(plan.video === null).toBe(mode !== "transcode");
  });

  test.each([
    ["no H.264 encoder", probe(HEVC), prefs(), { avc: false, aac: true }, "no-encoder"],
    ["undecodable video", probe({ ...HEVC, canDecodeVideo: false }), prefs(), ALL, "undecodable"],
    ["undecodable non-AAC audio", probe({ ...HEVC, audioCodec: "ac3", canDecodeAudio: false }), prefs(), ALL, "undecodable"],
    ["no AAC encoder for Opus", probe({ ...HEVC, audioCodec: "opus" }), prefs(), { avc: true, aac: false }, "no-encoder"],
    ["'original' on HEVC", probe(HEVC), prefs({ quality: "original" }), ALL, "user-original"],
    ["nothing fits the limit", probe({ ...HEVC, durationMs: 3_600_000 }), prefs({ maxBytes: 10 * MB }), ALL, "too-large"],
    ["nothing fits the memory budget", probe({ ...HEVC, durationMs: 3_600_000 }), prefs({ maxBytes: 4_000 * MB }), { ...ALL, memoryBudgetBytes: 256 * MB }, "too-large"],
    ["'original' on a 120 fps H.264", probe({ fps: 120, container: "mov" }), prefs({ quality: "original" }), ALL, "user-original"],
    ["'original' that does not fit", probe({ size: 200 * MB }), prefs({ quality: "original" }), ALL, "user-original"],
  ] as const)("%s → original (%s)", (_, p, pr, encoders, reason) => {
    const plan = planVideo(p, pr, encoders);
    expect(plan.mode).toBe("original");
    expect(plan.reason).toBe(reason);
    expect(plan.video).toBeNull();
    expect(plan.estimatedBytes).toBe(p.size);
  });

  test("a muted H.264 + undecodable audio still remuxes: the audio is dropped, not decoded", () => {
    const plan = planVideo(probe({ audioCodec: "ac3", canDecodeAudio: false }), prefs({ mute: true }), ALL);
    expect(plan.mode).toBe("remux");
    expect(plan.audio).toBe("none");
  });

  test("an AAC track is copied into a transcode even when this browser cannot decode AAC", () => {
    const plan = planVideo(probe({ ...HEVC, canDecodeAudio: false }), prefs(), { avc: true, aac: false });
    expect(plan.mode).toBe("transcode");
    expect(plan.audio).toBe("copy");
  });

  test("a copy over the limit is re-encoded instead", () => {
    const plan = planVideo(probe({ size: 150 * MB }), prefs(), ALL);
    expect(plan.mode).toBe("transcode");
    expect(plan.estimatedBytes).toBeLessThanOrEqual(100 * MB);
  });
});

describe("transcode target", () => {
  test.each([
    ["1080p at auto", { width: 1920, height: 1080 }, "auto", { width: 1920, height: 1080 }],
    ["4K at auto", { width: 3840, height: 2160 }, "auto", { width: 1920, height: 1080 }],
    ["1080p at 720", { width: 1920, height: 1080 }, 720, { width: 1280, height: 720 }],
    ["portrait 1080×1920 at 720", { width: 1080, height: 1920 }, 720, { width: 720, height: 1280 }],
    ["1080p at 480", { width: 1920, height: 1080 }, 480, { width: 854, height: 480 }],
    ["1080p at 360", { width: 1920, height: 1080 }, 360, { width: 640, height: 360 }],
    ["240p is never upscaled", { width: 426, height: 240 }, "auto", { width: 426, height: 240 }],
    ["odd sizes come out even", { width: 1279, height: 721 }, 1080, { width: 1280, height: 722 }],
  ] as const)("%s", (_, dims, quality, expected) => {
    const plan = planVideo(probe({ ...HEVC, ...dims }), prefs({ quality }), ALL);
    expect(plan.mode).toBe("transcode");
    expect({ width: plan.width, height: plan.height }).toEqual(expected);
    expect(plan.video).toMatchObject({ codec: "avc", ...expected, keyFrameIntervalSec: 2 });
  });

  test("rotation swaps the frame, crop is in the rotated frame", () => {
    const rotated = planVideo(probe(), prefs({ rotate: 90 }), ALL);
    expect([rotated.width, rotated.height]).toEqual([1080, 1920]);
    expect(rotated.rotate).toBe(90);

    const cropped = planVideo(probe(), prefs({ rotate: 270, crop: { left: 0, top: 420, width: 1080, height: 1080 } }), ALL);
    expect([cropped.width, cropped.height]).toEqual([1080, 1080]);
    expect(cropped.crop).toEqual({ left: 0, top: 420, width: 1080, height: 1080 });
  });

  test("a crop is clamped to the frame", () => {
    const plan = planVideo(probe(), prefs({ crop: { left: 1800, top: -5, width: 400, height: 2000 } }), ALL);
    expect(plan.crop).toEqual({ left: 1800, top: 0, width: 120, height: 1080 });
  });

  test("a trim sets the output duration and is clamped to the source", () => {
    const plan = planVideo(probe(), prefs({ trim: { startMs: 25_000, endMs: 40_000 } }), ALL);
    expect(plan.trim).toEqual({ startMs: 25_000, endMs: 30_000 });
    expect(plan.durationMs).toBe(5_000);
  });

  test("a trim shorter than 100 ms is refused", () => {
    expect(() => planVideo(probe(), prefs({ trim: { startMs: 1_000, endMs: 1_050 } }), ALL)).toThrow(RangeError);
  });

  test.each([
    [120, 60],
    [59.94, null],
    [60, null],
    [null, null],
  ])("%s fps → frame rate %s", (fps, expected) => {
    const plan = planVideo(probe({ ...HEVC, fps }), prefs(), ALL);
    expect(plan.video?.frameRate).toBe(expected);
  });

  test("steps down the ladder until it fits", () => {
    // 10 minutes of HEVC: 1080p at 6.8 Mbps is ~520 MB, 720p at 2.6 Mbps ~205 MB, 480p at 1 Mbps ~84 MB.
    const plan = planVideo(probe({ ...HEVC, durationMs: 600_000, bitrate: 12_000_000 }), prefs({ maxBytes: 100 * MB }), ALL);
    expect(plan.mode).toBe("transcode");
    expect([plan.width, plan.height]).toEqual([854, 480]);
    expect(plan.downscaledToFit).toBe(true);
    expect(plan.estimatedBytes).toBeLessThanOrEqual(100 * MB);
  });

  test("a non-positive limit means no limit", () => {
    expect(planVideo(probe({ size: 10_000 * MB }), prefs({ maxBytes: 0 }), ALL).mode).toBe("copy");
  });
});

describe("Telegram's makeVideoBitrate", () => {
  test.each([
    ["1080p at 10 Mbps → capped at 6.8 Mbps", { width: 1920, height: 1080, bitrate: 10_000_000 }, { width: 1920, height: 1080 }, 6_800_000],
    ["1080p at 4 Mbps → 720p, remeasured 2.67 Mbps capped at 2.6", { width: 1920, height: 1080, bitrate: 4_000_000 }, { width: 1280, height: 720 }, 2_600_000],
    ["1080p at 3 Mbps → 720p, lifted to the 2.26 Mbps floor", { width: 1920, height: 1080, bitrate: 3_000_000 }, { width: 1280, height: 720 }, 2_260_000],
    ["1080p at 1 Mbps → 720p, below the floor: keeps its rate", { width: 1920, height: 1080, bitrate: 1_000_000 }, { width: 1280, height: 720 }, 666_667],
    ["720p at 1.2 Mbps → 360p, floor 0.7 × 2.26 Mbps × ¼", { width: 1280, height: 720, bitrate: 1_200_000 }, { width: 640, height: 360 }, 395_500],
    ["unknown source rate → the tier's cap", { width: 1920, height: 1080, bitrate: 0 }, { width: 854, height: 480 }, 1_000_000],
    ["never below 100 kbps", { width: 1920, height: 1080, bitrate: 50_000 }, { width: 640, height: 360 }, 100_000],
  ] as const)("%s", (_, source, out, expected) => {
    expect(videoBitrate(source, out)).toBe(expected);
  });

  test.each([
    [1920, 1080, 1080],
    [1080, 1920, 1080],
    [1280, 720, 720],
    [854, 480, 480],
    [640, 360, 360],
    [320, 240, 360],
  ] as const)("%i×%i is in the %ip tier", (w, h, tier) => {
    expect(tierOf(w, h)).toBe(tier);
  });
});

describe("helpers", () => {
  test("scaledDimensions caps the short side, keeps the aspect, rounds to even", () => {
    expect(scaledDimensions(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(scaledDimensions(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
    expect(scaledDimensions(640, 360, 1080)).toEqual({ width: 640, height: 360 });
    expect(scaledDimensions(1919, 1081, 1080)).toEqual({ width: 1918, height: 1080 });
  });

  test("rungOf: auto and original stand for 1080", () => {
    expect(rungOf("auto")).toBe(1080);
    expect(rungOf("original")).toBe(1080);
    expect(rungOf(480)).toBe(480);
  });

  test("avcProfileOf reads profile_idc", () => {
    expect(avcProfileOf("avc1.640028")).toBe(100);
    expect(avcProfileOf("avc1.42E01E")).toBe(66);
    expect(avcProfileOf("avc3.4d401f")).toBe(77);
    expect(avcProfileOf("hvc1.1.6.L120.90")).toBeNull();
    expect(avcProfileOf(null)).toBeNull();
  });

  test("estimateOutputBytes: (video + audio bitrate) × duration, 2% container overhead", () => {
    const plan = planVideo(probe(HEVC), prefs({ quality: 720 }), ALL);
    expect(plan.video?.bitrate).toBe(2_600_000);
    expect(estimateOutputBytes(plan, 10_000)).toBe(Math.ceil((((2_600_000 + 128_000) * 10_000) / 8000) * 1.02));
    expect(estimateOutputBytes(plan)).toBe(plan.estimatedBytes);
  });

  test("estimateOutputBytes of a copy scales the file by duration", () => {
    const plan = planVideo(probe(), prefs(), ALL);
    expect(estimateOutputBytes(plan)).toBe(20 * MB);
    expect(estimateOutputBytes(plan, 15_000)).toBe(10 * MB);
  });
});

describe("limits", () => {
  // 30 s of 1080p HEVC at 5 Mbps: 1080p comes to 19 614 600 bytes, 720p to 10 434 600.
  const hevc = probe({ ...HEVC });

  test("a transcode is planned against 90 % of maxBytes: hardware encoders overshoot", () => {
    expect(planVideo(hevc, prefs({ maxBytes: 22_000_000 }), ALL)).toMatchObject({ width: 1920, height: 1080, downscaledToFit: false });
    const tight = planVideo(hevc, prefs({ maxBytes: 20_000_000 }), ALL);
    expect(tight).toMatchObject({ mode: "transcode", width: 1280, height: 720, downscaledToFit: true, maxBytes: 20_000_000 });
    expect(tight.estimatedBytes).toBeLessThanOrEqual(0.9 * 20_000_000);
  });

  test("a copy is checked against maxBytes itself: its size is exact", () => {
    expect(planVideo(probe({ size: 99 * MB }), prefs({ maxBytes: 100 * MB }), ALL).mode).toBe("copy");
  });

  test("the plan carries the server's limit, Infinity without one", () => {
    expect(planVideo(probe(), prefs({ maxBytes: 100 * MB }), ALL).maxBytes).toBe(100 * MB);
    expect(planVideo(probe(), prefs({ maxBytes: 0 }), ALL).maxBytes).toBe(Number.POSITIVE_INFINITY);
    expect(planVideo(probe(HEVC), prefs({ quality: "original" }), ALL).maxBytes).toBe(100 * MB);
  });

  test("the memory budget caps what is built in memory, stepping down the ladder", () => {
    // 10 minutes of HEVC: 1080p ~530 MB (505 MiB), 720p ~209 MB, 480p ~86 MB.
    const long = probe({ ...HEVC, durationMs: 600_000, bitrate: 12_000_000 });
    const roomy = { maxBytes: 4_000 * MB };
    expect(planVideo(long, prefs(roomy), { ...ALL, memoryBudgetBytes: MEMORY_BUDGET_BYTES })).toMatchObject({ height: 1080 });
    expect(planVideo(long, prefs(roomy), { ...ALL, memoryBudgetBytes: LOW_MEMORY_BUDGET_BYTES })).toMatchObject({ height: 720, downscaledToFit: true });
    expect(planVideo(long, prefs(roomy), { ...ALL, memoryBudgetBytes: 100 * MB })).toMatchObject({ height: 480, downscaledToFit: true });
  });

  test("a remux over the budget is re-encoded; a copy is not held in memory, so no budget applies", () => {
    const big = { size: 600 * MB, maxBytes: 4_000 * MB };
    const budget = { ...ALL, memoryBudgetBytes: MEMORY_BUDGET_BYTES };
    expect(planVideo(probe({ container: "mov", size: big.size }), prefs({ maxBytes: big.maxBytes }), budget).mode).toBe("transcode");
    expect(planVideo(probe({ size: big.size }), prefs({ maxBytes: big.maxBytes }), { ...ALL, memoryBudgetBytes: LOW_MEMORY_BUDGET_BYTES }).mode).toBe("copy");
  });

  test("videoMemoryBudget: 256 MiB on a ≤ 4 GB device, else 512 MiB", () => {
    expect(videoMemoryBudget(2)).toBe(256 * MB);
    expect(videoMemoryBudget(4)).toBe(256 * MB);
    expect(videoMemoryBudget(8)).toBe(512 * MB);
    expect(videoMemoryBudget(undefined)).toBe(512 * MB);
  });

  test("a 20:9 portrait at 720p is never floored above the tier's cap", () => {
    // 720×1600 has 1.25× the pixels of 1280×720: Telegram's floor would be 2.825 Mbps, over the 2.6 cap.
    expect(videoBitrate({ width: 1080, height: 2400, bitrate: 3_000_000 }, { width: 720, height: 1600 })).toBe(2_600_000);
    expect(videoBitrate({ width: 1080, height: 2400, bitrate: 20_000_000 }, { width: 720, height: 1600 })).toBe(2_600_000);
    const plan = planVideo(probe({ ...HEVC, width: 1080, height: 2400, bitrate: 3_000_000 }), prefs({ quality: 720 }), ALL);
    expect(plan.video?.bitrate).toBeLessThanOrEqual(2_600_000);
  });

  test.each([
    [1920, 1080, 720],
    [1080, 1920, 720],
    [1280, 720, 480],
    [854, 480, 360],
    [640, 360, null],
    [426, 240, null],
  ] as const)("the rung below %i×%i is %s", (w, h, expected) => {
    expect(rungBelow(w, h)).toBe(expected);
  });

  test("durationsAgree: within max(1 s, 2 %)", () => {
    expect(durationsAgree(30_000, 30_900)).toBe(true);
    expect(durationsAgree(30_000, 31_100)).toBe(false);
    expect(durationsAgree(100_000, 101_900)).toBe(true);
    expect(durationsAgree(100_000, 102_500)).toBe(false);
  });
});
