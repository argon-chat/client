/**
 * A video in the chat: poster, length badge and a play button when it does not play by itself;
 * with autoplay on, a silent looping <video> only while it is on screen, paused off screen and let
 * go half a minute later. With autoplay off there is no <video> and nothing observing anything.
 */
import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { EntityType, MessageEntityVideo } from "@argon/glue";
import { makeSprite, makeWebm, until } from "./media";

const h = vi.hoisted(() => ({
  src: "",
  broken: "",
  poster: "",
  resolved: [] as string[],
  /** Addresses handed out before falling back to `src`. */
  queue: [] as string[],
  invalidated: [] as string[],
}));

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/system/fileStorage", () => ({
  cdnUrl: () => h.poster,
  cdnFetchUrl: (id: string) => `https://api.test/files/${id}`,
  cdnCrossOrigin: () => undefined,
}));
vi.mock("@/lib/media/mediaUrl", () => ({
  resolveMediaUrl: async (fileId: string) => {
    h.resolved.push(fileId);
    return h.queue.shift() ?? h.src;
  },
  invalidateMediaUrl: (fileId: string) => void h.invalidated.push(fileId),
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

import VideoAttachment from "@/components/chats/attachments/VideoAttachment.vue";
import { videoAutoplayInChat } from "@/lib/video/playerSettings";
import { autoplayIntersectorAlive, suspendChatVideos } from "@/lib/media/videoAutoplay";
import { runSessionReset } from "@/store/system/sessionLifecycle";

const MB = 1024 * 1024;
const FILE_ID = "0b6f7a52-3c1e-4c55-9d0e-6c7e7b0a1f01";

type EntityOptions = {
  fileId: string;
  fileSize: number;
  durationMs: number;
  posterFileId: string | null;
  posterUrl: string | null;
  downloadUrl: string | null;
};

function entity(over: Partial<EntityOptions> = {}): MessageEntityVideo {
  return new MessageEntityVideo(
    EntityType.Video, 0, 0, 1,
    over.fileId ?? FILE_ID, "clip.mp4", BigInt(over.fileSize ?? 2 * MB), "video/mp4",
    320, 180, over.durationMs ?? 41_600, true, "avc1.64001f", null,
    over.posterFileId === undefined ? "9d3b8c1e-0000-4000-8000-000000000001" : over.posterFileId, null, null, null,
    [] as never, over.downloadUrl ?? null, over.posterUrl ?? null, null,
  );
}

const PENDING = "00000000-0000-0000-0000-000000000000";

let host: HTMLDivElement;
const mounted: VueWrapper[] = [];

beforeAll(async () => {
  h.src = await makeWebm({ seconds: 4, fps: 10 });
  h.broken = URL.createObjectURL(new Blob(["not a video"], { type: "video/webm" }));
  h.poster = makeSprite();
}, 60_000);

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("argon_active_account", "acc-1");
  await runSessionReset();
  videoAutoplayInChat.value = true;
  h.resolved.length = 0;
  h.queue.length = 0;
  h.invalidated.length = 0;
  host = document.createElement("div");
  host.style.cssText = "width: 320px; height: 180px; position: relative;";
  document.body.prepend(host);
});

afterEach(() => {
  vi.useRealTimers();
  for (const w of mounted.splice(0)) w.unmount();
  host.remove();
});

function show(props: Record<string, unknown> = {}) {
  const wrapper = mount(VideoAttachment, { props: { video: entity(), ...props }, attachTo: host });
  mounted.push(wrapper);
  const root = wrapper.element as HTMLElement;
  (root.parentElement as HTMLElement).style.height = "100%";
  const $ = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { wrapper, root, $, video: () => root.querySelector("video") };
}

const frames = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
};

