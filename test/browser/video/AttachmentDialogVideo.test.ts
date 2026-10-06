/**
 * The attach window for a video, in a real browser. The media is the stage and the decisions sit on
 * it as chips: the length, the quality (a popover of the rungs the source reaches with each one's
 * expected size, plus Auto and Original), sound, edit (off, with the reason, where the editor cannot
 * run) and the expected size, which turns amber and names the problem when the video cannot go as
 * asked. "Send as file" lives in the ⋮ menu. The video plays on the stage from the picked file.
 * Nothing is compressed before Send: a real video added through the composer is probed, given its
 * poster and planned, and no preparation starts.
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
      poster: null,
      error: null,
      fileReason: null,
      source: file,
      sourceProbe: p,
      editorState: null,
      ...video,
    } as PendingVideo,
  };
}

function imageEntry(name = "a.png"): PendingAttachment {
  const canvas = document.createElement("canvas");
  canvas.width = 10;
  canvas.height = 10;
  return {
    file: new File([new Uint8Array(4)], name, { type: "image/png" }),
    previewUrl: canvas.toDataURL(),
    thumbHash: null,
    width: 10,
    height: 10,
    progress: 0,
    status: "pending",
  };
}

let wrapper: VueWrapper | null = null;

async function open(files: PendingAttachment[]) {
  wrapper = mount(AttachmentDialog, { props: { files: reactive(files), open: true }, attachTo: document.body });
  await flushPromises();
  await nextTick();
  return wrapper;
}

function close() {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
}

const $ = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);

async function openMenu() {
  await userEvent.click($("attach-menu")!);
  await vi.waitFor(() => expect($("attach-add-files")).not.toBeNull());
}

/** The tooltip a hover over the element shows. */
async function tooltipOf(id: string): Promise<string> {
  await userEvent.hover($(id)!);
  let text = "";
  await vi.waitFor(() => {
    text = document.querySelector('[role="tooltip"]')?.textContent ?? "";
    expect(text).not.toBe("");
  });
  return text;
}

beforeEach(() => {
  h.caps = { gpu: false, videoEncode: true, audioEncode: true };
});

afterEach(close);

