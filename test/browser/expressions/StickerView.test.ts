/**
 * StickerView in a real browser: the outline is what shows until a frame exists, then the Lottie
 * frame drawn by the worker pool replaces it; a second mount of the same sticker starts from the
 * cached first frame instead of the outline.
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import StickerView from "@/components/expressions/StickerView.vue";
import { ExpressionFormat, type ExpressionMedia } from "@/lib/expressions/types";
import { previewCache } from "@/lib/expressions/files";

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

function show(fileId: string) {
  const wrapper = mount(StickerView, {
    props: { media: media(fileId), size: 100 },
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

describe("StickerView", () => {
  test("outline first, then the frame", async () => {
    const wrapper = show("sticker-a");
    await nextTick();

    const root = wrapper.element as HTMLElement;
    expect(root.dataset.phase).toBe("pending");
    expect(root.querySelector(".sticker-view__outline path")?.getAttribute("d")).toBe("M12,34l-5,6z");
    expect([root.style.width, root.style.height]).toEqual(["100px", "100px"]);

    await until(() => wrapper.emitted("ready") !== undefined);
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
