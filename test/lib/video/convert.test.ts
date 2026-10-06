/**
 * How a plan becomes mediabunny Conversion options: a packet copy sets nothing on the video, a
 * transcode sets the H.264 target with rotation baked in, the audio is copied, re-encoded to AAC or
 * dropped, and the trim is in seconds.
 */

import { describe, test, expect } from "vitest";
import { Quality } from "mediabunny";
import { conversionOptions } from "@/lib/video/convert";
import { planVideo, type VideoPrefs } from "@/lib/video/plan";
import type { VideoProbe } from "@/lib/video/probe";

const probe: VideoProbe = {
  size: 20 * 1024 * 1024,
  container: "mov",
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
};

const plan = (over: Partial<VideoProbe> = {}, prefs: Partial<VideoPrefs> = {}) =>
  planVideo({ ...probe, ...over }, { quality: "auto", maxBytes: 1e9, ...prefs }, { avc: true, aac: true });

describe("conversionOptions", () => {
  test("remux: video untouched, AAC copied, primary tracks only", () => {
    const p = plan();
    expect(p.mode).toBe("remux");
    expect(conversionOptions(p)).toEqual({ tracks: "primary", video: {}, audio: { codec: "aac" }, trim: undefined });
  });

  test("transcode: the H.264 target, rotation baked into the pixels", () => {
    const p = plan({ videoCodec: "hevc", videoCodecString: "hvc1.1.6.L120.90", fps: 120 }, { quality: 720, rotate: 90, trim: { startMs: 1_500, endMs: 9_000 } });
    const options = conversionOptions(p);

    expect(options.video).toMatchObject({
      codec: "avc",
      width: 720,
      height: 1280,
      fit: "contain",
      rotate: 90,
      frameRate: 60,
      keyFrameInterval: 2,
      hardwareAcceleration: "prefer-hardware",
      allowTransformationMetadata: false,
      forceTranscode: true,
    });
    expect((options.video as { quality: unknown }).quality).toBeInstanceOf(Quality);
    expect(options.trim).toEqual({ start: 1.5, end: 9 });
    expect(options.audio).toEqual({ codec: "aac" });
  });

  test("transcode with a crop, without hardware, with a codec override", () => {
    const p = plan({}, { crop: { left: 420, top: 0, width: 1080, height: 1080 } });
    const options = conversionOptions(p, { hardwareAcceleration: "no-preference", videoCodec: "vp9" });
    expect(options.video).toMatchObject({
      codec: "vp9",
      crop: { left: 420, top: 0, width: 1080, height: 1080 },
      width: 1080,
      height: 1080,
      hardwareAcceleration: "no-preference",
    });
    expect((options.video as { flip?: boolean }).flip).toBeUndefined();
  });

  test("a mirror is passed on after the rotation, with the crop in the mirrored frame", () => {
    const p = plan({}, { rotate: 90, flip: true, crop: { left: 0, top: 420, width: 1080, height: 1080 } });
    expect(p.flip).toBe(true);
    expect(conversionOptions(p).video).toMatchObject({ rotate: 90, flip: true, crop: { left: 0, top: 420, width: 1080, height: 1080 } });
  });

  test("audio re-encoded to 128 kbps stereo 48 kHz AAC", () => {
    const options = conversionOptions(plan({ audioCodec: "opus", container: "webm" }));
    expect(options.audio).toMatchObject({ codec: "aac", numberOfChannels: 2, sampleRate: 48_000, forceTranscode: true });
    expect((options.audio as { quality: unknown }).quality).toBeInstanceOf(Quality);
  });

  test("muted: the audio is discarded", () => {
    expect(conversionOptions(plan({}, { mute: true })).audio).toEqual({ discard: true });
  });
});
