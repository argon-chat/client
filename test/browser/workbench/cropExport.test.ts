/**
 * What the crop shows is what the export holds, in every mode. The editor's model (CropHandles,
 * CropTab, RotationWheel): the crop area is the canvas less 60 px at the sides and top and 120 px at
 * the bottom; at scale 1 the image is contained in it; the crop rect is `currentImageRatio`
 * contained in it, centred; `translation` moves the image in those pixels. The export maps that
 * crop rect onto the output whatever the image's, the crop's and the crop area's aspect ratios are.
 *
 * The source has four coloured quadrants, each with a 1-px white border and a black 16-px marker
 * near its top-left corner, so a crop that is cut, shifted, zoomed or turned the wrong way shows.
 * The first half drives `createFinalResult` with the state a crop leaves; the second mounts the
 * editor and crops through its handles, ratio buttons and rotate button.
 *
 * WebGPU: skipped without an adapter; run with `ARGON_TEST_GPU=1`.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { page } from "vitest/browser";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import {
  MediaEditor,
  createFinalResult,
  useMediaEditorStore,
  type EditorMode,
  type MediaEditorFinalResult,
  type Vec2,
} from "@argon/media-editor";
import { fitToAspectRatio, rotatePoint } from "../../../packages/media-editor/src/geometry";

const adapter = typeof navigator !== "undefined" && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const SKIP = adapter ? "" : " — skipped: no WebGPU adapter (set ARGON_TEST_GPU=1)";

type Rgb = [number, number, number];
type Img = { data: Uint8ClampedArray; width: number; height: number };
type Rect = { x: number; y: number; w: number; h: number };

const RED: Rgb = [255, 0, 0];
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
const YELLOW: Rgb = [255, 255, 0];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const FILLS = [RED, GREEN, BLUE, YELLOW];

/** The source pixel at (x, y) of a w×h quadrant image. */
function quadrantPixel(x: number, y: number, w: number, h: number): Rgb {
  const qw = w / 2;
  const qh = h / 2;
  const qx = x < qw ? 0 : 1;
  const qy = y < qh ? 0 : 1;
  const lx = x - qx * qw;
  const ly = y - qy * qh;
  if (lx === 0 || ly === 0 || lx === qw - 1 || ly === qh - 1) return WHITE;
  if (lx >= 8 && lx < 24 && ly >= 8 && ly < 24) return BLACK;
  return FILLS[qy * 2 + qx];
}

async function blobUrl(width: number, height: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  draw(canvas.getContext("2d")!);
  return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
}

function quadrants(width: number, height: number): Promise<string> {
  return blobUrl(width, height, (ctx) => {
    const qw = width / 2;
    const qh = height / 2;
    FILLS.forEach((fill, i) => {
      const x = (i % 2) * qw;
      const y = Math.floor(i / 2) * qh;
      ctx.fillStyle = "rgb(255, 255, 255)";
      ctx.fillRect(x, y, qw, qh);
      ctx.fillStyle = `rgb(${fill.join(", ")})`;
      ctx.fillRect(x + 1, y + 1, qw - 2, qh - 2);
      ctx.fillStyle = "rgb(0, 0, 0)";
      ctx.fillRect(x + 8, y + 8, 16, 16);
    });
  });
}

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

/** Opaque and within a few levels of `rgb`. */
function expectColour(img: Img, x: number, y: number, rgb: Rgb) {
  const got = at(img, x, y);
  expect(got[3], `alpha at (${x},${y})`).toBe(255);
  expect(Math.max(...rgb.map((v, i) => Math.abs(v - got[i]))), `(${x},${y}) is ${got.join(",")}, want ${rgb.join(",")}`).toBeLessThanOrEqual(6);
}

/** Red, white, black or a blend of them — nothing from another quadrant. */
function isTopLeftColour([r, g, b]: number[]): boolean {
  return r >= g - 4 && r >= b - 4 && Math.abs(g - b) <= 8;
}

/**
 * The output pixel (ox, oy) should be the source pixel this returns: the crop rect turned by
 * `quarterTurns` (negative is the "rotate left" button, counter-clockwise).
 */
