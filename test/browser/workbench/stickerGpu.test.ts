/**
 * Sticker mode's GPU half, through the real export: transparency survives (no dark fringe at a
 * filtered edge), the mask cuts into the alpha, and the outline is drawn under the image — round,
 * in the chosen colour, as wide as asked in output pixels, around the masked shape.
 *
 * Headless Chromium exposes navigator.gpu but no adapter, so these skip there; run them with the
 * machine's GPU with `ARGON_TEST_GPU=1 bunx vitest run --project browser test/browser/workbench`.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createFinalResult, useMediaEditorStore } from "@argon/media-editor";

const adapter = typeof navigator !== "undefined" && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const REASON = "no WebGPU adapter in this Chromium (headless has none; set ARGON_TEST_GPU=1)";

type Img = { data: Uint8ClampedArray; width: number; height: number };

async function pixels(blob: Blob): Promise<Img> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const { width, height } = bitmap;
  bitmap.close();
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

const at = (img: Img, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/**
 * 128×128: an opaque blue square 32..96, a half-transparent red block 8..24, the rest transparent
 * black (what PNG encoders store there). At the 512 preset every source pixel is 4×4 output pixels.
 */
async function sourceUrl(width = 128, height = 128, draw?: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  if (draw) draw(ctx);
  else {
    ctx.fillStyle = "rgb(0, 0, 255)";
    ctx.fillRect(32, 32, 64, 64);
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.fillRect(8, 8, 16, 16);
  }
  return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
}

async function exportSticker(
  src: string,
  mode: "sticker" | "emoji",
  size: [number, number],
  edit?: (store: ReturnType<typeof useMediaEditorStore>) => void,
  format: "png" | "auto" = "png",
): Promise<{ img: Img; blob: Blob; width: number; height: number }> {
  const store = useMediaEditorStore();
  store.init({ src, type: "image", mode });
  store.mediaState.currentImageRatio = size[0] / size[1];
  store.uiState.mediaSize = size;
  edit?.(store);
  const result = await createFinalResult({
    mediaSrc: src,
    mediaType: "image",
    mediaState: store.mediaState,
    canvasSize: [800, 600],
    mediaRatio: size[0] / size[1],
    renderingPayload: { media: { width: size[0], height: size[1] } },
    mode,
    getMaskSource: store.getMaskSource,
    exportFormat: format,
  });
  const { blob } = await result.getResult();
  return { img: await pixels(blob), blob, width: result.width, height: result.height };
}

