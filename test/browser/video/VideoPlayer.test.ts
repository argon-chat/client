/**
 * VideoPlayer in a real browser, on a real WebM made in the page: the chrome, play and pause, the
 * keyboard, the speed menu, press-and-hold speed, the storyboard preview, errors with a retry,
 * the metrics, and that unmounting lets the element's media go.
 */
import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { userEvent } from "vitest/browser";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { makeSprite, makeWebm, until } from "./media";

const h = vi.hoisted(() => ({
  counts: [] as { name: string; attrs: Record<string, unknown> }[],
  timings: [] as { name: string; attrs: Record<string, unknown> }[],
}));

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/telemetry/metrics", () => {
  const count = (name: string, attrs: Record<string, unknown> = {}) => void h.counts.push({ name, attrs });
  const startTimer = (name: string, attrs: Record<string, unknown> = {}) => ({
    elapsed: () => 0,
    end: (extra: Record<string, unknown> = {}) => {
      h.timings.push({ name, attrs: { ...attrs, ...extra } });
      return 0;
    },
  });
  const errorKind = (e: unknown) => (e as { name?: string })?.name ?? "unknown";
  const metrics = { count, startTimer, errorKind, distribution: () => {}, gauge: () => {} };
  return { metrics, default: metrics, count, startTimer, errorKind };
});

import VideoPlayer from "@/components/media/VideoPlayer.vue";
import { runSessionReset } from "@/store/system/sessionLifecycle";

let src = "";
let host: HTMLDivElement;
const mounted: VueWrapper[] = [];

beforeAll(async () => {
  src = await makeWebm({ seconds: 12, fps: 10 });
}, 60_000);

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem("argon_active_account", "acc-1");
  // As an account switch does: the settings re-read storage, which is empty now.
  await runSessionReset();
  h.counts.length = 0;
  h.timings.length = 0;
  host = document.createElement("div");
  host.style.cssText = "width: 640px; height: 360px; position: relative;";
  document.body.appendChild(host);
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  host.remove();
});