function expectedSource(rect: Rect, quarterTurns: number, ox: number, oy: number): [number, number] {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return [rect.x + ox, rect.y + oy];
  if (turns === 1) return [rect.x + oy, rect.y + rect.h - 1 - ox];
  if (turns === 2) return [rect.x + rect.w - 1 - ox, rect.y + rect.h - 1 - oy];
  return [rect.x + rect.w - 1 - oy, rect.y + ox];
}

/** Every output pixel against the source pixel it should show; returns the mismatches. */
function mismatches(img: Img, media: Vec2, rect: Rect, quarterTurns = 0, tolerance = 12): string[] {
  const out: string[] = [];
  for (let oy = 0; oy < img.height; oy++) {
    for (let ox = 0; ox < img.width; ox++) {
      const [sx, sy] = expectedSource(rect, quarterTurns, ox, oy);
      const want = quadrantPixel(sx, sy, media[0], media[1]);
      const got = at(img, ox, oy);
      if (got[3] < 250 || want.some((v, i) => Math.abs(v - got[i]) > tolerance)) {
        out.push(`(${ox},${oy}) got ${got.join(",")} want ${want.join(",")} [source ${sx},${sy}]`);
      }
    }
  }
  return out;
}

/** The editor state a crop to `rect` (source pixels) leaves, turned by `quarterTurns`. */
function cropState(canvas: Vec2, media: Vec2, rect: Rect, quarterTurns = 0) {
  const co: Vec2 = [canvas[0] - 120, canvas[1] - 180];
  const [fitW] = fitToAspectRatio(media[0] / media[1], co[0], co[1]);
  const perSource = fitW / media[0];
  const odd = Math.abs(quarterTurns) % 2 === 1;
  const [shownW, shownH] = odd ? [rect.h, rect.w] : [rect.w, rect.h];
  const ratio = shownW / shownH;
  const [cropW] = fitToAspectRatio(ratio, co[0], co[1]);
  const scale = cropW / (shownW * perSource);
  const rotation = (quarterTurns * Math.PI) / 2;
  const k = scale * perSource;
  const [tx, ty] = rotatePoint([(rect.x + rect.w / 2 - media[0] / 2) * k, (rect.y + rect.h / 2 - media[1] / 2) * k], rotation);
  return { currentImageRatio: ratio, scale, rotation, translation: [-tx, -ty] as Vec2 };
}

async function exportState(
  src: string,
  media: Vec2,
  mode: EditorMode,
  canvas: Vec2,
  state: Partial<ReturnType<typeof cropState>> = {},
): Promise<{ img: Img; width: number; height: number }> {
  const store = useMediaEditorStore();
  store.init({ src, type: "image", mode });
  Object.assign(store.mediaState, state);
  const result = await createFinalResult({
    mediaSrc: src,
    mediaType: "image",
    mediaState: store.mediaState,
    canvasSize: canvas,
    mediaRatio: media[0] / media[1],
    renderingPayload: { media: { width: media[0], height: media[1] } },
    mode,
    getMaskSource: store.getMaskSource,
    exportFormat: "png",
  });
  const { blob } = await result.getResult();
  return { img: await pixels(blob), width: result.width, height: result.height };
}

// A wide editor (the crop area is wider than a 4:3 image) and a narrow one (taller).
const CANVASES: Vec2[] = [
  [880, 716],
  [500, 900],
];
const MEDIA: Vec2 = [800, 600];
const TOP_LEFT: Rect = { x: 0, y: 0, w: 400, h: 300 };