describe.skipIf(!adapter)(`sticker export on the GPU${adapter ? "" : ` — skipped: ${REASON}`}`, () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test("transparent pixels stay transparent, colours stay put, and a filtered edge is not darkened", async () => {
    const { img, width, height } = await exportSticker(await sourceUrl(), "sticker", [128, 128]);
    expect([width, height, img.width, img.height]).toEqual([512, 512, 512, 512]);

    expect(at(img, 0, 0)[3]).toBe(0);
    expect(at(img, 500, 500)[3]).toBe(0);
    const blue = at(img, 256, 256);
    expect(blue[3]).toBe(255);
    expect(blue[2]).toBeGreaterThanOrEqual(250);
    expect(blue[0] + blue[1]).toBeLessThanOrEqual(6);

    // Half-transparent red keeps both its alpha and its red.
    const red = at(img, 64, 64);
    expect(Math.abs(red[3] - 128)).toBeLessThanOrEqual(2);
    expect(red[0]).toBeGreaterThanOrEqual(250);

    // Output x = 384 samples between the last blue texel and a transparent black one. Filtering
    // premultiplied colour, it is blue at partial alpha; straight colour would make it dark blue.
    const edge = at(img, 384, 256);
    expect(edge[3]).toBeGreaterThan(40);
    expect(edge[3]).toBeLessThan(230);
    expect(edge[2]).toBeGreaterThanOrEqual(245);
  });

  test("the outline: the chosen colour under the image, radius in output pixels, round corners", async () => {
    const { img } = await exportSticker(await sourceUrl(), "sticker", [128, 128], (store) => {
      store.setOutline("enabled", true);
      store.setOutline("radius", 8);
      store.setOutline("color", "#ff0000");
    });
    // Right edge of the square: the last pixel at ≥ 50 % alpha is x = 383, so 8 px reach x = 391.
    expect(at(img, 388, 256)).toEqual([255, 0, 0, 255]);
    expect(at(img, 391, 256)).toEqual([255, 0, 0, 255]);
    expect(at(img, 396, 256)[3]).toBe(0);
    // The image stays on top.
    const inside = at(img, 380, 256);
    expect(inside[2]).toBeGreaterThanOrEqual(250);
    expect(inside[0]).toBeLessThanOrEqual(3);
    // Round, not square: 8 px out on both axes is 11.3 px from the corner — outside the outline,
    // where a square dilation would still paint it.
    expect(at(img, 391, 391)[3]).toBe(0);
    expect(at(img, 388, 388)).toEqual([255, 0, 0, 255]);
  });

  test("the mask cuts into the alpha, and the outline follows the cut", async () => {
    const { img } = await exportSticker(await sourceUrl(), "sticker", [128, 128], (store) => {
      const data = new Uint8Array(128 * 128);
      for (let y = 0; y < 128; y++) for (let x = 64; x < 128; x++) data[y * 128 + x] = 255;
      store.setMaskSource(store.addMaskSource({ width: 128, height: 128, data }));
      store.addMaskStroke({ mode: "erase", size: 8, points: [[64, 80], [128, 80]] });
      store.setOutline("enabled", true);
      store.setOutline("radius", 6);
      store.setOutline("color", "#00ff00");
    });
    expect(at(img, 200, 200)[3]).toBe(0); // left half of the square: masked
    const kept = at(img, 320, 200);
    expect(kept[3]).toBe(255);
    expect(kept[2]).toBeGreaterThanOrEqual(250);
    // The erased stripe (source y 76..84 → output 304..336): outlined along its edges, empty in the middle.
    expect(at(img, 320, 308)).toEqual([0, 255, 0, 255]);
    expect(at(img, 320, 320)[3]).toBe(0);
    expect(at(img, 250, 200)).toEqual([0, 255, 0, 255]); // outline just left of the cut at x = 256
    expect(at(img, 240, 200)[3]).toBe(0);
    expect(at(img, 64, 64)[3]).toBe(0); // the red block was in the masked half
  });

  test("emoji: fitted into 100×100 and padded with transparency", async () => {
    const src = await sourceUrl(200, 100, (ctx) => {
      ctx.fillStyle = "rgb(0, 200, 0)";
      ctx.fillRect(0, 0, 200, 100);
    });
    const { img, width, height } = await exportSticker(src, "emoji", [200, 100]);
    expect([width, height, img.width, img.height]).toEqual([100, 100, 100, 100]);
    expect(at(img, 50, 10)[3]).toBe(0);
    expect(at(img, 50, 90)[3]).toBe(0);
    const middle = at(img, 50, 50);
    expect(middle[3]).toBe(255);
    expect(middle[1]).toBeGreaterThanOrEqual(195);
  });

  test("the default format is lossless WEBP with the same pixels as PNG", async () => {
    const src = await sourceUrl();
    const webp = await exportSticker(src, "sticker", [128, 128], undefined, "auto");
    setActivePinia(createPinia());
    const png = await exportSticker(src, "sticker", [128, 128], undefined, "png");
    expect(webp.blob.type).toBe("image/webp");
    // VP8L is the lossless bitstream (Chromium encodes WEBP losslessly at quality 1).
    const text = new TextDecoder("latin1").decode(await webp.blob.arrayBuffer());
    expect(text).toContain("VP8L");
    expect(webp.img.data).toEqual(png.img.data);
  });
});
