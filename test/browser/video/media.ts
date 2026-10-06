/**
 * Real media for the video tests, made in the page: a WebM (VP9, VP8 where VP9 cannot be encoded)
 * drawn frame by frame on a canvas and muxed by mediabunny, and a storyboard sprite.
 */
import { BufferTarget, CanvasSource, Output, Quality, WebMOutputFormat, canEncodeVideo } from "mediabunny";

export async function makeWebm({ seconds = 12, fps = 10, width = 160, height = 90 } = {}): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const codec = (await canEncodeVideo("vp9", { width, height })) ? "vp9" : "vp8";
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec, quality: new Quality("low"), keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  const frames = seconds * fps;
  for (let i = 0; i < frames; i++) {
    ctx.fillStyle = `hsl(${Math.round((i * 360) / frames)} 80% 50%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.fillRect((i * 7) % width, height / 2 - 4, 8, 8);
    await source.add(i / fps, 1 / fps);
  }
  await output.finalize();
  return URL.createObjectURL(new Blob([output.target.buffer!], { type: "video/webm" }));
}

/** A 2 × 2 sprite of 16 × 9 frames: red, green, blue, yellow. */
export function makeSprite(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 18;
  const ctx = canvas.getContext("2d")!;
  const colours = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
  colours.forEach((colour, i) => {
    ctx.fillStyle = colour;
    ctx.fillRect((i % 2) * 16, Math.floor(i / 2) * 9, 16, 9);
  });
  return canvas.toDataURL("image/png");
}

/** Polls on animation frames (timers may be faked), up to `timeout` ms. */
export async function until(check: () => boolean, timeout = 10_000, what = "condition"): Promise<void> {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}
