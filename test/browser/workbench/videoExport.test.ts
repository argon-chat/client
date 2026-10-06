/**
 * The editor's video export through the real pipeline on the GPU: frames decoded from the source,
 * drawn with the edits, encoded at the source's own rate (no frame made up), with the source's audio
 * over the trimmed range as AAC (none when muted), the cover from the chosen moment, a cancel that
 * stops it — and the summary that tells the composer when no frame needs rendering at all.
 *
 * Headless Chromium exposes navigator.gpu but no adapter, so these skip there; run them with the
 * machine's GPU with `ARGON_TEST_GPU=1 bunx vitest run --project browser test/browser/workbench`.
 */

import { describe, test, expect, beforeAll, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { createFinalResult, useMediaEditorStore, type MediaEditorFinalResult } from "@argon/media-editor";
import { makeSource } from "../video/source";

const adapter = typeof navigator !== "undefined" && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const REASON = "no WebGPU adapter in this Chromium (headless has none; set ARGON_TEST_GPU=1)";

const FPS = 10;
let source: Blob;
let src: string;
let video: HTMLVideoElement;

async function loaded(url: string): Promise<HTMLVideoElement> {
  const el = document.createElement("video");
  el.muted = true;
  el.preload = "auto";
  el.src = url;
  await new Promise<void>((resolve) => el.addEventListener("loadeddata", () => resolve(), { once: true }));
  return el;
}

async function finalResult(edit: (store: ReturnType<typeof useMediaEditorStore>) => void): Promise<MediaEditorFinalResult> {
  const store = useMediaEditorStore();
  store.init({ src, type: "video" });
  const ratio = video.videoWidth / video.videoHeight;
  store.mediaState.currentImageRatio = ratio;
  store.uiState.mediaSize = [video.videoWidth, video.videoHeight];
  edit(store);
  return createFinalResult({
    mediaSrc: src,
    mediaType: "video",
    mediaState: store.mediaState,
    canvasSize: [800, 600],
    mediaRatio: ratio,
    renderingPayload: { media: { width: video.videoWidth, height: video.videoHeight, video } },
    getMediaBlob: async () => source,
  });
}

async function describeOutput(blob: Blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const v = (await input.getPrimaryVideoTrack())!;
    const a = await input.getPrimaryAudioTrack();
    const stats = await v.computePacketStats();
    return {
      videoCodec: await v.getCodec(),
      audioCodec: a ? await a.getCodec() : null,
      duration: await v.computeDuration(),
      packets: stats.packetCount,
    };
  } finally {
    input.dispose();
  }
}

describe.skipIf(!adapter)(`video export on the GPU${adapter ? "" : ` — skipped: ${REASON}`}`, () => {
  beforeAll(async () => {
    source = await makeSource({ durationSec: 3, fps: FPS });
    src = URL.createObjectURL(source);
    video = await loaded(src);
  }, 60_000);

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("a painted, trimmed clip keeps its audio as AAC, its own frame rate and the chosen cover", async () => {
    const result = await finalResult((store) => {
      store.mediaState.videoCropStart = 1 / 3;
      store.mediaState.videoCropLength = 1 / 3;
      store.mediaState.videoThumbnailPosition = 0.5;
      store.mediaState.adjustments.brightness = 0.2;
    });
    expect(result.videoEdit).toMatchObject({ pixelEdits: true, quality: null });
    expect(result.videoEdit!.duration).toBeCloseTo(3, 1);

    const payload = await result.getResult();
    expect(result.creationProgress!.value).toBe(1);
    expect(payload.hasSound).toBe(true);
    expect(payload.thumb?.blob.size).toBeGreaterThan(0);

    const out = await describeOutput(payload.blob);
    expect(["avc", "vp9"]).toContain(out.videoCodec);
    expect(out.audioCodec).toBe("aac");
    expect(out.duration).toBeGreaterThan(0.9);
    expect(out.duration).toBeLessThan(1.15);
    // A 10 fps source stays 10 fps: one second, ten frames, none made up.
    expect(out.packets).toBeGreaterThanOrEqual(9);
    expect(out.packets).toBeLessThanOrEqual(11);
  }, 60_000);

  test("muted: no audio track", async () => {
    const result = await finalResult((store) => {
      store.mediaState.videoCropLength = 1 / 3;
      store.mediaState.videoMuted = true;
      store.mediaState.adjustments.contrast = 0.3;
    });
    const payload = await result.getResult();
    expect(payload.hasSound).toBe(false);
    expect((await describeOutput(payload.blob)).audioCodec).toBeNull();
  }, 60_000);

  test("a cancel stops the render", async () => {
    const result = await finalResult((store) => {
      store.mediaState.adjustments.saturation = 0.5;
    });
    const running = result.getResult();
    result.cancel!();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  }, 60_000);

  test("a quarter turn alone needs no render: the summary says how to cut the source", async () => {
    const result = await finalResult((store) => {
      store.mediaState.rotation = Math.PI / 2;
      store.mediaState.currentImageRatio = video.videoHeight / video.videoWidth;
    });
    expect(result.videoEdit?.pixelEdits).toBe(false);
    expect(result.videoEdit?.transform).toMatchObject({ rotate: 90, flip: false });
    expect(result.preview?.size).toBeGreaterThan(0);
    result.cancel!();
  }, 60_000);
});