describe.skipIf(!adapter)(`crop → export on the GPU${SKIP}`, () => {
  let src = "";
  beforeEach(async () => {
    setActivePinia(createPinia());
    src ||= await quadrants(...MEDIA);
  });

  describe.each(CANVASES)("editor canvas %i×%i", (cw, ch) => {
    const canvas: Vec2 = [cw, ch];

    test.each(["full", "avatar"] as const)("(a) %s: the top-left quadrant, whole, unshifted, at 1:1", async (mode) => {
      const { img, width, height } = await exportState(src, MEDIA, mode, canvas, cropState(canvas, MEDIA, TOP_LEFT));
      expect([width, height, img.width, img.height]).toEqual([400, 300, 400, 300]);
      expect(mismatches(img, MEDIA, TOP_LEFT).slice(0, 5)).toEqual([]);
    });

    test.each([-1, 1])("(b) the top-left quadrant turned %i quarter", async (turns) => {
      const { img, width, height } = await exportState(src, MEDIA, "full", canvas, cropState(canvas, MEDIA, TOP_LEFT, turns));
      expect([width, height]).toEqual([300, 400]);
      expect(mismatches(img, MEDIA, TOP_LEFT, turns).slice(0, 5)).toEqual([]);
    });

    test.each<[string, Rect]>([
      ["the centre at 2× (all four quadrants)", { x: 200, y: 150, w: 400, h: 300 }],
      ["a tall strip across the middle line", { x: 300, y: 100, w: 240, h: 400 }],
      ["a wide band across both quadrant rows", { x: 60, y: 200, w: 680, h: 240 }],
      ["a square in the bottom-right quadrant", { x: 480, y: 320, w: 260, h: 260 }],
    ])("(c) zoomed: %s", async (_, rect) => {
      const { img, width, height } = await exportState(src, MEDIA, "full", canvas, cropState(canvas, MEDIA, rect));
      expect([width, height]).toEqual([rect.w, rect.h]);
      expect(mismatches(img, MEDIA, rect).slice(0, 5)).toEqual([]);
    });

    test("(c) a portrait avatar's default square crop is the centre square at 1:1", async () => {
      const portrait: Vec2 = [600, 800];
      const tall = await quadrants(...portrait);
      // What ImageCanvas sets up for avatars: ratio 1, scaled to cover.
      const co: Vec2 = [cw - 120, ch - 180];
      const [w1, h1] = fitToAspectRatio(portrait[0] / portrait[1], co[0], co[1]);
      const [w2, h2] = fitToAspectRatio(1, co[0], co[1]);
      const state = { currentImageRatio: 1, scale: Math.max(w2 / w1, h2 / h1) };
      const { img, width, height } = await exportState(tall, portrait, "avatar", canvas, state);
      expect([width, height]).toEqual([600, 600]);
      expect(mismatches(img, portrait, { x: 0, y: 100, w: 600, h: 600 }).slice(0, 5)).toEqual([]);
    });

    test("(d) sticker, already cropped outside: 800×600 → 512×384, nothing cut", async () => {
      const { img, width, height } = await exportState(src, MEDIA, "sticker", canvas);
      expect([width, height, img.width, img.height]).toEqual([512, 384, 512, 384]);
      // Output pixel centres at 0.5 / 0.64 = 0.78 source px: the white border still shows at every edge.
      for (let i = 0; i < 512; i += 7) {
        expect(at(img, i, 0)[1], `top ${i}`).toBeGreaterThan(150);
        expect(at(img, i, 383)[2], `bottom ${i}`).toBeGreaterThan(150);
      }
      for (let i = 0; i < 384; i += 7) {
        expect(Math.min(...at(img, 0, i).slice(0, 3)), `left ${i}`).toBeGreaterThan(150);
        expect(Math.min(...at(img, 511, i).slice(0, 3)), `right ${i}`).toBeGreaterThan(150);
      }
      expectColour(img, 128, 96, RED);
      expectColour(img, 384, 96, GREEN);
      expectColour(img, 128, 288, BLUE);
      expectColour(img, 384, 288, YELLOW);
      // Markers at source 8..24 → output 5.1..15.4, and the middle lines at 255.4 / 191.7.
      expectColour(img, 10, 10, BLACK);
      expectColour(img, 266, 202, BLACK);
      expect(Math.min(...at(img, 255, 96).slice(0, 3))).toBeGreaterThan(150);
      expect(Math.min(...at(img, 128, 192).slice(0, 3))).toBeGreaterThan(150);
    });

    test("(d) sticker, cropped in the editor to the top-left quadrant: 512×384 of that quadrant", async () => {
      const { img, width, height } = await exportState(src, MEDIA, "sticker", canvas, cropState(canvas, MEDIA, TOP_LEFT));
      expect([width, height]).toEqual([512, 384]);
      for (let i = 0; i < 512; i += 7) expect(at(img, i, 0)[1], `top ${i}`).toBeGreaterThan(150);
      for (let i = 0; i < 384; i += 7) expect(at(img, 511, i)[1], `right ${i}`).toBeGreaterThan(150);
      expectColour(img, 256, 192, RED);
      expectColour(img, 20, 20, BLACK);
      const foreign: string[] = [];
      for (let y = 0; y < 384; y++) for (let x = 0; x < 512; x++) if (!isTopLeftColour(at(img, x, y))) foreign.push(`(${x},${y}) ${at(img, x, y).join(",")}`);
      expect(foreign.slice(0, 5)).toEqual([]);
    });

    test("(e) emoji: 300×200 → 100×100, fitted to 100×67 and centred on transparency", async () => {
      const small = await quadrants(300, 200);
      const { img, width, height } = await exportState(small, [300, 200], "emoji", canvas);
      expect([width, height, img.width, img.height]).toEqual([100, 100, 100, 100]);
      // Content rows 16..82.
      for (const y of [0, 8, 15, 84, 90, 99]) for (const x of [0, 50, 99]) expect(at(img, x, y)[3], `(${x},${y})`).toBe(0);
      for (const y of [17, 50, 81]) for (const x of [0, 50, 99]) expect(at(img, x, y)[3], `(${x},${y})`).toBe(255);
      expectColour(img, 25, 33, RED);
      expectColour(img, 75, 33, GREEN);
      expectColour(img, 25, 66, BLUE);
      expectColour(img, 75, 66, YELLOW);
    });
  });

  test("(f) transparent margins are kept unless the user crops them away", async () => {
    // A 300×200 opaque block in a 400×300 image, 50 px of transparency around it.
    const margins = await blobUrl(400, 300, (ctx) => {
      ctx.fillStyle = "rgb(0, 0, 255)";
      ctx.fillRect(50, 50, 300, 200);
    });
    const canvas = CANVASES[0];
    const whole = await exportState(margins, [400, 300], "sticker", canvas);
    expect([whole.width, whole.height]).toEqual([512, 384]);
    // ×1.28: the block spans 64..448 × 64..320.
    for (const [x, y] of [[30, 30], [60, 200], [452, 200], [256, 60], [256, 324], [500, 370]]) expect(at(whole.img, x, y)[3], `(${x},${y})`).toBe(0);
    for (const [x, y] of [[66, 66], [256, 192], [446, 318]]) expect(at(whole.img, x, y)[3], `(${x},${y})`).toBe(255);

    setActivePinia(createPinia());
    const cropped = await exportState(margins, [400, 300], "sticker", canvas, cropState(canvas, [400, 300], { x: 50, y: 50, w: 300, h: 200 }));
    expect([cropped.width, cropped.height]).toEqual([512, 341]);
    // ×1.71: the outermost pixels filter in a little of the transparent texel beyond the crop.
    for (const [x, y] of [[0, 0], [511, 0], [0, 340], [511, 340]]) expect(at(cropped.img, x, y)[3], `(${x},${y})`).toBeGreaterThan(150);
    for (const [x, y] of [[2, 2], [509, 2], [2, 338], [509, 338], [256, 170]]) expect(at(cropped.img, x, y)[3], `(${x},${y})`).toBe(255);
  });
});