describe("a video in the attach window", () => {
  test("shows its poster on the stage, its length and its expected size; the title and the footer count it", async () => {
    await open([videoEntry()]);

    expect($("attachment-video-preview")?.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/png/);
    expect($("video-duration")?.textContent).toBe("1:15");
    expect($("video-size")?.textContent).toContain("video_send_estimated_size");
    expect($("video-options")).not.toBeNull();
    expect($("video-reason")).toBeNull();
    expect($("attach-title")?.textContent).toBe("attach_send_video");
    expect($("attach-meta")?.textContent).toMatch(/^attach_meta_videos_one:\{"count":1\} · video_send_estimated_size:/);
  });

  test("the quality lists Auto, the rungs the source reaches from the top, and Original; a pick changes this video only", async () => {
    const w = await open([videoEntry({}, { width: 854, height: 480 })]);

    await userEvent.click($("video-quality")!);
    await vi.waitFor(() => expect($("video-quality-auto")).not.toBeNull());
    const values = [...document.querySelectorAll<HTMLElement>('[data-testid^="video-quality-"]')].map((el) => el.dataset.testid);
    expect(values).toEqual(["video-quality-auto", "video-quality-480", "video-quality-360", "video-quality-original"]);
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    expect($("video-quality-auto")?.getAttribute("aria-selected")).toBe("true");
    expect($("video-quality-auto")?.textContent).toContain('attach_quality_auto:{"height":480}');

    await userEvent.click($("video-quality-360")!);
    await flushPromises();
    expect(w.emitted("video-prefs")).toEqual([[0, { quality: 360 }]]);
    await vi.waitFor(() => expect($("video-quality-auto")).toBeNull());
  });

  test("the quality popover is a listbox the keyboard drives", async () => {
    const w = await open([videoEntry()]);
    $("video-quality")!.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(document.activeElement).toBe($("video-quality-auto")));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe($("video-quality-1080"));
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await flushPromises();
    expect(w.emitted("video-prefs")).toEqual([[0, { quality: 720 }]]);
  });

  test("sound can be turned off, and a silent video offers no such button", async () => {
    const w = await open([videoEntry()]);
    const mute = $<HTMLButtonElement>("video-mute")!;
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(mute);
    expect(w.emitted("video-prefs")).toEqual([[0, { mute: true }]]);
    close();

    await open([videoEntry({}, { hasAudio: false, audioCodec: null as never })]);
    expect($("video-mute")).toBeNull();
  });

  test("“Send as file” in the ⋮ menu toggles; a video that cannot be a video has it locked on and says why", async () => {
    const w = await open([videoEntry()]);
    await openMenu();
    expect($("video-send-as-file")?.getAttribute("aria-checked")).toBe("false");
    await userEvent.click($("video-send-as-file")!);
    expect(w.emitted("video-prefs")).toEqual([[0, { sendAsFile: true }]]);
    close();

    await open([videoEntry({ fileReason: "no-encoder", prefs: { quality: "auto", mute: false, sendAsFile: true } })]);
    // Its size is the file's own, nothing is compressed; the chip names the problem, the tooltip the rest.
    expect($("video-size")?.textContent).toBe('attach_size_file:{"size":"1.0 KB"}');
    expect($("video-reason")?.textContent).toContain("video_send_short_no_encoder");
    expect(await tooltipOf("video-reason")).toMatch(/^video_send_reason_no_encoder/);
    // Nothing on the stage offers what cannot apply to a file.
    expect($("video-quality")).toBeNull();
    expect($("video-mute")).toBeNull();
    expect($("attach-title")?.textContent).toBe("attach_send_file");

    await openMenu();
    const toggle = $("video-send-as-file")!;
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  test("a video longer than the target takes says so, with the target's own limit", async () => {
    await open([
      videoEntry({
        fileReason: "too-long",
        prefs: { quality: "auto", mute: false, sendAsFile: true },
        limits: { maxBytes: 2 * 1024 ** 3, maxDurationMs: 3_600_000 },
      }),
    ]);
    const params = '{"limit":"2 GB","duration":"1:00:00"}';
    expect($("video-reason")?.textContent).toContain(`video_send_short_too_long:${params}`);
    expect($("video-reason")?.textContent).toContain(`video_send_reason_too_long:${params}`);
    await openMenu();
    expect($("video-send-as-file")?.getAttribute("aria-disabled")).toBe("true");
  });

  test("a video planned a rung lower to fit says at what height, and its chip shows the height that goes out", async () => {
    await open([videoEntry({ plan: { ...PLAN, width: 854, height: 480, downscaledToFit: true } as PendingVideo["plan"] })]);
    expect($("video-reason")?.textContent).toContain('video_send_short_downscaled:{"height":480}');
    expect($("video-reason")?.textContent).toContain('video_send_downscaled:{"height":480}');
    expect($("video-quality")?.textContent).toContain('video_send_quality_rung:{"height":480}');
  });

  test("Original that cannot play keeps the quality chip, so a lower quality can be picked back", async () => {
    await open([videoEntry({ fileReason: "user-original", prefs: { quality: "original", mute: false, sendAsFile: true } })]);
    expect($("video-quality")?.textContent).toContain("video_send_quality_original");
    expect($("video-reason")?.textContent).toContain("video_send_short_original");
  });

  test("no compression before Send: a real video added is probed, given its poster and planned — and plays on the stage", async () => {
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

    // Muted, looping, from a URL of the picked file; the poster stays under it until it plays.
    const player = $<HTMLVideoElement>("attachment-video-player")!;
    expect(player.muted).toBe(true);
    expect(player.src).toMatch(/^blob:/);
    await vi.waitFor(() => expect($("attachment-video-timeline")).not.toBeNull(), { timeout: 10_000 });
    expect(player.classList.contains("is-visible")).toBe(true);
    // A click on the stage pauses it, and the play glyph comes back.
    await userEvent.click($("attachment-video-toggle")!);
    await vi.waitFor(() => expect(player.paused).toBe(true));
    expect($("attachment-video-toggle")?.getAttribute("aria-label")).toBe("video_player_play");

    // Nothing compresses, and nothing offers to: no progress, no stop.
    await userEvent.click($("video-mute")!);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.prepare).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid*="progress"], [data-testid*="prepare"]')).toBeNull();
    scope.stop();
  }, 30_000);

  test("edit is off, with the reason, without WebGPU or over 100 MB; on otherwise", async () => {
    await open([videoEntry()]);
    await vi.waitFor(() => expect($("video-edit")?.getAttribute("aria-disabled")).toBe("true"));
    await vi.waitFor(async () => expect(await tooltipOf("video-edit")).toBe("video_send_edit_no_gpu"));
    // Still focusable and hoverable for its reason; a click does nothing.
    $("video-edit")!.click();
    expect(wrapper!.emitted("open-editor")).toBeUndefined();
    close();

    h.caps = { gpu: true, videoEncode: true, audioEncode: true };
    const big = videoEntry();
    big.video!.source = new File([new Uint8Array(1)], "big.mp4", { type: "video/mp4" });
    Object.defineProperty(big.video!.source, "size", { value: 120 * 1024 * 1024 });
    await open([big]);
    await vi.waitFor(async () => expect(await tooltipOf("video-edit")).toBe("video_send_edit_too_large"));
    close();

    const w = await open([videoEntry()]);
    await vi.waitFor(() => expect($("video-edit")?.getAttribute("aria-disabled")).toBeNull());
    await userEvent.click($("video-edit")!);
    const [index, src, type] = w.emitted("open-editor")![0] as [number, string, string];
    expect([index, type]).toEqual([0, "video"]);
    expect(src).toMatch(/^blob:/);
    URL.revokeObjectURL(src);
  });
});

