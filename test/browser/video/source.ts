/**
 * Synthetic videos made in the test with mediabunny: a moving square on a cycling hue, and a sine
 * tone. Chromium as Playwright ships it decodes VP9/Opus but not H.264, so the default source is a
 * WebM; an H.264 MP4 is made only where the browser can encode one.
 */

import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny";

export interface SourceOptions {
  durationSec?: number;
  fps?: number;
  width?: number;
  height?: number;
  video?: VideoCodec | null;
  audio?: AudioCodec | null;
  container?: "webm" | "mp4";
}

const SAMPLE_RATE = 48_000;

export async function makeSource({
  durationSec = 10,
  fps = 10,
  width = 320,
  height = 180,
  video = "vp9",
  audio = "opus",
  container = "webm",
}: SourceOptions = {}): Promise<Blob> {
  const output = new Output({
    format: container === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const videoSource = video ? new CanvasSource(canvas, { codec: video, quality: new Quality({ bitrate: 400_000 }) }) : null;
  if (videoSource) output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audio ? new AudioSampleSource({ codec: audio, quality: new Quality({ bitrate: 64_000 }) }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();

  if (videoSource) {
    const frames = Math.round(durationSec * fps);
    for (let i = 0; i < frames; i++) {
      ctx.fillStyle = `hsl(${Math.round((i / frames) * 300)} 80% 50%)`;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#fff";
      ctx.fillRect((i * 7) % (width - 40), height / 2 - 20, 40, 40);
      await videoSource.add(i / fps, 1 / fps);
    }
  }

  if (audioSource) {
    for (let second = 0; second < durationSec; second++) {
      const data = new Float32Array(SAMPLE_RATE * 2);
      for (let i = 0; i < SAMPLE_RATE; i++) {
        const v = 0.2 * Math.sin((2 * Math.PI * 440 * (second * SAMPLE_RATE + i)) / SAMPLE_RATE);
        data[i * 2] = v;
        data[i * 2 + 1] = v;
      }
      const sample = new AudioSample({ data, format: "f32", numberOfChannels: 2, sampleRate: SAMPLE_RATE, timestamp: second });
      await audioSource.add(sample);
      sample.close();
    }
  }

  await output.finalize();
  return new Blob([output.target.buffer!], { type: container === "webm" ? "video/webm" : "video/mp4" });
}
