/**
 * The cut-out tab's lasso, magnetic lasso, magic eraser and background eraser in a real browser.
 *
 * Without a GPU: the mask canvas draws selection and eraser ops the way the CPU maths says, and the
 * live-wire worker loads from the package and answers path requests. With a GPU (`ARGON_TEST_GPU=1`):
 * the editor is mounted in sticker mode, each tool is used through the canvas overlay with pointer
 * events and keys, and the exported PNG is checked — transparent where the tool removed the image,
 * opaque where it kept it.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { page } from "vitest/browser";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { MediaEditor, useMediaEditorStore, type MediaEditorFinalResult, type Vec2 } from "@argon/media-editor";
import { createMaskRaster } from "../../../packages/media-editor/src/mask/maskRaster";
import { sourceToCanvas } from "../../../packages/media-editor/src/mask/maskMath";
import { selectionCoverage } from "../../../packages/media-editor/src/selection/polygon";
import { eraseWithCoverage } from "../../../packages/media-editor/src/selection/coverage";
import { createLiveWireWorker } from "../../../packages/media-editor/src/selection/liveWireClient";

const adapter = typeof navigator !== "undefined" && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const SKIP = adapter ? "" : " — skipped: no WebGPU adapter (set ARGON_TEST_GPU=1)";

type Img = { data: Uint8ClampedArray; width: number; height: number };
type Rgb = [number, number, number];

async function blobUrl(width: number, height: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  draw(canvas.getContext("2d")!);
  return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
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

const alphaAt = (img: Img, x: number, y: number) => img.data[(Math.round(y) * img.width + Math.round(x)) * 4 + 3];

async function until(check: () => boolean, timeout = 15_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

// ─── Without a GPU ────────────────────────────────────────────────

describe("selection and eraser ops on the mask canvas", () => {
  test("a polygon op erases inside or outside exactly as the CPU coverage says", () => {
    const points: Vec2[] = [[20, 10], [90, 30], [60, 90], [10, 70]];
    for (const region of ["inside", "outside"] as const) {
      for (const feather of [0, 6]) {
        const raster = createMaskRaster(100, 100, 1);
        raster.render(null, 0, [{ kind: "polygon", region, feather, points }]);
        const got = raster.read();
        const want = new Uint8Array(100 * 100).fill(255);
        eraseWithCoverage(want, 100, 100, selectionCoverage(points, feather, 100, 100)!, region === "outside");
        let worst = 0;
        for (let i = 0; i < got.length; i++) worst = Math.max(worst, Math.abs(got[i] - want[i]));
        expect(worst, `${region}, feather ${feather}`).toBeLessThanOrEqual(1);
        raster.dispose();
      }
    }
  });

  test("a raster op lands on its source box, at the mask's resolution; a restore stroke after it wins", () => {
    // A 4×2 erase raster over source box (40, 20)–(80, 40), drawn into a half-resolution mask.
    const data = new Uint8Array([255, 255, 128, 0, 255, 255, 128, 0]);
    const sources = new Map([[7, { width: 4, height: 2, data }]]);
    const resolve = (id: number | null) => (id === null ? null : sources.get(id) ?? null);
    const raster = createMaskRaster(50, 50, 0.5);
    raster.render(null, 0, [{ kind: "raster", mode: "erase", raster: 7, points: [[40, 20], [48, 24]] }], resolve);
    const m = raster.read();
    expect(m[10 * 50 + 20]).toBe(0);
    expect(m[11 * 50 + 21]).toBe(0);
    expect(Math.abs(m[10 * 50 + 22] - 127)).toBeLessThanOrEqual(1);
    expect(m[10 * 50 + 23]).toBe(255);
    expect(m[9 * 50 + 20]).toBe(255);
    raster.render(null, 0, [
      { kind: "raster", mode: "erase", raster: 7, points: [[40, 20], [48, 24]] },
      { mode: "restore", size: 20, points: [[42, 21]] },
    ], resolve);
    expect(raster.read()[10 * 50 + 20]).toBe(255);
    raster.dispose();
  });

  test("the live-wire worker builds the edge map and follows a square's edge", async () => {
    const W = 512;
    const canvas = new OffscreenCanvas(W, W);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgb(220, 220, 220)";
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = "rgb(200, 30, 40)";
    ctx.fillRect(128, 128, 256, 256);
    const { data } = ctx.getImageData(0, 0, W, W);
    const backend = createLiveWireWorker();
    try {
      const started = performance.now();
      await backend.prepare({ width: W, height: W, data });
      const prepareMs = performance.now() - started;
      const times: number[] = [];
      let r = await backend.path([128, 300], [300, 128], { snap: 4 });
      for (let i = 0; i < 10; i++) {
        r = await backend.path([128, 300], [300 - i, 128], { snap: 4 });
        times.push(r.ms);
      }
      const n = r.points.length / 2;
      for (let i = 0; i < n; i++) {
        const x = r.points[i * 2] + 0.5;
        const y = r.points[i * 2 + 1] + 0.5;
        expect(Math.min(Math.abs(x - 128), Math.abs(y - 128)), `(${x},${y})`).toBeLessThanOrEqual(1);
      }
      console.info(`[live wire] edge map ${W}² in ${prepareMs.toFixed(0)} ms, path replies ${Math.min(...times).toFixed(1)}–${Math.max(...times).toFixed(1)} ms`);
      expect(Math.max(...times)).toBeLessThan(30);
    } finally {
      backend.dispose();
    }
  });
});

// ─── Through the editor, on the GPU ──────────────────────────────

const MEDIA: Vec2 = [256, 256];
const mounted: VueWrapper[] = [];

async function openEditor(src: string) {
  const pinia = createPinia();
  const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false, messages: { en: {} } });
  const wrapper = mount(MediaEditor, {
    props: { modelValue: true, src, mediaType: "image", mode: "sticker", exportFormat: "png" },
    attachTo: document.body,
    global: { plugins: [pinia, i18n] },
  });
  mounted.push(wrapper);
  const store = useMediaEditorStore(pinia);
  await until(() => store.uiState.isReady);
  await nextTick();
  return { wrapper, store };
}

type Store = ReturnType<typeof useMediaEditorStore>;

async function pickTool(store: Store, tool: string) {
  document.querySelector<HTMLButtonElement>(`[data-cutout-tool="${tool}"]`)!.click();
  await nextTick();
  await until(() => !!document.querySelector(`[data-cutout-overlay="${tool}"]`));
  expect(store.uiState.cutoutTool).toBe(tool);
}

function overlay(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-cutout-overlay]")!;
}

/** Client coordinates of a source pixel, through the editor's view transform. */
function client(store: Store, p: Vec2): { clientX: number; clientY: number } {
  const rect = overlay().getBoundingClientRect();
  const dpr = store.uiState.pixelRatio;
  const [cw, ch] = store.uiState.canvasSize!;
  const c = sourceToCanvas(p, store.uiState.finalTransform, [Math.round(cw * dpr), Math.round(ch * dpr)], MEDIA);
  return { clientX: rect.left + c[0] / dpr, clientY: rect.top + c[1] / dpr };
}

