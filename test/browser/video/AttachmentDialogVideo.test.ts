/**
 * The attach window's controls for a video, in a real browser: the quality (the rungs the source
 * reaches, plus Auto and Original), sound, "Send as file", the length and expected size, the reason
 * a video goes as a file, and the edit button that is off — with the reason — where the editor cannot
 * run. Nothing is compressed before Send: a real video added through the composer is probed, given
 * its poster and planned, and no preparation starts.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { effectScope, nextTick, reactive } from "vue";
import { userEvent } from "vitest/browser";
import { useAttachmentUpload, type PendingAttachment, type PendingVideo } from "@/composables/useAttachmentUpload";
import { makeSource } from "./source";

const h = vi.hoisted(() => ({
  caps: { gpu: false, videoEncode: true, audioEncode: true },
  prepare: vi.fn(),
}));

// The real library (probe, poster, plan); only the preparation is watched.
vi.mock("@/lib/video", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/video")>()), prepareWithinLimit: h.prepare }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ channelInteraction: { GetUploadLimits: async () => ({ attachmentMaxBytes: 0n, videoMaxBytes: 0n, videoMaxDurationMs: 0n }) }, userChatInteractions: {} }),
}));

vi.mock("@/store/system/localeStore", () => ({
  useLocale: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}));
// The caption composer is its own world (stores, api); the dialog only asks it for its text.
vi.mock("@/components/chats/EnterText.vue", async () => {
  const { defineComponent, h: render } = await import("vue");
  return {
    default: defineComponent({
      name: "EnterText",
      setup(_, { expose }) {
        expose({ clear() {}, focus() {}, getParsedContent: () => ({ text: "", entities: [] }) });
        return () => render("div", { "data-testid": "caption" });
      },
    }),
  };
});
vi.mock("@argon/media-editor", async () => {
  const actual = await vi.importActual<typeof import("@argon/media-editor")>("@argon/media-editor");
  return { ...actual, checkCapabilities: async () => h.caps };
});

import AttachmentDialog from "@/components/chats/AttachmentDialog.vue";

const PROBE = {
  size: 30_000_000,
  container: "mp4",
  width: 1920,
  height: 1080,
  rotation: 0,
  durationMs: 75_000,
  fps: 30,
  videoCodec: "hevc",
  videoCodecString: "hvc1.1.6.L120.90",
  audioCodec: "aac",
  hasAudio: true,
  canDecodeVideo: true,
  canDecodeAudio: true,
  bitrate: 8_000_000,
  audioBitrate: 128_000,
  fastStart: true,
  videoTrackCount: 1,
  audioTrackCount: 1,
  pixelAspectRatio: 1,
  headerDurationMs: 75_000,
};

const PLAN = {
  mode: "transcode",
  reason: null,
  width: 1280,
  height: 720,
  durationMs: 75_000,
  video: { codec: "avc", width: 1280, height: 720, bitrate: 2_600_000, keyFrameIntervalSec: 2, frameRate: null },
  audio: "copy",
  audioBitrate: 128_000,
  trim: null,
  crop: null,
  rotate: 0,
  flip: false,
  sourceBytes: 30_000_000,
  maxBytes: 100 * 1024 * 1024,
  estimatedBytes: 26_000_000,
  downscaledToFit: false,
};

function poster(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#3a7";
  ctx.fillRect(0, 0, 160, 90);
  return canvas.toDataURL("image/png");
}

function videoEntry(video: Partial<PendingVideo> = {}, probe: Partial<typeof PROBE> = {}): PendingAttachment {
  const file = new File([new Uint8Array(1024)], "clip.mp4", { type: "video/mp4" });
  const p = { ...PROBE, ...probe };
  return {
    file,
    previewUrl: poster(),
    thumbHash: null,
    width: 1280,
    height: 720,
    progress: 0,
    status: "pending",
    video: {
      probe: p,
      plan: { ...PLAN },
      prefs: { quality: "auto", mute: false, sendAsFile: false },
      prepared: null,
      preparing: null,
      poster: null,
      storyboard: null,
      error: null,
      fileReason: null,
      paused: false,
      source: file,
      sourceProbe: p,
      editorState: null,
      ...video,
    } as PendingVideo,
  };
}

let wrapper: VueWrapper | null = null;

async function open(files: PendingAttachment[]) {
  wrapper = mount(AttachmentDialog, { props: { files: reactive(files), open: true }, attachTo: document.body });
  await flushPromises();
  await nextTick();
  return wrapper;
}

const $ = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);

beforeEach(() => {
  h.caps = { gpu: false, videoEncode: true, audioEncode: true };
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("a video in the attach window", () => {
  test("shows its poster, its length and its expected size", async () => {
    await open([videoEntry()]);

    expect($("attachment-video-preview")?.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png/);
    expect($("video-duration")?.textContent).toBe("1:15");
    expect($("video-size")?.textContent).toContain("video_send_estimated_size");
    expect($("video-options")).not.toBeNull();
  });

  test("the quality lists Auto, the rungs the source reaches and Original; a pick changes this video only", async () => {
    const w = await open([videoEntry({}, { width: 854, height: 480 })]);

    await userEvent.click($("video-quality")!);
    await nextTick();
    const values = [...document.querySelectorAll<HTMLElement>('[data-testid^="video-quality-"]')].map((el) => el.dataset.testid);
    expect(values).toEqual(["video-quality-auto", "video-quality-360", "video-quality-480", "video-quality-original"]);

    await userEvent.click($("video-quality-360")!);
    await flushPromises();
    expect(w.emitted("video-prefs")).toEqual([[0, { quality: 360 }]]);
  });

  test("sound can be turned off, and a silent video offers no such button", async () => {
    const w = await open([videoEntry()]);
    const mute = $<HTMLButtonElement>("video-mute")!;
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(mute);
    expect(w.emitted("video-prefs")).toEqual([[0, { mute: true }]]);
    w.unmount();
    document.body.innerHTML = "";

    await open([videoEntry({}, { hasAudio: false, audioCodec: null as never })]);
    expect($("video-mute")).toBeNull();
  });

  test("“Send as file” toggles; a video that cannot be a video has it locked on and says why", async () => {
    const w = await open([videoEntry()]);
    await userEvent.click($("video-send-as-file")!);
    expect(w.emitted("video-prefs")).toEqual([[0, { sendAsFile: true }]]);
    w.unmount();
    document.body.innerHTML = "";

    await open([videoEntry({ fileReason: "no-encoder", prefs: { quality: "auto", mute: false, sendAsFile: true } })]);
    const toggle = $<HTMLButtonElement>("video-send-as-file")!;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect($("video-reason")?.textContent?.trim()).toMatch(/^video_send_reason_no_encoder/);
    // Its size is the file's own: nothing is compressed.
    expect($("video-size")?.textContent).toBe("1.0 KB");
  });

  test("a video longer than the target takes says so, with the target's own limit", async () => {
    await open([
      videoEntry({
        fileReason: "too-long",
        prefs: { quality: "auto", mute: false, sendAsFile: true },
        limits: { maxBytes: 2 * 1024 ** 3, maxDurationMs: 3_600_000 },
      }),
    ]);
    expect($<HTMLButtonElement>("video-send-as-file")!.disabled).toBe(true);
    expect($("video-reason")?.textContent?.trim()).toBe('video_send_reason_too_long:{"limit":"2 GB","duration":"1:00:00"}');
  });

  test("a video planned a rung lower to fit says at what height", async () => {
    await open([videoEntry({ plan: { ...PLAN, width: 854, height: 480, downscaledToFit: true } as PendingVideo["plan"] })]);
    expect($("video-reason")?.textContent?.trim()).toBe('video_send_downscaled:{"height":480}');
  });

  test("no compression before Send: a real video added is probed, given its poster and planned, and nothing more", async () => {
    const scope = effectScope();
    const attachments = scope.run(() => useAttachmentUpload())!;
    const source = await makeSource({ durationSec: 3 });
    await attachments.addFiles([new File([source], "clip.webm", { type: "video/webm" })]);
    const entry = attachments.pendingFiles.value[0];
    await vi.waitFor(() => expect(entry.video?.plan).toBeTruthy(), { timeout: 10_000 });

    const w = mount(AttachmentDialog, { props: { files: attachments.pendingFiles.value, open: true }, attachTo: document.body });
    wrapper = w;
    await flushPromises();

    expect(entry.video?.probe).toMatchObject({ container: "webm", width: 320, height: 180 });
    expect(entry.thumbHash).toBeTruthy();
    expect($("attachment-video-preview")?.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);
    expect($("video-duration")?.textContent).toBe("0:03");
    expect($("video-size")?.textContent).toContain("video_send_estimated_size");
    // Nothing compresses, and nothing offers to: no progress, no stop.
    await userEvent.click($("video-mute")!);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.prepare).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid*="progress"], [data-testid*="prepare"]')).toBeNull();
    scope.stop();
  }, 30_000);

  test("edit is off, with the reason, without WebGPU or over 100 MB; on otherwise", async () => {
    await open([videoEntry()]);
    await vi.waitFor(() => expect($<HTMLButtonElement>("video-edit")?.title).toBe("video_send_edit_no_gpu"));
    expect($<HTMLButtonElement>("video-edit")!.disabled).toBe(true);
    wrapper!.unmount();
    document.body.innerHTML = "";

    h.caps = { gpu: true, videoEncode: true, audioEncode: true };
    const big = videoEntry();
    big.video!.source = new File([new Uint8Array(1)], "big.mp4", { type: "video/mp4" });
    Object.defineProperty(big.video!.source, "size", { value: 120 * 1024 * 1024 });
    await open([big]);
    await vi.waitFor(() => expect($<HTMLButtonElement>("video-edit")?.title).toBe("video_send_edit_too_large"));
    wrapper!.unmount();
    document.body.innerHTML = "";

    const w = await open([videoEntry()]);
    await vi.waitFor(() => expect($<HTMLButtonElement>("video-edit")?.disabled).toBe(false));
    await userEvent.click($("video-edit")!);
    const [index, src, type] = w.emitted("open-editor")![0] as [number, string, string];
    expect([index, type]).toEqual([0, "video"]);
    expect(src).toMatch(/^blob:/);
    URL.revokeObjectURL(src);
  });

  test("in a batch with a picture, each keeps its own preview and the video's controls show for the video only", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 10;
    canvas.height = 10;
    const image: PendingAttachment = {
      file: new File([new Uint8Array(4)], "a.png", { type: "image/png" }),
      previewUrl: canvas.toDataURL(),
      thumbHash: null,
      width: 10,
      height: 10,
      progress: 0,
      status: "pending",
    };
    await open([image, videoEntry()]);

    expect($("video-options")).toBeNull();
    expect(document.querySelectorAll(".strip-thumb img")).toHaveLength(2);
    await userEvent.click(document.querySelectorAll<HTMLElement>(".strip-thumb")[1]);
    expect($("video-options")).not.toBeNull();
  });
});
