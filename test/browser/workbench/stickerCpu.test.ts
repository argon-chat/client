/**
 * The sticker workbench's CPU half in a real browser, no GPU needed: the mask raster (a base from
 * background removal, erase and restore strokes, feathering), compositing a mask into an image's
 * alpha, and encoding a transparent canvas as lossless WEBP / PNG without losing that alpha.
 */

import { describe, test, expect } from "vitest";
import { applyMaskToRgba, encodeTransparentImage } from "@argon/media-editor";
import { createMaskRaster } from "../../../packages/media-editor/src/mask/maskRaster";

async function pixels(blob: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const { width, height } = bitmap;
  bitmap.close();
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

const at = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/** The RIFF chunk types of a WEBP: VP8L is lossless, ALPH + "VP8 " lossy with an alpha plane. */
async function webpChunks(blob: Blob): Promise<string[]> {
  const u = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let at = 12; at + 8 <= u.length; ) {
    chunks.push(String.fromCharCode(u[at], u[at + 1], u[at + 2], u[at + 3]));
    const n = (u[at + 4] | (u[at + 5] << 8) | (u[at + 6] << 16) | (u[at + 7] << 24)) >>> 0;
    at += 8 + n + (n & 1);
  }
  return chunks;
}

/** Opaque blue square in the middle, half-transparent red in the corner, the rest transparent. */
function stickerCanvas(size = 64): OffscreenCanvas {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(0, 0, 255)";
  ctx.fillRect(size / 4, size / 4, size / 2, size / 2);
  ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
  ctx.fillRect(0, 0, 8, 8);
  return canvas;
}

describe("mask raster", () => {
  test("no base: fully opaque", () => {
    const raster = createMaskRaster(8, 4, 1);
    raster.render(null, 0, []);
    expect(Array.from(raster.read())).toEqual(new Array(32).fill(255));
    raster.dispose();
  });

  test("the base is the background-removal mask, byte for byte", () => {
    const data = new Uint8Array(16).map((_, i) => i * 16);
    const raster = createMaskRaster(4, 4, 1);
    raster.render({ width: 4, height: 4, data }, 0, []);
    const read = raster.read();
    for (let i = 0; i < 16; i++) expect(Math.abs(read[i] - data[i])).toBeLessThanOrEqual(1);
    raster.dispose();
  });

  test("erase clears along the stroke, restore paints it back; strokes are in source pixels", () => {
    // Mask at half the source's resolution: a 10 px stroke in the source is 5 px here.
    const raster = createMaskRaster(50, 50, 0.5);
    raster.render(null, 0, [
      { mode: "erase", size: 10, points: [[0, 50], [100, 50]] },
      { mode: "restore", size: 10, points: [[50, 0], [50, 100]] },
    ]);
    const m = raster.read();
    const v = (x: number, y: number) => m[y * 50 + x];
    expect(v(10, 25)).toBe(0); // erased row
    expect(v(10, 10)).toBe(255); // untouched
    expect(v(25, 25)).toBe(255); // restored where the strokes cross
    expect(v(10, 29)).toBe(255); // outside the 5 px band
    raster.dispose();
  });

  test("a live stroke reports the area it touched", () => {
    const raster = createMaskRaster(100, 100, 1);
    raster.render(null, 0, []);
    const stroke = { mode: "erase" as const, size: 10, points: [[20, 20]] as [number, number][] };
    const first = raster.drawStroke(stroke);
    expect(first.x).toBeLessThanOrEqual(15);
    expect(first.x + first.width).toBeGreaterThanOrEqual(25);
    stroke.points.push([60, 20]);
    const second = raster.drawStroke(stroke, 1);
    expect(second.x).toBeLessThanOrEqual(15);
    expect(second.x + second.width).toBeGreaterThanOrEqual(65);
    expect(second.y + second.height).toBeLessThan(40);
    expect(raster.read()[20 * 100 + 40]).toBe(0);
    raster.dispose();
  });

  test("feathering the base softens its edge in the raster", () => {
    const data = new Uint8Array(40 * 4);
    for (let y = 0; y < 4; y++) for (let x = 20; x < 40; x++) data[y * 40 + x] = 255;
    const raster = createMaskRaster(40, 4, 1);
    raster.render({ width: 40, height: 4, data }, 6, []);
    const row = raster.read().subarray(80, 120);
    const soft = Array.from(row).filter((v) => v > 5 && v < 250).length;
    expect(soft).toBeGreaterThan(3);
    raster.dispose();
  });
});

describe("mask compositing and transparent export", () => {
  test("a mask composited into the alpha survives a PNG round trip", async () => {
    const canvas = stickerCanvas();
    const ctx = canvas.getContext("2d")!;
    const image = ctx.getImageData(0, 0, 64, 64);
    const mask = new Uint8Array(64 * 64);
    for (let y = 0; y < 64; y++) for (let x = 32; x < 64; x++) mask[y * 64 + x] = 255;
    ctx.putImageData(new ImageData(applyMaskToRgba(image.data, mask), 64, 64), 0, 0);

    const decoded = await pixels(await encodeTransparentImage(canvas, { format: "png" }));
    expect(at(decoded, 20, 32)[3]).toBe(0); // left half of the square: masked out
    expect(at(decoded, 40, 32)).toEqual([0, 0, 255, 255]);
    expect(at(decoded, 60, 60)[3]).toBe(0);
  });

  test("lossless WEBP where the browser encodes it, alpha exactly as drawn", async () => {
    const canvas = stickerCanvas();
    const webp = await encodeTransparentImage(canvas, { format: "auto" });
    expect(webp.type).toBe("image/webp");
    expect(await webpChunks(webp)).toContain("VP8L");

    const png = await encodeTransparentImage(canvas, { format: "png" });
    expect(png.type).toBe("image/png");
    const a = await pixels(webp);
    const b = await pixels(png);
    expect(a.data).toEqual(b.data);
    expect(at(a, 2, 2)).toEqual([255, 0, 0, 128]);
    expect(at(a, 60, 2)[3]).toBe(0);
  });

  test("over the byte cap it falls back to lossy WEBP, which still has alpha", async () => {
    // Noise does not compress losslessly.
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(256, 256);
    let seed = 1;
    for (let i = 0; i < img.data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      img.data[i] = i % 4 === 3 ? ((i >> 2) % 256 < 128 ? 0 : 255) : (seed >> 16) & 0xff;
    }
    ctx.putImageData(img, 0, 0);
    const lossless = await encodeTransparentImage(canvas, { format: "auto" });
    expect(await webpChunks(lossless)).toContain("VP8L");
    const capped = await encodeTransparentImage(canvas, { format: "auto", maxBytes: lossless.size - 1 });
    expect(capped.type).toBe("image/webp");
    expect(capped.size).toBeLessThan(lossless.size);
    const chunks = await webpChunks(capped);
    expect(chunks).toContain("ALPH");
    expect(chunks).not.toContain("VP8L");
    const decoded = await pixels(capped);
    expect(at(decoded, 10, 0)[3]).toBe(0);
    expect(at(decoded, 200, 0)[3]).toBe(255);

    // Nothing fits: the smallest attempt, so the upload check can say by how much it is over.
    const smallest = await encodeTransparentImage(canvas, { format: "auto", maxBytes: 10 });
    expect(smallest.size).toBeLessThanOrEqual(capped.size);
  });
});
