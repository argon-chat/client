/**
 * StickerView in a real browser: the outline is what shows until a frame exists, then the Lottie
 * frame drawn by the worker pool replaces it; a second mount of the same sticker starts from the
 * cached first frame instead of the outline.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, shallowRef, watch } from "vue";
import StickerView from "@/components/expressions/StickerView.vue";
import { ExpressionFormat, type ExpressionMedia } from "@/lib/expressions/types";
import { previewCache } from "@/lib/expressions/files";
import { getLottiePool } from "@/lib/expressions/lottie/LottiePool";

// A 1×1 red PNG.
const { PNG } = vi.hoisted(() => ({
  PNG: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
}));

vi.mock("@/store/system/fileStorage", async () => {
  const { default: url } = await import("../fixtures/tiny-lottie.json?url");
  const resolve = (fileId: string) =>
    fileId === "broken"
      ? "data:application/json,not-a-lottie"
      : fileId.endsWith("-thumb")
        ? `${PNG}#${fileId}`
        : fileId === "static-png"
          ? PNG
          : url;
  return { cdnUrl: resolve, cdnFetchUrl: resolve, cdnCrossOrigin: () => undefined };
});

const OUTLINE = new Uint8Array([12, 128 | 34, 192 + 37, 64 | 5, 128 | 6]);

const media = (fileId: string): ExpressionMedia => ({
  fileId,
  format: ExpressionFormat.Lottie,
  width: 512,
  height: 512,
  outline: OUTLINE,
});

const mounted: VueWrapper[] = [];

function show(fileId: string, onReady?: (root: HTMLElement) => void) {
  const wrapper = mount(StickerView, {
    props: { media: media(fileId), size: 100, onReady: () => onReady?.(wrapper.element as HTMLElement) },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

async function until(check: () => boolean, timeout = 10_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

function centre(canvas: HTMLCanvasElement) {
  const probe = document.createElement("canvas");
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  return Array.from(ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data);
}

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

/**
 * A parent that hands StickerView `first` and then, from a post-flush watcher, `second`: both
 * renders land in the same flush, so the view is updated twice before `nextTick` resolves.
 */
function harness(initial: ExpressionMedia) {
  const Parent = defineComponent({
    setup(_, { expose }) {
      const current = shallowRef(initial);
      let queued: ExpressionMedia | null = null;
      watch(current, () => {
        if (!queued) return;
        current.value = queued;
        queued = null;
      }, { flush: "post" });
      expose({
        swap(first: ExpressionMedia, second: ExpressionMedia) {
          queued = second;
          current.value = first;
        },
      });
      return () => h(StickerView, { media: current.value, size: 100 });
    },
  });
  const wrapper = mount(Parent, { attachTo: document.body });
  return {
    wrapper,
    sticker: () => wrapper.findComponent(StickerView),
    swap: (first: ExpressionMedia, second: ExpressionMedia) =>
      (wrapper.vm as unknown as { swap(a: ExpressionMedia, b: ExpressionMedia): void }).swap(first, second),
  };
}

/** A few frames: long enough for the pool to load the bytes and hand the canvas to a worker. */
async function settle() {
  await nextTick();
  for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
}