// ─── Through the editor's own UI ─────────────────────────────────

const mounted: VueWrapper[] = [];

async function until(check: () => boolean, timeout = 15_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

async function openEditor(src: string, mode: EditorMode, initialTab?: string) {
  const pinia = createPinia();
  const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false, messages: { en: {} } });
  const wrapper = mount(MediaEditor, {
    props: { modelValue: true, src, mediaType: "image", mode, initialTab },
    attachTo: document.body,
    global: { plugins: [pinia, i18n] },
  });
  mounted.push(wrapper);
  const store = useMediaEditorStore(pinia);
  await until(() => store.uiState.isReady);
  await nextTick();
  return { wrapper, store };
}

async function finish(wrapper: VueWrapper, store: ReturnType<typeof useMediaEditorStore>): Promise<Img> {
  await until(() => !store.uiState.isMoving);
  const done = Array.from(document.querySelectorAll<HTMLButtonElement>(".media-editor__container button")).find((b) => b.textContent?.trim() === "Done")!;
  done.click();
  await until(() => !!wrapper.emitted("done"));
  const result = wrapper.emitted("done")![0][0] as MediaEditorFinalResult;
  const { blob } = await result.getResult();
  return pixels(blob);
}

/** Drags a crop handle by (dx, dy) CSS px, the way a pointer does. */
async function dragHandle(selector: string, dx: number, dy: number) {
  const handle = document.querySelector<HTMLElement>(selector)!;
  handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: 500, clientY: 400, pointerId: 1, bubbles: true, cancelable: true }));
  document.dispatchEvent(new PointerEvent("pointermove", { clientX: 500 + dx / 2, clientY: 400 + dy / 2, pointerId: 1, bubbles: true }));
  document.dispatchEvent(new PointerEvent("pointermove", { clientX: 500 + dx, clientY: 400 + dy, pointerId: 1, bubbles: true }));
  document.dispatchEvent(new PointerEvent("pointerup", { clientX: 500 + dx, clientY: 400 + dy, pointerId: 1, bubbles: true }));
  await nextTick();
}

