/**
 * The editor's video export without the GPU: frames from a source (here decoded from it, as the
 * export decodes them before drawing), encoded into an MP4 that carries the source's audio over the
 * trimmed range as AAC, with the cover taken at the chosen moment. The source is made in the test:
 * two seconds of one colour per frame and a sine tone.
 *
 * Chromium as Playwright ships it may have no H.264 encoder; then the frames are encoded as VP9
 * (the test hook) so the audio, the trim and the cover are still checked end to end.
 */
import { describe, test, expect, beforeAll } from "vitest";
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Output,
  Quality,
  WebMOutputFormat,
  canEncode,
} from "mediabunny";
import { composeVideo, type ComposeFrame } from "../../src/finalRender/composeVideo";

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 10;
const DURATION = 2;
const SAMPLE_RATE = 48_000;

const hueAt = (frame: number) => Math.round((frame / (DURATION * FPS)) * 300);

/** Frame i is one flat colour (hue i / 20 × 300); the audio is a 440 Hz sine. */
async function makeSource(withAudio = true): Promise<Blob> {
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d")!;
  const video = new CanvasSource(canvas, { codec: "vp9", quality: new Quality({ bitrate: 400_000 }) });
  output.addVideoTrack(video, { frameRate: FPS });
  const audio = withAudio ? new AudioSampleSource({ codec: "opus", quality: new Quality({ bitrate: 64_000 }) }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  const frames = DURATION * FPS;
  for (let i = 0; i < frames; i++) {
    ctx.fillStyle = `hsl(${hueAt(i)} 80% 50%)`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    await video.add(i / FPS, 1 / FPS);
  }
  if (audio) {
    for (let second = 0; second < DURATION; second++) {
      const data = new Float32Array(SAMPLE_RATE * 2);
      for (let i = 0; i < SAMPLE_RATE; i++) {
        const v = 0.2 * Math.sin((2 * Math.PI * 440 * (second * SAMPLE_RATE + i)) / SAMPLE_RATE);
        data[i * 2] = v;
        data[i * 2 + 1] = v;
      }
      const sample = new AudioSample({ data, format: "f32", numberOfChannels: 2, sampleRate: SAMPLE_RATE, timestamp: second });
      await audio.add(sample);
      sample.close();
    }
  }
  await output.finalize();
  return new Blob([output.target.buffer!], { type: "video/webm" });
}

/** The source's frames over [start, end) seconds, timed from `start`, as the export hands them over. */
async function* framesOf(source: Blob, start: number, end: number): AsyncGenerator<ComposeFrame> {
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    const sink = new CanvasSink(track, { width: WIDTH, height: HEIGHT, fit: "fill", poolSize: 2 });
    for await (const { canvas, timestamp, duration } of sink.canvases(start, end)) {
      yield { image: canvas, timestamp: Math.max(0, timestamp - start), duration };
    }
  } finally {
    input.dispose();
  }
}

async function describeOutput(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
      format: await input.getFormat(),
      videoCodec: await video?.getCodec(),
      width: await video?.getDisplayWidth(),
      height: await video?.getDisplayHeight(),
      audioCodec: audio ? await audio.getCodec() : null,
      videoDuration: video ? await video.computeDuration() : 0,
      audioDuration: audio ? await audio.computeDuration() : 0,
    };
  } finally {
    input.dispose();
  }
}

/** Hue (0..360) of the pixel at the middle of an image. */
async function middleHue(blob: Blob): Promise<number> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const [r, g, b] = ctx.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data;
  bitmap.close();
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

let source: Blob;
let videoCodec: "avc" | "vp9";

beforeAll(async () => {
  source = await makeSource();
  videoCodec = (await canEncode("avc")) ? "avc" : "vp9";
  console.info(`[composeVideo] encoding ${videoCodec === "avc" ? "H.264" : "VP9 (no H.264 encoder in this browser)"}`);
}, 60_000);

describe("composeVideo", () => {
  test("carries the source's audio over the trimmed range as AAC, with the cover at the chosen moment", async () => {
    const start = 0.5;
    const end = 1.5;
    const coverAt = 0.6;
    const progress: number[] = [];

    const result = await composeVideo({
      frames: framesOf(source, start, end),
      width: WIDTH,
      height: HEIGHT,
      duration: end - start,
      bitrate: 500_000,
      frameRate: FPS,
      keyFrameInterval: 0.5,
      audio: { source, start, end },
      coverAt,
      videoCodec,
      onProgress: (f) => progress.push(f),
    });

    expect(result.hasSound).toBe(true);
    expect(result.blob.type).toBe("video/mp4");
    const out = await describeOutput(result.blob);
    expect(out.videoCodec).toBe(videoCodec);
    expect([out.width, out.height]).toEqual([WIDTH, HEIGHT]);
    expect(out.audioCodec).toBe("aac");
    expect(out.videoDuration).toBeGreaterThan(0.9);
    expect(out.videoDuration).toBeLessThan(1.1);
    expect(out.audioDuration).toBeGreaterThan(0.9);
    expect(out.audioDuration).toBeLessThan(1.15);

    // The cover is the source's frame at start + coverAt (frame 11), not the first one kept (frame 5).
    expect(result.thumb).toBeDefined();
    expect(result.thumb!.size).toEqual({ width: WIDTH, height: HEIGHT });
    const hue = await middleHue(result.thumb!.blob);
    expect(hueDistance(hue, hueAt(11))).toBeLessThan(12);
    expect(hueDistance(hue, hueAt(5))).toBeGreaterThan(40);

    expect(progress.at(-1)).toBe(1);
    expect(progress.every((f, i) => i === 0 || f >= progress[i - 1])).toBe(true);
  }, 60_000);

  test("muted: no audio track and no sound", async () => {
    const result = await composeVideo({
      frames: framesOf(source, 0, 1),
      width: WIDTH,
      height: HEIGHT,
      duration: 1,
      bitrate: 500_000,
      frameRate: FPS,
      audio: null,
      videoCodec,
    });
    expect(result.hasSound).toBe(false);
    const out = await describeOutput(result.blob);
    expect(out.audioCodec).toBeNull();
    expect(out.videoDuration).toBeGreaterThan(0.9);
  }, 60_000);

  test("a source without audio gives a silent video", async () => {
    const silent = await makeSource(false);
    const result = await composeVideo({
      frames: framesOf(silent, 0, 1),
      width: WIDTH,
      height: HEIGHT,
      duration: 1,
      bitrate: 500_000,
      frameRate: FPS,
      audio: { source: silent, start: 0, end: 1 },
      videoCodec,
    });
    expect(result.hasSound).toBe(false);
    expect((await describeOutput(result.blob)).audioCodec).toBeNull();
  }, 60_000);

  test("a cancel stops it with an AbortError", async () => {
    const controller = new AbortController();
    async function* slowFrames(): AsyncGenerator<ComposeFrame> {
      let n = 0;
      for await (const frame of framesOf(source, 0, 2)) {
        if (++n === 4) controller.abort();
        yield frame;
      }
    }
    const run = composeVideo({
      frames: slowFrames(),
      width: WIDTH,
      height: HEIGHT,
      duration: 2,
      bitrate: 500_000,
      frameRate: FPS,
      audio: { source, start: 0, end: 2 },
      signal: controller.signal,
      videoCodec,
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  }, 60_000);
});