function show(props: Record<string, unknown> = {}) {
  const wrapper = mount(VideoPlayer, {
    props: { src, width: 160, height: 90, durationMs: 12_000, ...props },
    attachTo: host,
  });
  mounted.push(wrapper);
  const root = wrapper.element as HTMLElement;
  // Test utils mounts into a plain div of its own: give it the host's height.
  (root.parentElement as HTMLElement).style.height = "100%";
  const video = root.querySelector("video")!;
  const $ = (id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { wrapper, root, video, $ };
}

const loaded = (video: HTMLVideoElement) => until(() => video.readyState >= 1 && video.duration > 11, 10_000, "metadata");

/** Records every address the player gives the element from now on. */
function trackSrc(video: HTMLVideoElement): string[] {
  const sets: string[] = [];
  const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
  Object.defineProperty(video, "src", {
    configurable: true,
    get() {
      return native.get!.call(this);
    },
    set(value: string) {
      sets.push(value);
      native.set!.call(this, value);
    },
  });
  return sets;
}

/** A media error of the given code, as the element would report it (2: the network, e.g. a stale signed URL). */
function failWith(video: HTMLVideoElement, code: number) {
  Object.defineProperty(video, "error", { configurable: true, get: () => ({ code, message: "" }) });
  video.dispatchEvent(new Event("error"));
}

describe("VideoPlayer", () => {
  test("full controls: progress, play, volume, time, speed, full screen", async () => {
    const { video, $ } = show();
    await loaded(video);
    await nextTick();
    for (const id of ["video-player-controls", "video-player-progress", "video-player-toggle", "video-player-mute", "video-player-volume", "video-player-rate", "video-player-fullscreen"]) {
      expect($(id), id).not.toBeNull();
    }
    expect($("video-player-time")!.textContent).toContain("0:12");
    expect(video.getAttribute("preload")).toBe("metadata");
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.hasAttribute("crossorigin")).toBe(false);
    expect(video.hasAttribute("disablepictureinpicture")).toBe(false);
  });

  test("a click on the picture plays, another pauses; the first frame is counted once", async () => {
    const { root, video } = show();
    await loaded(video);
    await userEvent.click(video);
    await until(() => !video.paused && video.currentTime > 0, 10_000, "playing");
    expect(root.classList.contains("is-playing")).toBe(true);
    await userEvent.click(video);
    await until(() => video.paused, 5_000, "paused");
    expect(root.classList.contains("is-playing")).toBe(false);

    expect(h.counts.filter((c) => c.name === "video.play")).toEqual([{ name: "video.play", attrs: { source: "viewer", result: "ok" } }]);
    expect(h.timings.map((t) => t.name)).toEqual(["video.playback.start"]);
  });

  test("keys: digits jump to tenths, arrows ±5 s, J/L ±10 s, M mutes, Space plays", async () => {
    const { root, video } = show();
    await loaded(video);
    root.focus();

    await userEvent.keyboard("5");
    expect(video.currentTime).toBeCloseTo(6, 1);
    await userEvent.keyboard("{ArrowRight}");
    expect(video.currentTime).toBeCloseTo(11, 1);
    await userEvent.keyboard("j");
    expect(video.currentTime).toBeCloseTo(1, 1);
    await userEvent.keyboard("{ArrowLeft}");
    expect(video.currentTime).toBe(0);
    await userEvent.keyboard("l");
    expect(video.currentTime).toBeCloseTo(10, 1);

    await userEvent.keyboard("m");
    expect(video.muted).toBe(true);
    expect(localStorage.getItem("argon_video_muted::acc-1")).toBe("true");
    await userEvent.keyboard("m");
    expect(video.muted).toBe(false);

    await userEvent.keyboard("0");
    await userEvent.keyboard(" ");
    await until(() => !video.paused, 5_000, "playing after Space");
  });

  test("arrows are left alone where they belong to the viewer's navigation", async () => {
    const { root, video } = show({ seekArrows: false });
    await loaded(video);
    root.focus();
    const seen = vi.fn();
    host.addEventListener("keydown", seen);
    await userEvent.keyboard("{ArrowRight}");
    expect(video.currentTime).toBe(0);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  test("listening always: keys work without focus, and are not passed on", async () => {
    const { video } = show({ listenKeyboard: "always" });
    await loaded(video);
    (document.activeElement as HTMLElement | null)?.blur();
    const below = vi.fn();
    window.addEventListener("keydown", below);
    await userEvent.keyboard("k");
    window.removeEventListener("keydown", below);
    await until(() => !video.paused, 5_000, "playing after K");
    expect(below).not.toHaveBeenCalled();
  });

  test("the speed menu sets the rate and it is remembered; Alt+= steps it", async () => {
    const { root, video, $ } = show();
    await loaded(video);
    await userEvent.click($("video-player-rate")!);
    const item = root.querySelector<HTMLElement>('[data-testid="video-player-rate-menu"] [data-rate="1.5"]')!;
    expect(item).not.toBeNull();
    await userEvent.click(item);
    expect(video.playbackRate).toBe(1.5);
    expect(localStorage.getItem("argon_video_rate::acc-1")).toBe("1.5");
    expect($("video-player-rate-menu")).toBeNull();

    root.focus();
    await userEvent.keyboard("{Alt>}={/Alt}");
    expect(video.playbackRate).toBe(1.75);
    await userEvent.keyboard("{Alt>}-{/Alt}{Alt>}-{/Alt}");
    expect(video.playbackRate).toBe(1.25);

    // The next player starts at the remembered speed.
    const next = show();
    await loaded(next.video);
    expect(next.video.playbackRate).toBe(1.25);
  });

  test("press and hold plays at 2× with a badge, and lets go back to normal", async () => {
    const { video, $ } = show();
    await loaded(video);
    await userEvent.click(video);
    await until(() => !video.paused, 10_000, "playing");

    const rect = video.getBoundingClientRect();
    video.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: rect.left + 100, clientY: rect.top + 100 }));
    await new Promise((r) => setTimeout(r, 300));
    await nextTick();
    expect(video.playbackRate).toBe(2);
    expect($("video-player-speed-badge")?.textContent).toContain("2×");

    // Dragging right speeds it up a hundredth per pixel.
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: rect.left + 150, clientY: rect.top + 100 }));
    expect(video.playbackRate).toBeCloseTo(2.5);

    window.dispatchEvent(new PointerEvent("pointerup", { button: 0 }));
    await nextTick();
    expect(video.playbackRate).toBe(1);
    expect($("video-player-speed-badge")).toBeNull();
    expect(video.paused).toBe(false);
    // A held speed is not remembered.
    expect(localStorage.getItem("argon_video_rate::acc-1")).toBeNull();
  });

  test("hovering the progress line draws the storyboard frame for that moment", async () => {
    const storyboard = { url: makeSprite(), map: { frameWidth: 16, frameHeight: 9, columns: 2, frameCount: 4, intervalMs: 3000 } };
    const { video, $ } = show({ storyboard });
    await loaded(video);
    const bar = $("video-player-progress")!;
    const rect = bar.getBoundingClientRect();
    const hover = (f: number) =>
      bar.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: rect.left + rect.width * f, clientY: rect.top + rect.height / 2 }));

    const canvas = $("video-player-preview") as HTMLCanvasElement;
    const pixel = () => Array.from(canvas.getContext("2d")!.getImageData(8, 4, 1, 1).data);

    hover(0.7); // 8.4 s: frame 2, blue
    await until(() => pixel()[2] > 200, 5_000, "the blue frame");
    expect(pixel()).toEqual([0, 0, 255, 255]);
    expect($("video-player-tooltip")!.textContent).toContain("0:08");
    expect(canvas.style.width).toBe("24px");

    hover(0.3); // 3.6 s: frame 1, green
    await until(() => pixel()[1] > 200 && pixel()[2] < 50, 5_000, "the green frame");
  });

  test("a video that cannot play says so, counts the failure, and plays after a retry", async () => {
    const broken = URL.createObjectURL(new Blob(["not a video"], { type: "video/webm" }));
    const refreshSrc = vi.fn(async () => src);
    const { video, $, wrapper } = show({ src: broken, refreshSrc, autoplay: true });
    await until(() => $("video-player-retry") !== null, 10_000, "the error");
    expect(h.counts.find((c) => c.name === "video.play")?.attrs).toMatchObject({ source: "viewer", result: "failed" });
    const errors = wrapper.emitted("error");
    expect(errors?.length).toBeGreaterThan(0);

    await userEvent.click($("video-player-retry")!);
    expect(refreshSrc).toHaveBeenCalledTimes(1);
    await until(() => !video.paused && video.currentTime > 0, 10_000, "playing after the retry");
    expect($("video-player-retry")).toBeNull();
  });

  test("a stale address is refreshed quietly once, loaded once, and the guard survives the parent handing it back as src", async () => {
    const second = URL.createObjectURL(await (await fetch(src)).blob());
    let wrapper!: VueWrapper;
    // As the viewer does: the fresh address comes back both as the answer and as the new `src`.
    const refreshSrc = vi.fn(async () => {
      await wrapper.setProps({ src: second });
      return second;
    });
    const shown = show({ refreshSrc });
    wrapper = shown.wrapper;
    const { video, $ } = shown;
    await loaded(video);
    const sets = trackSrc(video);

    failWith(video, 2);
    await until(() => sets.length > 0, 5_000, "the reload");
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(refreshSrc).toHaveBeenCalledTimes(1);
    expect(sets).toEqual([second]);
    expect($("video-player-retry")).toBeNull();

    // The refreshed address fails as well: no second quiet refresh, the error is shown.
    await loaded(video);
    failWith(video, 2);
    await nextTick();
    expect($("video-player-retry")).not.toBeNull();
    expect(refreshSrc).toHaveBeenCalledTimes(1);
    expect(sets).toEqual([second]);
    expect(shown.wrapper.emitted("error")?.at(-1)).toEqual(["media_network"]);
  });

  test("dragging the volume is live on the video and stored once, when let go", async () => {
    const { video, $ } = show();
    await loaded(video);
    const slider = $("video-player-volume") as HTMLInputElement;
    for (const value of ["0.8", "0.5", "0.3"]) {
      slider.value = value;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
    expect(video.volume).toBeCloseTo(0.3);
    expect(localStorage.getItem("argon_video_volume::acc-1")).toBeNull();
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    expect(localStorage.getItem("argon_video_volume::acc-1")).toBe("0.3");
  });

  test("autoplay and loop are honoured; the duration comes from the file", async () => {
    const { video, wrapper, $ } = show({ autoplay: true, loop: true, durationMs: 0 });
    await until(() => !!wrapper.emitted("playing"), 10_000, "autoplay");
    expect(wrapper.emitted("play")).toBeTruthy();
    expect(video.loop).toBe(true);
    expect($("video-player-time")!.textContent).toContain("0:12");
  });

  test("inline: no chrome, no focus, no picture-in-picture, always muted", async () => {
    const { root, video, $ } = show({ controls: "inline", muted: true, autoplay: true, fillBox: true });
    await until(() => h.counts.some((c) => c.name === "video.play"), 10_000, "inline autoplay");
    expect($("video-player-controls")).toBeNull();
    expect(root.hasAttribute("tabindex")).toBe(false);
    expect(video.hasAttribute("disablepictureinpicture")).toBe(true);
    expect(video.muted).toBe(true);
    expect(getComputedStyle(video).objectFit).toBe("cover");
    expect(h.counts.find((c) => c.name === "video.play")?.attrs).toMatchObject({ source: "inline", result: "ok" });
    // The chat bubble's pointer stays: only the full player hides the cursor while playing.
    await until(() => !video.paused, 10_000, "playing");
    expect(getComputedStyle(root).cursor).not.toBe("none");
    expect(getComputedStyle(video).cursor).not.toBe("none");
  });

  test("unmounting lets the media go", async () => {
    const { video, wrapper } = show({ autoplay: true });
    await until(() => !video.paused, 10_000, "playing");
    mounted.splice(mounted.indexOf(wrapper), 1);
    wrapper.unmount();
    expect(video.paused).toBe(true);
    expect(video.hasAttribute("src")).toBe(false);
  });
});