describe("VideoAttachment", () => {
  test("autoplay off: poster, length and a play button, and no <video> or observer at all", async () => {
    videoAutoplayInChat.value = false;
    const { root, $, video } = show();
    await frames();
    expect(video()).toBeNull();
    expect(autoplayIntersectorAlive()).toBe(false);
    expect(h.resolved).toEqual([]);
    expect($("video-play-button")).not.toBeNull();
    expect($("video-duration")!.textContent!.trim()).toBe("0:42");
    expect($("video-duration")!.querySelector("svg")).toBeNull();
    expect(root.getAttribute("data-attachment-id")).toBe(FILE_ID);
    await until(() => !!root.querySelector("img.va-poster.visible"), 5_000, "the poster");
  });

  test("autoplay on and on screen: a silent looping <video> from the direct url", async () => {
    const { $, video } = show();
    await until(() => !!video() && !video()!.paused, 10_000, "the preview playing");
    expect(h.resolved).toEqual([FILE_ID]);
    expect(video()!.src).toBe(h.src);
    expect(video()!.muted).toBe(true);
    expect(video()!.loop).toBe(true);
    expect(video()!.hasAttribute("disablepictureinpicture")).toBe(true);
    expect($("video-play-button")).toBeNull();
    // The no-sound mark beside the length.
    expect($("video-duration")!.querySelector("svg")).not.toBeNull();
    expect(autoplayIntersectorAlive()).toBe(true);
  });

  test("switched off while playing: the <video> and the observer go", async () => {
    const { video, $ } = show();
    await until(() => !!video() && !video()!.paused, 10_000, "the preview playing");
    const element = video()!;
    videoAutoplayInChat.value = false;
    await nextTick();
    expect(video()).toBeNull();
    expect(element.hasAttribute("src")).toBe(false);
    expect(autoplayIntersectorAlive()).toBe(false);
    expect($("video-play-button")).not.toBeNull();
  });

  test("off screen it pauses, and half a minute later the element is let go", async () => {
    const { video } = show();
    await until(() => !!video() && !video()!.paused, 10_000, "the preview playing");
    const element = video()!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    host.style.marginTop = "5000px";
    await until(() => element.paused, 5_000, "paused off screen");
    expect(video()).toBe(element);
    vi.advanceTimersByTime(29_000);
    await nextTick();
    expect(video()).toBe(element);
    vi.advanceTimersByTime(1_500);
    await nextTick();
    expect(video()).toBeNull();
    expect(element.hasAttribute("src")).toBe(false);
  });

  test("a preview whose address fails asks for a fresh one, once, and plays from it", async () => {
    h.queue.push(h.broken);
    const { video } = show();
    await until(() => !!video() && video()!.src === h.src && !video()!.paused, 10_000, "playing from the fresh address");
    expect(h.invalidated).toEqual([FILE_ID]);
    expect(h.resolved).toEqual([FILE_ID, FILE_ID]);
  });

  test("a preview that fails again gives up: poster and play button, nothing more asked", async () => {
    h.queue.push(h.broken, h.broken);
    const { video, $ } = show();
    await until(() => $("video-play-button") !== null, 10_000, "the play button");
    expect(video()).toBeNull();
    expect(h.invalidated).toEqual([FILE_ID]);
    expect(h.resolved).toEqual([FILE_ID, FILE_ID]);
    expect(autoplayIntersectorAlive()).toBe(false);
    await frames(10);
    expect(h.resolved).toHaveLength(2);
  });

  test("while it is being sent: the local poster, and never a preview, autoplay or not", async () => {
    const { root, video, $ } = show({ video: entity({ fileId: PENDING, posterFileId: null, posterUrl: h.poster }) });
    await until(() => !!root.querySelector("img.va-poster.visible"), 5_000, "the local poster");
    expect(root.querySelector<HTMLImageElement>("img.va-poster")!.src).toBe(h.poster);
    await frames();
    expect(video()).toBeNull();
    expect(h.resolved).toEqual([]);
    expect(autoplayIntersectorAlive()).toBe(false);
    expect($("video-play-button")).toBeNull();
  });

  test("while it is being sent with no poster: the local file's first frame, held still", async () => {
    const { $ } = show({ video: entity({ fileId: PENDING, posterFileId: null, downloadUrl: h.src }) });
    const still = $("video-local-still") as HTMLVideoElement;
    expect(still).not.toBeNull();
    await until(() => still.readyState >= 1, 5_000, "the local file's metadata");
    await frames();
    expect(still.paused).toBe(true);
    expect(still.muted).toBe(true);
    expect(h.resolved).toEqual([]);
  });

  test("behind an open viewer the preview holds still, and plays on when it closes", async () => {
    const { video } = show();
    await until(() => !!video() && !video()!.paused, 10_000, "the preview playing");
    suspendChatVideos(true);
    await until(() => video()!.paused, 5_000, "paused behind the viewer");
    suspendChatVideos(false);
    await until(() => !video()!.paused, 5_000, "playing again");
  });

  test("over 50 MB, or one of an album, waits for a click", async () => {
    const big = show({ video: entity({ fileSize: 60 * MB }) });
    const grouped = show({ video: entity({ fileId: "0b6f7a52-3c1e-4c55-9d0e-6c7e7b0a1f02" }), grouped: true });
    await frames();
    for (const v of [big, grouped]) {
      expect(v.video()).toBeNull();
      expect(v.$("video-play-button")).not.toBeNull();
    }
    expect(h.resolved).toEqual([]);
  });

  test("a click opens it", async () => {
    videoAutoplayInChat.value = false;
    const { wrapper, root } = show();
    root.click();
    expect(wrapper.emitted("open")?.[0]?.[0]).toMatchObject({ fileId: FILE_ID, durationMs: 41_600 });
  });

  test("while it is being sent: the upload ring, no play button, and a click does nothing", async () => {
    const { wrapper, root, $ } = show({ video: entity({ fileId: "00000000-0000-0000-0000-000000000000" }), progress: 0.4, stage: "Uploading" });
    await frames();
    expect($("video-upload")).not.toBeNull();
    expect($("video-upload")!.textContent).toContain("Uploading");
    expect($("video-play-button")).toBeNull();
    expect(root.querySelector("video")).toBeNull();
    root.click();
    expect(wrapper.emitted("open")).toBeUndefined();
  });
});
