/**
 * The attach window as people see it, at 520 px and at a 360 px phone width, light and dark: one
 * video with sound (playing on the stage, the quality popover open in one shot), a video that cannot
 * be compressed (the amber chip over a light frame), and a batch of a picture, a video and a PDF.
 *
 * Always a smoke test of the layout: the dialog keeps its width and 16 px gutters, nothing scrolls
 * sideways, every chip stays on the stage. With VITE_ATTACH_SHOTS=1 it also saves a PNG of every case
 * under __screenshots__/ (git-ignored) for a design review; CI leaves it unset and writes nothing.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { effectScope, nextTick, reactive, type EffectScope } from "vue";
import { page, userEvent } from "vitest/browser";
import { useAttachmentUpload, type PendingAttachment, type PendingVideo } from "@/composables/useAttachmentUpload";
import { makeSource } from "./source";

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ channelInteraction: { GetUploadLimits: async () => ({ attachmentMaxBytes: 0n, videoMaxBytes: 0n, videoMaxDurationMs: 0n }) }, userChatInteractions: {} }),
}));
// Real English, so the shots read as the product does.
vi.mock("@/store/system/localeStore", async () => {
  const en = (await import("../../../packages/i18n/src/core/en.json")).default as unknown as Record<string, string>;
  const t = (key: string, params: Record<string, unknown> = {}) =>
    (en[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  return { useLocale: () => ({ t }) };
});
// The caption composer in caption mode, as it draws: a bare line with its placeholder and the emoji button.
vi.mock("@/components/chats/EnterText.vue", async () => {
  const { defineComponent, h } = await import("vue");
  const { SmileIcon } = await import("lucide-vue-next");
  return {
    default: defineComponent({
      name: "EnterText",
      setup(_, { expose }) {
        expose({ clear() {}, focus() {}, getParsedContent: () => ({ text: "", entities: [] }) });
        return () =>
          h("div", { class: "flex items-end gap-1 p-1 rounded-lg", "data-testid": "caption" }, [
            h("div", { class: "flex-1 min-w-0 min-h-9 py-1.5 px-1 text-sm leading-relaxed text-muted-foreground" }, "Add a caption"),
            h("span", { class: "flex items-center justify-center w-9 h-9 shrink-0 rounded-full text-muted-foreground" }, [h(SmileIcon, { class: "w-5 h-5" })]),
          ]);
      },
    }),
  };
});
vi.mock("@argon/media-editor", async () => {
  const actual = await vi.importActual<typeof import("@argon/media-editor")>("@argon/media-editor");
  return { ...actual, checkCapabilities: async () => ({ gpu: true, videoEncode: true, audioEncode: true }) };
});

import AttachmentDialog from "@/components/chats/AttachmentDialog.vue";

const SHOTS = !!import.meta.env.VITE_ATTACH_SHOTS;
const WIDTHS = [520, 360] as const;
const THEMES = ["light", "dark"] as const;

/** A picture to look at: a sky over a hill, light enough to test white chips on top of it. */
async function picture(width: number, height: number, light = false): Promise<{ url: string; blob: Blob }> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, light ? "#f4f8ff" : "#3b6fd8");
  sky.addColorStop(1, light ? "#ffffff" : "#f0b46b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = light ? "#e9efe6" : "#2f6b3a";
  ctx.beginPath();
  ctx.ellipse(width * 0.35, height * 1.05, width * 0.6, height * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light ? "#fffbea" : "#ffe08a";
  ctx.beginPath();
  ctx.arc(width * 0.78, height * 0.28, height * 0.09, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
  return { url: URL.createObjectURL(blob), blob };
}

let scope: EffectScope;
let realVideo: PendingAttachment;
let stuckVideo: PendingAttachment;
let photo: PendingAttachment;
let pdf: PendingAttachment;

beforeAll(async () => {
  scope = effectScope();
  const attachments = scope.run(() => useAttachmentUpload())!;
  const source = await makeSource({ durationSec: 6, width: 640, height: 360 });
  await attachments.addFiles([new File([source], "beach.webm", { type: "video/webm" })]);
  realVideo = attachments.pendingFiles.value[0];
  await vi.waitFor(() => expect(realVideo.video?.plan).toBeTruthy(), { timeout: 15_000 });

  const light = await picture(1280, 720, true);
  const file = new File([new Uint8Array(2048)], "concert.mp4", { type: "video/mp4" });
  const probe = {
    size: 3_400_000_000, container: "mp4", width: 1920, height: 1080, rotation: 0, durationMs: 5_400_000, fps: 30,
    videoCodec: "avc", videoCodecString: "avc1.640028", audioCodec: "aac", hasAudio: true, canDecodeVideo: true,
    canDecodeAudio: true, bitrate: 5_000_000, audioBitrate: 128_000, fastStart: true, videoTrackCount: 1,
    audioTrackCount: 1, pixelAspectRatio: 1, headerDurationMs: 5_400_000,
  };
  stuckVideo = {
    file,
    previewUrl: light.url,
    thumbHash: null,
    width: 1920,
    height: 1080,
    progress: 0,
    status: "pending",
    video: {
      probe,
      sourceProbe: probe,
      plan: null,
      prefs: { quality: "auto", mute: false, sendAsFile: true },
      fileReason: "too-long",
      limits: { maxBytes: 2 * 1024 ** 3, maxDurationMs: 3_600_000 },
      error: null,
      source: file,
      editorState: null,
    } as unknown as PendingVideo,
  };

  const image = await picture(1200, 800);
  photo = {
    file: new File([image.blob], "sunset.png", { type: "image/png" }),
    previewUrl: image.url,
    thumbHash: null,
    width: 1200,
    height: 800,
    progress: 0,
    status: "pending",
  };
  pdf = {
    file: new File([new Uint8Array(812_000)], "Quarterly report — final.pdf", { type: "application/pdf" }),
    previewUrl: null,
    thumbHash: null,
    width: null,
    height: null,
    progress: 0,
    status: "pending",
  };
}, 60_000);

afterAll(() => scope.stop());

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
});

