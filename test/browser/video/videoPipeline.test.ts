/**
 * The video pipeline in a real browser, on a source made in the test: the probe reads it, the
 * poster and storyboard decode it, and prepareVideo turns it into a fast-start MP4 (in the worker
 * and on the page) that trims to the right length and stops when cancelled.
 *
 * Chromium as Playwright ships it may have no H.264 encoder; then the transcode runs with a VP9
 * override so the pipeline is still exercised end to end, and the H.264-only checks are skipped.
 */

import { describe, test, expect, beforeAll } from "vitest";
import { canEncode } from "mediabunny";
import { probeVideo, type VideoProbe } from "@/lib/video/probe";
import { durationsAgree, planVideo, type VideoEncoderAvailability } from "@/lib/video/plan";
import { videoCodecAvailability, type VideoCodecAvailability } from "@/lib/video/codecs";
import { prepareVideo, prepareWithinLimit } from "@/lib/video/transcode";
import { extractPoster } from "@/lib/video/poster";
import { buildStoryboard } from "@/lib/video/storyboard";
import { computePreloadPrefixSize } from "@/lib/video/preloadPrefix";
import { readTopLevelBoxes } from "@/lib/video/mp4Boxes";
import { VideoPrepareError, VideoProbeError } from "@/lib/video/errors";
import { makeSource } from "./source";

const ENCODE_ALL: VideoEncoderAvailability = { avc: true, aac: true };
const BIG = 1e9;

let source: Blob;
let probe: VideoProbe;
let caps: VideoCodecAvailability;
/** Transcode to H.264 where the browser can, else to VP9 (test-only override). */
let videoCodec: "vp9" | undefined;

beforeAll(async () => {
  [source, caps] = await Promise.all([makeSource(), videoCodecAvailability()]);
  probe = await probeVideo(source);
  videoCodec = caps.avc ? undefined : "vp9";
  console.info(
    `[video] H.264 encoder: ${caps.avc ? "yes" : "no — transcodes use a VP9 override and H.264 checks are skipped"}; ` +
      `AAC encoder: ${caps.aac ? (caps.aacPolyfill ? "WASM polyfill" : "native") : "no"}`,
  );
}, 60_000);

describe("probeVideo", () => {
  test("reads a VP9 + Opus WebM", () => {
    expect(probe).toMatchObject({
      size: source.size,
      container: "webm",
      width: 320,
      height: 180,
      rotation: 0,
      videoCodec: "vp9",
      audioCodec: "opus",
      hasAudio: true,
      canDecodeVideo: true,
      canDecodeAudio: true,
      fastStart: false,
      pixelAspectRatio: 1,
      headerDurationMs: null,
      videoTrackCount: 1,
      audioTrackCount: 1,
    });
    expect(probe.durationMs).toBeGreaterThan(9_900);
    expect(probe.durationMs).toBeLessThan(10_200);
    expect(probe.fps).toBeCloseTo(10, 0);
    expect(probe.videoCodecString).toMatch(/^vp09\./);
    expect(probe.bitrate).toBeGreaterThan(0);
  });

  test("a file that is not media is unsupported-format", async () => {
    const error = await probeVideo(new Blob(["just some text, not a video"], { type: "text/plain" })).catch((e) => e);
    expect(error).toBeInstanceOf(VideoProbeError);
    expect(error.code).toBe("unsupported-format");
  });

  test("an audio-only file has no video track", async () => {
    const audioOnly = await makeSource({ durationSec: 1, video: null });
    await expect(probeVideo(audioOnly)).rejects.toMatchObject({ code: "no-video-track" });
  });
});

