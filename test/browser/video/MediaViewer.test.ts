/**
 * The chat's viewer (ImageLightbox) with videos among the pictures: a video slide mounts the full
 * player on the direct URL and loops a short clip, navigation lets it go, Esc is the viewer's (and
 * not the composer's underneath), ←/→ navigate rather than seek, and a big video downloads by
 * opening its direct URL instead of being pulled into memory.
 */
import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { userEvent } from "vitest/browser";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { EntityType, MessageEntityAttachment, MessageEntityVideo } from "@argon/glue";
import { makeSprite, makeWebm, until } from "./media";

const h = vi.hoisted(() => ({ src: "", picture: "", copied: [] as unknown[] }));

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: () => h.picture,
  cdnFetchUrl: () => h.picture,
  cdnCrossOrigin: () => undefined,
  resolveAttachmentUrl: () => h.picture,
}));
vi.mock("@/lib/media/mediaUrl", () => ({
  resolveMediaUrl: async () => h.src,
  invalidateMediaUrl: () => {},
}));
vi.mock("@/lib/attachments/clipboard", () => ({
  copyAttachmentToClipboard: async (a: unknown) => void h.copied.push(a),
}));
vi.mock("@/lib/telemetry/metrics", () => {
  const metrics = {
    count: () => {},
    distribution: () => {},
    gauge: () => {},
    startTimer: () => ({ end: () => 0, elapsed: () => 0 }),
    errorKind: (e: unknown) => (e as { name?: string })?.name ?? "unknown",
  };
  return { metrics, default: metrics, ...metrics };
});

import ImageLightbox from "@/components/chats/ImageLightbox.vue";
import { runSessionReset } from "@/store/system/sessionLifecycle";

const MB = 1024 * 1024;

const video = (fileId: string, fileSize = 3 * MB, durationMs = 4_000) =>
  new MessageEntityVideo(
    EntityType.Video, 0, 0, 1, fileId, "clip.mp4", BigInt(fileSize), "video/mp4", 160, 90, durationMs, false, null, null,
    null, null, null, null, [] as never, null, null, null,
  );
const picture = (fileId: string) =>
  new MessageEntityAttachment(EntityType.Attachment, 0, 0, 1, fileId, "pic.png", BigInt(1000), "image/png", 32, 18, null, null);

let wrapper: VueWrapper | null = null;

beforeAll(async () => {
  h.src = await makeWebm({ seconds: 4, fps: 10 });
  h.picture = makeSprite();
}, 60_000);

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("argon_active_account", "acc-1");
  await runSessionReset();
  h.copied.length = 0;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

async function open(images: (MessageEntityAttachment | MessageEntityVideo)[], initialIndex = 0) {
  wrapper = mount(ImageLightbox, { props: { images, initialIndex, isOpen: false }, attachTo: document.body });
  await wrapper.setProps({ isOpen: true });
  await nextTick();
  const overlay = () => document.querySelector<HTMLElement>(".lightbox-overlay");
  const player = () => document.querySelector<HTMLVideoElement>("[data-testid=lightbox-video] video");
  return { overlay, player };
}

describe("the viewer with videos", () => {
  test("a video slide plays the direct url in the full player, looping a short clip", async () => {
    const { player } = await open([video("v1")]);
    await until(() => !!player() && !player()!.paused, 10_000, "the video playing");
    expect(player()!.src).toBe(h.src);
    expect(player()!.loop).toBe(true);
    expect(document.querySelector("[data-testid=video-player-controls]")).not.toBeNull();
  });

  test("a clip of a minute or more does not loop", async () => {
    const { player } = await open([video("v1", MB, 90_000)]);
    await until(() => !!player()?.src, 10_000, "the video");
    expect(player()!.loop).toBe(false);
  });

  test("→ goes to the next item (the player does not take it) and lets the video go", async () => {
    const { overlay, player } = await open([video("v1"), picture("p1")]);
    await until(() => !!player() && !player()!.paused, 10_000, "the video playing");
    const element = player()!;
    overlay()!.focus();
    await userEvent.keyboard("{ArrowRight}");
    await nextTick();
    expect(player()).toBeNull();
    expect(element.hasAttribute("src")).toBe(false);
    expect(document.querySelector(".lightbox-image")).not.toBeNull();
    expect(document.querySelector(".lightbox-counter")!.textContent).toContain("2 / 2");
  });

  test("the player's keys reach it without focus; Esc closes the viewer and is not passed on as unhandled", async () => {
    const { player } = await open([video("v1")]);
    await until(() => !!player() && !player()!.paused, 10_000, "the video playing");
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard("k");
    await until(() => player()!.paused, 5_000, "paused by K");

    document.querySelector<HTMLElement>(".lightbox-overlay")!.focus();
    let prevented: boolean | null = null;
    const probe = (e: KeyboardEvent) => (prevented = e.defaultPrevented);
    window.addEventListener("keydown", probe);
    await userEvent.keyboard("{Escape}");
    window.removeEventListener("keydown", probe);
    expect(prevented).toBe(true);
    expect(wrapper!.emitted("close")).toBeTruthy();
  });

  test("Space on the viewer's close button presses it, and leaves the video playing", async () => {
    const { player } = await open([video("v1")]);
    await until(() => !!player() && !player()!.paused, 10_000, "the video playing");
    document.querySelector<HTMLButtonElement>(".lightbox-close")!.focus();
    await userEvent.keyboard(" ");
    await until(() => !!wrapper!.emitted("close"), 2_000, "the close");
    expect(player()!.paused).toBe(false);
  });

  test("Ctrl+C copies the video as a file", async () => {
    const { overlay, player } = await open([video("v1")]);
    await until(() => !!player(), 10_000, "the video");
    overlay()!.focus();
    await userEvent.keyboard("{Control>}c{/Control}");
    await until(() => h.copied.length === 1, 2_000, "the copy");
    expect(h.copied[0]).toMatchObject({ fileId: "v1", contentType: "video/mp4" });
  });

  test("a video over 100 MB downloads by opening its direct url, not into memory", async () => {
    const opened = vi.fn();
    vi.stubGlobal("open", opened);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await open([video("v1", 150 * MB)]);
    document.querySelector<HTMLButtonElement>(".lightbox-download")!.click();
    await until(() => opened.mock.calls.length === 1, 2_000, "the window");
    expect(opened.mock.calls[0][0]).toBe(h.src);
    expect(opened.mock.calls[0][1]).toBe("_blank");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