const $ = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);

async function show(files: PendingAttachment[], width: number, theme: "light" | "dark") {
  await page.viewport(width === 520 ? 552 : width, 860);
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.body.style.background = "hsl(var(--background))";
  wrapper = mount(AttachmentDialog, { props: { files: reactive(files), open: true }, attachTo: document.body });
  await flushPromises();
  await nextTick();
  const dialog = $("attachment-dialog")!;
  // The open animation (zoom-in) over before anything is measured.
  await Promise.all(dialog.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
  return dialog;
}

function expectLaidOut(dialog: HTMLElement, width: number) {
  const box = dialog.getBoundingClientRect();
  expect(Math.round(box.width)).toBe(width === 520 ? 520 : 360 - 32);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expect(Math.round($("attach-title")!.parentElement!.getBoundingClientRect().height)).toBe(48);
  const stage = dialog.querySelector(".attach-stage")?.getBoundingClientRect();
  if (!stage) return;
  for (const chip of dialog.querySelectorAll<HTMLElement>(".chip")) {
    const r = chip.getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(stage.left);
    expect(r.right).toBeLessThanOrEqual(stage.right + 0.5);
    expect(r.top).toBeGreaterThanOrEqual(stage.top);
    expect(r.bottom).toBeLessThanOrEqual(stage.bottom + 0.5);
  }
}

async function shoot(name: string, element?: Element) {
  if (!SHOTS) return;
  await page.screenshot({ path: `__screenshots__/AttachmentDialog.visual/${name}.png`, ...(element ? { element } : {}) });
}

describe("the attach window, looked at", () => {
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      test(`one video with sound, ${width} px, ${theme}`, async () => {
        const dialog = await show([realVideo], width, theme);
        await vi.waitFor(() => expect($("attachment-video-timeline")).not.toBeNull(), { timeout: 10_000 });
        expectLaidOut(dialog, width);
        await shoot(`a-video-${width}-${theme}`, dialog);
        if (width === 520) {
          await userEvent.click($("video-quality")!);
          await vi.waitFor(() => expect($("video-quality-auto")).not.toBeNull());
          await new Promise((r) => setTimeout(r, 250));
          await shoot(`a-video-${width}-${theme}-quality`);
        }
      }, 30_000);

      test(`a video that cannot be compressed, ${width} px, ${theme}`, async () => {
        const dialog = await show([stuckVideo], width, theme);
        expect($("video-reason")).not.toBeNull();
        expectLaidOut(dialog, width);
        await shoot(`b-stuck-${width}-${theme}`, dialog);
      });

      test(`three mixed files, ${width} px, ${theme}`, async () => {
        const dialog = await show([photo, realVideo, pdf], width, theme);
        expect(dialog.querySelectorAll(".strip-thumb")).toHaveLength(3);
        expectLaidOut(dialog, width);
        await shoot(`c-batch-${width}-${theme}`, dialog);
        // The PDF on the stage.
        await userEvent.click(dialog.querySelectorAll<HTMLElement>(".strip-thumb")[2]);
        await nextTick();
        expectLaidOut(dialog, width);
        if (width === 520) await shoot(`c-batch-${width}-${theme}-pdf`, dialog);
      });
    }
  }
});