describe("StickerView", () => {
  test("outline first, then the frame", async () => {
    // Read in the handler: `ready` means the frame is already on the canvas, not merely drawn.
    let atReady: number[] | null = null;
    const wrapper = show("sticker-a", (root) => (atReady = centre([...root.querySelectorAll("canvas")].at(-1)!)));
    await nextTick();

    const root = wrapper.element as HTMLElement;
    expect(root.dataset.phase).toBe("pending");
    expect(root.querySelector(".sticker-view__outline path")?.getAttribute("d")).toBe("M12,34l-5,6z");
    expect([root.style.width, root.style.height]).toEqual(["100px", "100px"]);

    await until(() => wrapper.emitted("ready") !== undefined);
    expect(atReady).toEqual([255, 0, 0, 255]);
    await nextTick();

    expect(root.dataset.phase).toBe("ready");
    expect(root.querySelector(".sticker-view__outline")).toBeNull();
    const canvas = root.querySelector<HTMLCanvasElement>("canvas:not([style*='display: none'])")!;
    expect(canvas.width).toBe(Math.round(100 * Math.min(2, Math.max(1, devicePixelRatio))));
    expect(centre(canvas)).toEqual([255, 0, 0, 255]);
  });

  test("the next mount of the same sticker starts from its cached first frame", async () => {
    const first = show("sticker-b");
    await until(() => first.emitted("ready") !== undefined);
    await until(() => previewCache.size > 0 && previewCache.has("sticker-b-0"));
    first.unmount();
    mounted.splice(mounted.indexOf(first), 1);

    const second = show("sticker-b");
    await nextTick();
    const root = second.element as HTMLElement;
    expect(root.querySelector(".sticker-view__outline")).toBeNull(); // the preview stands in instead
    const preview = [...root.querySelectorAll("canvas")].find((c) => c.style.display !== "none")!;
    expect(centre(preview)).toEqual([255, 0, 0, 255]);
    await until(() => second.emitted("ready") !== undefined);
  });

  test("a loaded frame that never reports as shown still clears the outline, after a while", async () => {
    const pool = getLottiePool();
    const createPlayer = pool.createPlayer.bind(pool);
    const loadedAt: number[] = [];
    vi.spyOn(pool, "createPlayer").mockImplementation((opts) => {
      const handle = createPlayer({ ...opts, onFirstPresent: undefined });
      void handle.ready.then(() => loadedAt.push(performance.now()));
      return handle;
    });
    const wrapper = show("sticker-silent");
    await until(() => loadedAt.length > 0);
    expect(wrapper.emitted("ready")).toBeUndefined();
    await until(() => wrapper.emitted("ready") !== undefined, 5_000);
    expect(performance.now() - loadedAt[0]).toBeGreaterThanOrEqual(1_900);
    await nextTick();
    expect((wrapper.element as HTMLElement).querySelector(".sticker-view__outline")).toBeNull();
  });

  test("a file that fails to load keeps the outline and shows the thumbnail", async () => {
    const wrapper = mount(StickerView, {
      props: { media: { ...media("broken"), thumbFileId: "broken-thumb" }, size: 100 },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    await until(() => wrapper.emitted("error") !== undefined);
    await nextTick();

    const root = wrapper.element as HTMLElement;
    expect(root.dataset.phase).toBe("fallback");
    expect(root.querySelector(".sticker-view__outline")).not.toBeNull();
    expect(root.querySelector("img")?.getAttribute("src")).toBe(`${PNG}#broken-thumb`);
    expect(wrapper.emitted("ready")).toBeUndefined();
  });

  test("an equal media swapped in twice in one tick keeps the player", async () => {
    const { wrapper, sticker, swap } = harness(media("sticker-c"));
    await until(() => sticker().emitted("ready") !== undefined);
    await nextTick();
    const root = sticker().element as HTMLElement;
    const canvas = root.querySelector("canvas:not([style*='display: none'])");
    const create = vi.spyOn(getLottiePool(), "createPlayer");

    swap(media("sticker-c"), media("sticker-c"));
    await settle();

    expect(create).not.toHaveBeenCalled();
    expect(sticker().emitted("error")).toBeUndefined();
    expect(root.dataset.phase).toBe("ready");
    expect(root.querySelector("canvas:not([style*='display: none'])")).toBe(canvas);
    wrapper.unmount();
  });

  test("two different files in one tick: one fresh canvas and one player, for the last", async () => {
    const { wrapper, sticker, swap } = harness(media("sticker-d"));
    await until(() => sticker().emitted("ready") !== undefined);
    const create = vi.spyOn(getLottiePool(), "createPlayer");
    const before = getLottiePool().playerCount;

    swap(media("sticker-e"), media("sticker-f"));
    await settle();
    await until(() => (sticker().emitted("ready")?.length ?? 0) > 1 || sticker().emitted("error") !== undefined);

    expect(sticker().emitted("error")).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].fileId).toBe("sticker-f");
    expect(getLottiePool().playerCount).toBe(before);
    expect((sticker().element as HTMLElement).dataset.phase).toBe("ready");
    wrapper.unmount();
  });

  test("a static sticker is an image and is ready when it loads", async () => {
    const wrapper = mount(StickerView, {
      props: { media: { ...media("static-png"), format: ExpressionFormat.Static }, size: 50 },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    await nextTick();
    const img = wrapper.element.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(PNG);
    await until(() => wrapper.emitted("ready") !== undefined);
  });
});