describe("poster and storyboard", () => {
  test("extractPoster: a WebP of the frame, never upscaled, with its ThumbHash", async () => {
    const poster = await extractPoster(source, 1_000);
    expect(poster.blob.type).toBe("image/webp");
    expect([poster.width, poster.height]).toEqual([320, 180]);
    const bitmap = await createImageBitmap(poster.blob);
    expect([bitmap.width, bitmap.height]).toEqual([320, 180]);
    const hash = Uint8Array.from(atob(poster.thumbHash), (c) => c.charCodeAt(0));
    expect(hash.length).toBeGreaterThan(5);

    const small = await extractPoster(source, 1_000, { maxSide: 160 });
    expect([small.width, small.height]).toEqual([160, 90]);
  });

  test("extractPoster before the first frame takes the first frame", async () => {
    const poster = await extractPoster(source, -500);
    expect(poster.width).toBe(320);
  });

  test("buildStoryboard: one frame per second, ten to a row, in one WebP", async () => {
    const board = await buildStoryboard(source, probe.durationMs);
    expect(board).not.toBeNull();
    expect(board!.storyboard).toEqual({ frameWidth: 160, frameHeight: 90, columns: 10, frameCount: 10, intervalMs: 1_000 });
    expect(board!.blob.type).toBe("image/webp");

    const bitmap = await createImageBitmap(board!.blob);
    expect([bitmap.width, bitmap.height]).toEqual([1_600, 90]);

    // The hue cycles over the video, so the first and the last frames differ.
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const first = ctx.getImageData(5, 5, 1, 1).data;
    const last = ctx.getImageData(9 * 160 + 5, 5, 1, 1).data;
    expect(Math.abs(first[0] - last[0]) + Math.abs(first[1] - last[1]) + Math.abs(first[2] - last[2])).toBeGreaterThan(60);
  });

  test("buildStoryboard skips a short video", async () => {
    expect(await buildStoryboard(source, 5_000)).toBeNull();
  });

  test("a cancel stops the poster and the storyboard (aborted)", async () => {
    const controller = new AbortController();
    const board = buildStoryboard(source, probe.durationMs, { signal: controller.signal });
    const poster = extractPoster(source, 1_000, { signal: controller.signal });
    controller.abort();
    await expect(board).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
    await expect(poster).rejects.toMatchObject({ code: "aborted", name: "AbortError" });
  });
});