function pointer(store: Store, type: string, p: Vec2) {
  overlay().dispatchEvent(new PointerEvent(type, { ...client(store, p), pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
}

function click(store: Store, p: Vec2) {
  pointer(store, "pointerdown", p);
  pointer(store, "pointerup", p);
}

function key(k: string) {
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

async function finish(wrapper: VueWrapper, store: Store, nth = 0): Promise<Img> {
  await until(() => !store.uiState.isMoving);
  const done = Array.from(document.querySelectorAll<HTMLButtonElement>(".media-editor__container button")).find((b) => b.textContent?.trim() === "Done")!;
  done.click();
  await until(() => (wrapper.emitted("done")?.length ?? 0) > nth);
  const result = wrapper.emitted("done")![nth][0] as MediaEditorFinalResult;
  const { blob } = await result.getResult();
  return pixels(blob);
}

/** The export is 512×512: two output pixels per source pixel. */
const out = (v: number) => v * 2 + 1;

describe.skipIf(!adapter)(`selection tools through the editor${SKIP}`, () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });
  afterEach(() => {
    for (const w of mounted.splice(0)) w.unmount();
  });

  test("lasso, polygon mode, Keep inside: transparent outside the polygon, opaque inside; undo brings it back", async () => {
    const src = await blobUrl(...MEDIA, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 256, 256);
      g.addColorStop(0, "rgb(250, 120, 20)");
      g.addColorStop(1, "rgb(20, 90, 240)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    });
    const { wrapper, store } = await openEditor(src);
    await pickTool(store, "lasso");
    document.querySelector<HTMLButtonElement>('[data-option="lasso-mode"] [data-value="polygon"]')!.click();
    await nextTick();

    // A diamond: (128, 40) (216, 128) (128, 216) (40, 128).
    const diamond: Vec2[] = [[128, 40], [216, 128], [128, 216], [40, 128]];
    for (const p of diamond) click(store, p);
    await nextTick();
    key("Enter");
    await nextTick();
    expect(store.uiState.selection?.points).toHaveLength(4);
    for (const [i, p] of store.uiState.selection!.points.entries()) {
      expect(Math.abs(p[0] - diamond[i][0]) + Math.abs(p[1] - diamond[i][1])).toBeLessThan(0.01);
    }
    await until(() => !!document.querySelector("[data-selection-outline]"));
    document.querySelector<HTMLButtonElement>('[data-selection-action="keep"]')!.click();
    await nextTick();
    expect(store.mediaState.mask.strokes).toMatchObject([{ kind: "polygon", region: "outside", feather: 0 }]);

    const img = await finish(wrapper, store);
    expect([img.width, img.height]).toEqual([512, 512]);
    // |x − 128| + |y − 128| < 88 inside.
    const inside = (x: number, y: number) => Math.abs(x - 128) + Math.abs(y - 128);
    const wrong: string[] = [];
    for (let y = 0; y < 256; y += 3) {
      for (let x = 0; x < 256; x += 3) {
        const d = inside(x + 0.5, y + 0.5);
        const a = alphaAt(img, out(x), out(y));
        if (d < 86 && a !== 255) wrong.push(`(${x},${y}) inside α=${a}`);
        if (d > 90 && a !== 0) wrong.push(`(${x},${y}) outside α=${a}`);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);

    store.undo();
    expect(store.mediaState.mask.strokes).toHaveLength(0);
    const again = await finish(wrapper, store, 1);
    expect(alphaAt(again, 10, 10)).toBe(255);
  }, 30_000);

  test("magnetic lasso: two anchors on a red square's sides and close → the cut follows the square within 2 px", async () => {
    // A red square 64..192 on light grey.
    const src = await blobUrl(...MEDIA, (ctx) => {
      ctx.fillStyle = "rgb(225, 228, 230)";
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "rgb(210, 40, 50)";
      ctx.fillRect(64, 64, 128, 128);
    });
    const { wrapper, store } = await openEditor(src);
    await pickTool(store, "magneticLasso");
    await until(() => store.uiState.liveWire === "ready");

    // Near (not on) the left and right sides: the edge width snaps them.
    click(store, [66, 120]);
    for (let y = 118; y >= 80; y -= 6) pointer(store, "pointermove", [65, y]);
    click(store, [190, 136]);
    await until(() => document.querySelectorAll("[data-cutout-overlay] circle").length >= 2);
    key("Enter");
    await until(() => store.uiState.selection !== null);
    document.querySelector<HTMLButtonElement>('[data-selection-action="keep"]')!.click();
    await nextTick();
    expect(store.mediaState.mask.strokes).toMatchObject([{ kind: "polygon", region: "outside" }]);

    const img = await finish(wrapper, store);
    /** Where alpha crosses 128 along a row / column of the export, in source pixels. */
    const crossings = (line: (i: number) => number): number[] => {
      const at: number[] = [];
      for (let i = 1; i < 512; i++) {
        const a = line(i - 1) >= 128;
        const b = line(i) >= 128;
        if (a !== b) at.push(i / 2);
      }
      return at;
    };
    for (const s of [80, 100, 128, 150, 176]) {
      const row = crossings((i) => alphaAt(img, i, out(s)));
      const col = crossings((i) => alphaAt(img, out(s), i));
      expect(row, `row ${s}`).toHaveLength(2);
      expect(col, `column ${s}`).toHaveLength(2);
      for (const [got, want] of [[row[0], 64], [row[1], 192], [col[0], 64], [col[1], 192]]) {
        expect(Math.abs(got - want), `row/column ${s}: edge at ${got}, square at ${want}`).toBeLessThanOrEqual(2);
      }
    }
    expect(alphaAt(img, 256, 256)).toBe(255);
    expect(alphaAt(img, 20, 20)).toBe(0);
  }, 30_000);

  test("magic eraser: a click on a flat background erases it and keeps the subject", async () => {
    const src = await blobUrl(...MEDIA, (ctx) => {
      ctx.fillStyle = "rgb(40, 160, 90)";
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "rgb(30, 60, 220)";
      ctx.beginPath();
      ctx.arc(128, 128, 70, 0, Math.PI * 2);
      ctx.fill();
    });
    const { wrapper, store } = await openEditor(src);
    await pickTool(store, "magicEraser");
    click(store, [12, 12]);
    await nextTick();
    expect(store.mediaState.mask.strokes).toMatchObject([{ kind: "raster", mode: "erase" }]);

    const img = await finish(wrapper, store);
    for (const [x, y] of [[5, 5], [250, 5], [5, 250], [250, 250], [128, 20], [40, 128]] as Vec2[]) {
      expect(alphaAt(img, out(x), out(y)), `background (${x},${y})`).toBe(0);
    }
    for (const [x, y] of [[128, 128], [128, 62], [190, 128], [80, 170]] as Vec2[]) {
      expect(alphaAt(img, out(x), out(y)), `subject (${x},${y})`).toBe(255);
    }
    // The disc's rim is anti-aliased by the canvas: partial there, not a hard stair.
    let partial = 0;
    for (let a = 0; a < 360; a += 5) {
      const r = 70;
      const v = alphaAt(img, out(128 + r * Math.cos((a * Math.PI) / 180)), out(128 + r * Math.sin((a * Math.PI) / 180)));
      if (v > 0 && v < 255) partial++;
    }
    expect(partial).toBeGreaterThan(10);
  }, 30_000);

  test("background eraser, sampled once: a stroke across a blue|yellow boundary erases only blue", async () => {
    const src = await blobUrl(...MEDIA, (ctx) => {
      ctx.fillStyle = "rgb(30, 70, 220)";
      ctx.fillRect(0, 0, 128, 256);
      ctx.fillStyle = "rgb(245, 215, 40)";
      ctx.fillRect(128, 0, 128, 256);
    });
    const { wrapper, store } = await openEditor(src);
    await pickTool(store, "backgroundEraser");
    expect(store.uiState.cutoutOptions.sampling).toBe("once");
    store.uiState.cutoutOptions.eraserSize = 40;
    store.uiState.cutoutOptions.eraserHardness = 100;
    // The brush's radius in source pixels.
    const r = (40 / 2) * (store.uiState.pixelRatio / store.uiState.finalTransform.scale);
    expect(r).toBeGreaterThan(6);

    pointer(store, "pointerdown", [96, 128]);
    for (let x = 100; x <= 168; x += 4) pointer(store, "pointermove", [x, 128]);
    pointer(store, "pointerup", [168, 128]);
    await nextTick();
    expect(store.mediaState.mask.strokes).toMatchObject([{ kind: "raster", mode: "erase" }]);

    const img = await finish(wrapper, store);
    const inner = r - 2;
    // Blue under the stroke: gone, up to the boundary.
    for (const x of [96, 110, 124, 126]) expect(alphaAt(img, out(x), out(128)), `blue (${x},128)`).toBe(0);
    expect(alphaAt(img, out(110), out(128 - inner))).toBe(0);
    // Yellow under the stroke: kept.
    for (const x of [129, 140, 160, 168]) expect(alphaAt(img, out(x), out(128)), `yellow (${x},128)`).toBe(255);
    // Blue beyond the brush: kept.
    expect(alphaAt(img, out(110), out(128 - r - 3))).toBe(255);
    expect(alphaAt(img, out(60), out(128))).toBe(255);

    // One step to undo, and it is gone from the mask.
    store.undo();
    expect(store.mediaState.mask.strokes).toHaveLength(0);
  }, 30_000);

  test("keys while drawing: Backspace takes the last corner back, Escape cancels without closing the editor", async () => {
    const src = await blobUrl(...MEDIA, (ctx) => {
      ctx.fillStyle = "rgb(200, 100, 50)";
      ctx.fillRect(0, 0, 256, 256);
    });
    const { wrapper, store } = await openEditor(src);
    await pickTool(store, "lasso");
    document.querySelector<HTMLButtonElement>('[data-option="lasso-mode"] [data-value="polygon"]')!.click();
    await nextTick();
    for (const p of [[40, 40], [200, 40], [200, 200], [120, 230]] as Vec2[]) click(store, p);
    key("Backspace");
    key("Enter");
    await nextTick();
    expect(store.uiState.selection?.points).toHaveLength(3);
    expect(store.uiState.selection!.points[2][0]).toBeCloseTo(200, 1);
    key("Escape");
    await nextTick();
    expect(store.uiState.selection).toBeNull();
    expect(wrapper.emitted("cancel")).toBeUndefined();
    expect(store.mediaState.history).toHaveLength(0);
  }, 30_000);
});