describe("a batch in the attach window", () => {
  test("each keeps its own preview and the video's chips show for the video only", async () => {
    await open([imageEntry(), videoEntry()]);

    expect($("video-options")).toBeNull();
    expect($("image-edit")).not.toBeNull();
    expect(document.querySelectorAll(".strip-thumb img")).toHaveLength(2);
    expect($("attach-title")?.textContent).toBe('attach_send_files_other:{"count":2}');
    expect($("attach-meta")?.textContent).toMatch(/^attach_meta_files_other:\{"count":2\} · /);
    await userEvent.click(document.querySelectorAll<HTMLElement>(".strip-thumb")[1]);
    expect($("video-options")).not.toBeNull();
  });

  test("the strip is a listbox: ←/→ move the selection, Delete removes the focused file", async () => {
    const w = await open([imageEntry("a.png"), videoEntry(), imageEntry("c.png")]);
    const tiles = () => [...document.querySelectorAll<HTMLElement>(".strip-thumb")];
    expect(tiles().map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tiles().map((t) => t.tabIndex)).toEqual([0, -1, -1]);

    tiles()[0].focus();
    await userEvent.keyboard("{ArrowRight}");
    await nextTick();
    expect(tiles()[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tiles()[1]);
    expect($("video-options")).not.toBeNull();

    await userEvent.keyboard("{Delete}");
    expect(w.emitted("remove")).toEqual([[1]]);
  });

  test("with several videos the menu sends all of them as files at once", async () => {
    const w = await open([videoEntry(), imageEntry(), videoEntry()]);
    await openMenu();
    const toggle = $("video-send-as-file")!;
    expect(toggle.textContent).toContain("attach_send_all_as_files");
    await userEvent.click(toggle);
    expect(w.emitted("video-prefs")).toEqual([
      [0, { sendAsFile: true }],
      [2, { sendAsFile: true }],
    ]);
  });

  test("“Add files…” is in the menu, and the strip ends with a tile for it", async () => {
    const w = await open([imageEntry(), imageEntry("b.png")]);
    await userEvent.click($("attach-strip-add")!);
    await openMenu();
    await userEvent.click($("attach-add-files")!);
    expect(w.emitted("add-more")).toHaveLength(2);
  });
});