describe("prepareVideo", () => {
  test(
    "transcodes in the worker to a fast-start MP4 with AAC",
    async () => {
      const plan = planVideo(probe, { quality: "auto", maxBytes: BIG }, ENCODE_ALL);
      expect(plan.mode).toBe("transcode");
      expect(plan.audio).toBe("aac");

      const progress: number[] = [];
      const prepared = await prepareVideo(source, plan, { videoCodec, onProgress: (f) => progress.push(f) });

      expect(prepared.mode).toBe("transcode");
      expect(prepared.blob.type).toBe("video/mp4");
      expect([prepared.width, prepared.height]).toEqual([320, 180]);
      expect(prepared.hasAudio).toBe(true);
      expect(Math.abs(prepared.durationMs - probe.durationMs)).toBeLessThan(200);
      expect(progress.at(-1)).toBe(1);
      if (caps.avc) expect(prepared.codecString).toMatch(/^avc1\./);
      else expect(prepared.codecString).toMatch(/^vp09\./);

      const out = await probeVideo(prepared.blob);
      expect(out).toMatchObject({ container: "mp4", fastStart: true, width: 320, height: 180, hasAudio: true, audioCodec: "aac", pixelAspectRatio: 1 });
      expect(out.videoCodec).toBe(caps.avc ? "avc" : "vp9");
      // What the server reads (mvhd) agrees with what is declared.
      expect(out.headerDurationMs).not.toBeNull();
      expect(durationsAgree(out.headerDurationMs!, prepared.durationMs)).toBe(true);

      const boxes = await readTopLevelBoxes(prepared.blob);
      const moov = boxes.find((b) => b.type === "moov")!;
      const prefix = await computePreloadPrefixSize(prepared.blob, (prepared.blob.size * 8) / (prepared.durationMs / 1000));
      expect(prefix).toBeGreaterThan(moov.offset + moov.size);
      expect(prefix).toBeLessThanOrEqual(prepared.blob.size);
    },
    120_000,
  );

  test(
    "a trim keeps exactly the chosen range (on the page)",
    async () => {
      const plan = planVideo(probe, { quality: "auto", maxBytes: BIG, trim: { startMs: 2_000, endMs: 6_000 }, mute: true }, ENCODE_ALL);
      expect(plan.durationMs).toBe(4_000);

      const prepared = await prepareVideo(source, plan, { videoCodec, onMainThread: true });

      expect(Math.abs(prepared.durationMs - 4_000)).toBeLessThan(150);
      expect(prepared.hasAudio).toBe(false);
      const out = await probeVideo(prepared.blob);
      expect(Math.abs(out.durationMs - 4_000)).toBeLessThan(150);
      expect(out.hasAudio).toBe(false);
    },
    120_000,
  );

  test(
    "a crop and a rotation come out at the cropped, rotated size",
    async () => {
      const plan = planVideo(probe, { quality: "auto", maxBytes: BIG, rotate: 90, crop: { left: 0, top: 70, width: 180, height: 180 } }, ENCODE_ALL);
      expect([plan.width, plan.height]).toEqual([180, 180]);
      const prepared = await prepareVideo(source, plan, { videoCodec });
      expect([prepared.width, prepared.height]).toEqual([180, 180]);
    },
    120_000,
  );

  test(
    "a cancel stops the conversion and rejects as aborted",
    async () => {
      const long = await makeSource({ durationSec: 30, fps: 30, width: 640, height: 360, audio: null });
      const plan = planVideo(await probeVideo(long), { quality: "auto", maxBytes: BIG }, ENCODE_ALL);
      const controller = new AbortController();

      const startedAt = performance.now();
      const error = await prepareVideo(long, plan, { videoCodec, signal: controller.signal, onProgress: () => controller.abort() }).catch((e) => e);

      expect(error).toBeInstanceOf(VideoPrepareError);
      expect(error).toMatchObject({ code: "aborted", name: "AbortError" });
      expect(performance.now() - startedAt).toBeLessThan(20_000);
    },
    120_000,
  );

  test("an already-cancelled signal rejects at once", async () => {
    const controller = new AbortController();
    controller.abort();
    const plan = planVideo(probe, { quality: "auto", maxBytes: BIG }, ENCODE_ALL);
    await expect(prepareVideo(source, plan, { signal: controller.signal, videoCodec })).rejects.toMatchObject({ code: "aborted" });
  });

  test("an 'original' plan is not preparable", async () => {
    const plan = planVideo(probe, { quality: "original", maxBytes: BIG }, ENCODE_ALL);
    expect(plan.mode).toBe("original");
    await expect(prepareVideo(source, plan)).rejects.toMatchObject({ code: "not-preparable" });
  });

  test(
    "prepareWithinLimit: plan and prepare in one call, within the limit",
    async () => {
      const progress: number[] = [];
      const { plan, prepared } = await prepareWithinLimit(source, probe, { quality: "auto", maxBytes: 50 * 1024 * 1024, mute: true }, ENCODE_ALL, {
        videoCodec,
        onProgress: (f) => progress.push(f),
      });
      expect(plan.mode).toBe("transcode");
      expect(prepared!.blob.size).toBeLessThanOrEqual(plan.maxBytes);
      for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    },
    120_000,
  );

  test(
    "the codec override (what a Chromium without H.264 runs) gives a VP9 MP4",
    async () => {
      const plan = planVideo(probe, { quality: 360, maxBytes: BIG, mute: true }, ENCODE_ALL);
      const prepared = await prepareVideo(source, plan, { videoCodec: "vp9" });
      expect(prepared.codecString).toMatch(/^vp09\./);
      expect(await probeVideo(prepared.blob)).toMatchObject({ container: "mp4", fastStart: true, videoCodec: "vp9" });
    },
    120_000,
  );

  test(
    "an H.264 MP4 that is already right goes as it is",
    async (ctx) => {
      if (!(await canEncode("avc"))) {
        console.info("[video] copy path skipped: this Chromium has no H.264 encoder to make the source with");
        ctx.skip();
        return;
      }
      const mp4 = await makeSource({ durationSec: 3, video: "avc", audio: null, container: "mp4" });
      const p = await probeVideo(mp4);
      expect(p).toMatchObject({ container: "mp4", fastStart: true, videoCodec: "avc", hasAudio: false, pixelAspectRatio: 1 });
      expect(durationsAgree(p.headerDurationMs!, p.durationMs)).toBe(true);
      const plan = planVideo(p, { quality: "auto", maxBytes: BIG }, ENCODE_ALL);
      expect(plan.mode).toBe("copy");

      const prepared = await prepareVideo(mp4, plan);
      expect(prepared.mode).toBe("copy");
      expect(prepared.blob.size).toBe(mp4.size);
      expect(new Uint8Array(await prepared.blob.arrayBuffer())).toEqual(new Uint8Array(await mp4.arrayBuffer()));
    },
    60_000,
  );
});

// Last: registering the polyfill replaces the native AAC encoder for the rest of this page.
describe("the AAC polyfill (what Firefox runs)", () => {
  test(
    "encodes the audio of a transcode on the page",
    async () => {
      const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
      registerAacEncoder();

      const plan = planVideo(probe, { quality: 360, maxBytes: BIG, trim: { startMs: 0, endMs: 3_000 } }, ENCODE_ALL);
      expect(plan.audio).toBe("aac");
      const prepared = await prepareVideo(source, plan, { videoCodec, onMainThread: true });

      expect(prepared.hasAudio).toBe(true);
      expect(await probeVideo(prepared.blob)).toMatchObject({ audioCodec: "aac", hasAudio: true });
    },
    120_000,
  );
});