function cropRectSize(): Vec2 {
  const el = document.querySelector<HTMLElement>(".crop-handles")!;
  return [parseFloat(el.style.width), parseFloat(el.style.height)];
}

describe.skipIf(!adapter)(`crop → export through the editor${SKIP}`, () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });
  afterEach(() => {
    for (const w of mounted.splice(0)) w.unmount();
  });

  test("dragging the bottom-right corner to the middle exports exactly the top-left quadrant", async () => {
    const { wrapper, store } = await openEditor(await quadrants(...MEDIA), "full", "crop");
    const [w, h] = cropRectSize();
    await dragHandle(".crop-corner--se", -w / 2, -h / 2);
    const img = await finish(wrapper, store);
    expect([img.width, img.height]).toEqual([400, 300]);
    expect(mismatches(img, MEDIA, TOP_LEFT, 0, 24).slice(0, 5)).toEqual([]);
  }, 30_000);

  test("…then rotate left: the quadrant, turned counter-clockwise", async () => {
    const { wrapper, store } = await openEditor(await quadrants(...MEDIA), "full", "crop");
    const [w, h] = cropRectSize();
    await dragHandle(".crop-corner--se", -w / 2, -h / 2);
    await until(() => !store.uiState.isMoving);
    document.querySelector<HTMLButtonElement>('button[title="Rotate left"]')!.click();
    const img = await finish(wrapper, store);
    expect([img.width, img.height]).toEqual([300, 400]);
    expect(mismatches(img, MEDIA, TOP_LEFT, -1, 24).slice(0, 5)).toEqual([]);
  }, 30_000);

  test("the 1:1 ratio button on a wide photo: the centre square, full height, at 1:1", async () => {
    const wide: Vec2 = [1600, 600];
    const { wrapper, store } = await openEditor(await quadrants(...wide), "full", "crop");
    const square = Array.from(document.querySelectorAll<HTMLButtonElement>(".media-editor__container button")).find((b) => b.textContent?.trim() === "1:1")!;
    square.click();
    const img = await finish(wrapper, store);
    expect([img.width, img.height]).toEqual([600, 600]);
    expect(mismatches(img, wide, { x: 500, y: 0, w: 600, h: 600 }, 0, 24).slice(0, 5)).toEqual([]);
  }, 30_000);

  test.each<[string, Vec2, Rect]>([
    ["portrait", [600, 800], { x: 0, y: 100, w: 600, h: 600 }],
    ["wide", [1600, 600], { x: 500, y: 0, w: 600, h: 600 }],
  ])("avatar, %s photo, untouched: the centre square at 1:1", async (_, media, rect) => {
    const { wrapper, store } = await openEditor(await quadrants(...media), "avatar");
    const img = await finish(wrapper, store);
    expect([img.width, img.height]).toEqual([600, 600]);
    expect(mismatches(img, media, rect, 0, 24).slice(0, 5)).toEqual([]);
  }, 30_000);

  test("emoji, 300×200, untouched: the whole image fitted and centred in 100×100", async () => {
    const { wrapper, store } = await openEditor(await quadrants(300, 200), "emoji");
    const img = await finish(wrapper, store);
    expect([img.width, img.height]).toEqual([100, 100]);
    for (const x of [0, 50, 99]) {
      expect(at(img, x, 10)[3], `(${x},10)`).toBe(0);
      expect(at(img, x, 50)[3], `(${x},50)`).toBe(255);
      expect(at(img, x, 90)[3], `(${x},90)`).toBe(0);
    }
    expectColour(img, 25, 33, RED);
    expectColour(img, 75, 66, YELLOW);
  }, 30_000);
});
