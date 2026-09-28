/**
 * The cut-out tab's lasso, magnetic lasso, magic eraser and background eraser in a real browser.
 *
 * Without a GPU: the mask canvas draws selection and eraser ops (and the erasers' decontaminated
 * colours) the way the CPU maths says, a red disc magic-erased off grey keeps no grey rim, the magic
 * eraser's time on 4 megapixels, and the live-wire worker's reply times while tracing a 2048² image
 * with a 64 px Width. With a GPU (`ARGON_TEST_GPU=1`): the editor is mounted in sticker mode, each
 * tool is used through the canvas overlay with pointer events and keys, and the exported PNG is
 * checked — transparent where the tool removed the image, opaque where it kept it, and red, not
 * grey, along a magic-erased disc's soft edge.
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
import { createLiveWireWorker, type LiveWireBackend } from "../../../packages/media-editor/src/selection/liveWireClient";
import { createMagneticLasso, fasteningSpacing } from "../../../packages/media-editor/src/selection/magneticLasso";
import { contrastLevels, pathLength } from "../../../packages/media-editor/src/selection/livewire";

const pathLengthOf = (p: Int32Array) => Math.round(pathLength(p));
import { magicErase } from "../../../packages/media-editor/src/selection/magicEraser";
import type { MaskRaster } from "../../../packages/media-editor/src/types";

const adapter = typeof navigator !== "undefined" && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const SKIP = adapter ? "" : " — skipped: no WebGPU adapter (set ARGON_TEST_GPU=1)";

type Img = { data: Uint8ClampedArray; width: number; height: number };

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
const rgbaAt = (img: Img, x: number, y: number) => {
  const at = (Math.round(y) * img.width + Math.round(x)) * 4;
  return Array.from(img.data.subarray(at, at + 4));
};

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

  test("the erasers' colours are drawn in op order at their op's box; a restore stroke clears them", () => {
    // Op 1 over (10, 5)–(14, 7): red at its pixel 0, green at 1. Op 2 over (10, 5)–(12, 6): blue at 1.
    const one: MaskRaster = { width: 4, height: 2, data: new Uint8Array(8).fill(128), colour: Uint32Array.of(0, 0xff0000, 1, 0x00ff00) };
    const two: MaskRaster = { width: 2, height: 1, data: new Uint8Array([64, 64]), colour: Uint32Array.of(1, 0x0000ff) };
    const resolve = (id: number | null) => (id === 1 ? one : id === 2 ? two : null);
    const ops = [
      { kind: "raster" as const, mode: "erase" as const, raster: 1, points: [[10, 5], [14, 7]] as Vec2[] },
      { kind: "raster" as const, mode: "erase" as const, raster: 2, points: [[10, 5], [12, 6]] as Vec2[] },
    ];
    const raster = createMaskRaster(40, 20, 1);
    raster.render(null, 0, ops, resolve);
    const colourAt = (x: number, y: number) => Array.from(raster.readColour()!.subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 4));
    expect(colourAt(10, 5)).toEqual([255, 0, 0, 255]);
    expect(colourAt(11, 5)).toEqual([0, 0, 255, 255]);
    expect(colourAt(12, 5)[3]).toBe(0);
    expect(Math.abs(raster.read()[5 * 40 + 11] - Math.round(255 * (127 / 255) * (191 / 255)))).toBeLessThanOrEqual(2);
    // Restoring gives the pixels back their own colour as well as their alpha.
    raster.render(null, 0, [...ops, { mode: "restore", size: 2, points: [[10.5, 5.5]] }], resolve);
    expect(colourAt(10, 5)[3]).toBe(0);
    expect(raster.read()[5 * 40 + 10]).toBe(255);
    // No colour op, no colour canvas.
    raster.render(null, 0, [{ mode: "erase", size: 2, points: [[3, 3]] }], resolve);
    expect(raster.colourCanvas).toBeNull();
    raster.dispose();
  });

  test("a red disc magic-erased off grey keeps no grey rim: the soft edge is red at partial alpha", () => {
    const W = 256;
    const canvas = new OffscreenCanvas(W, W);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgb(128, 128, 128)";
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = "rgb(230, 20, 20)";
    ctx.beginPath();
    ctx.arc(128, 128, 70.3, 0, Math.PI * 2);
    ctx.fill();
    const { data } = ctx.getImageData(0, 0, W, W);
    const erased = magicErase({ width: W, height: W, data }, [12, 12], { tolerance: 32, antiAlias: true, contiguous: true, opacity: 100, sampleSize: 1 })!;
    const source: MaskRaster = { width: erased.width, height: erased.height, data: erased.data, colour: erased.colour };
    const mask = createMaskRaster(W, W, 1);
    mask.render(null, 0, [{ kind: "raster", mode: "erase", raster: 1, points: [[erased.x, erased.y], [erased.x + erased.width, erased.y + erased.height]] }], (id) => (id === 1 ? source : null));
    const alpha = mask.read();
    const colour = mask.readColour()!;
    let edge = 0;
    let greyBefore = 0;
    const rim: string[] = [];
    for (let i = 0; i < W * W; i++) {
      if (alpha[i] <= 12 || alpha[i] >= 243) continue;
      edge++;
      const own = colour[i * 4 + 3] === 255;
      const [r, g, b] = own ? colour.subarray(i * 4, i * 4 + 3) : data.subarray(i * 4, i * 4 + 3);
      if (!(r > 200 && g < 60 && b < 60)) rim.push(`(${i % W},${Math.floor(i / W)}) α=${alpha[i]} rgb=${r},${g},${b}`);
      if (data[i * 4 + 1] >= 60) greyBefore++;
    }
    expect(edge).toBeGreaterThan(200);
    expect(rim.slice(0, 5)).toEqual([]);
    // Without the colours those pixels would carry the grey they were blended with.
    expect(greyBefore).toBeGreaterThan(edge / 2);
    mask.dispose();
  });

  test("the magic eraser on 4 megapixels, in the browser", () => {
    const W = 2048;
    const data = new Uint8ClampedArray(W * W * 4);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const inside = (x - 1024) ** 2 + (y - 1024) ** 2 < 600 ** 2;
        const n = (x * 7 + y * 13) % 9;
        data[p] = inside ? 210 : 110 + n;
        data[p + 1] = inside ? 40 : 130 + n;
        data[p + 2] = inside ? 40 : 150 + n;
        data[p + 3] = 255;
      }
    }
    const image = { width: W, height: W, data };
    const report: string[] = [];
    for (const contiguous of [true, false]) {
      for (const antiAlias of [true, false]) {
        const runs: number[] = [];
        for (let i = 0; i < 7; i++) {
          const started = performance.now();
          magicErase(image, [5, 5], { tolerance: 32, antiAlias, contiguous, opacity: 100, sampleSize: 1 });
          runs.push(performance.now() - started);
        }
        runs.sort((a, b) => a - b);
        report.push(`${contiguous ? "contiguous" : "global"}${antiAlias ? "+aa" : ""} ${runs[0].toFixed(1)}/${runs[3].toFixed(1)}`);
        expect(runs[3]).toBeLessThan(100);
      }
    }
    console.info(`[magic eraser] 2048² best/median ms: ${report.join(", ")}`);
  });

  test("live-wire replies while tracing a 2048² image with a 64 px Width stay within a frame", async () => {
    const W = 2048;
    const canvas = new OffscreenCanvas(W, W);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgb(200, 205, 210)";
    ctx.fillRect(0, 0, W, W);
    // Texture, so that the flat areas are not free to cross.
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = `rgba(${(i * 37) % 255}, ${(i * 91) % 255}, ${(i * 53) % 255}, 0.15)`;
      ctx.fillRect((i * 7919) % W, (i * 104729) % W, 6 + (i % 20), 6 + (i % 13));
    }
    ctx.fillStyle = "rgb(40, 60, 170)";
    ctx.beginPath();
    ctx.arc(1024, 1024, 700, 0, Math.PI * 2);
    ctx.fill();
    const { data } = ctx.getImageData(0, 0, W, W);

    const worker = createLiveWireWorker();
    const roundTrips: number[] = [];
    const inWorker: number[] = [];
    const timed: LiveWireBackend = {
      prepare: (image) => worker.prepare(image),
      snap: (p, r, c) => worker.snap(p, r, c),
      dispose: () => worker.dispose(),
      async path(from, to, options) {
        const started = performance.now();
        const r = await worker.path(from, to, options);
        roundTrips.push(performance.now() - started);
        inWorker.push(r.ms);
        return r;
      },
    };
    try {
      const started = performance.now();
      await timed.prepare({ width: W, height: W, data });
      const prepareMs = performance.now() - started;
      const lasso = createMagneticLasso(timed, {
        width: () => 64,
        contrast: () => contrastLevels(10),
        spacing: () => fasteningSpacing(57),
        onChange: () => {},
      });
      const at = (a: number): Vec2 => [1024 + 700 * Math.cos(a), 1024 + 700 * Math.sin(a)];
      await lasso.click(at(0));
      // A quarter of the circle, a move every 3 px, each waited for (as a pointer at 60 Hz would be).
      for (let a = 0.004; a <= Math.PI / 2; a += 0.0043) {
        lasso.move(at(a));
        await lasso.idle();
      }
      const onEdge = (x: number, y: number) => Math.abs(Math.hypot(x + 0.5 - 1024, y + 0.5 - 1024) - 700) <= 2;
      for (const seg of lasso.state.segments) {
        for (let i = 0; i < seg.length; i += 2) expect(onEdge(seg[i], seg[i + 1]), `(${seg[i]},${seg[i + 1]})`).toBe(true);
      }
      expect(lasso.state.anchors.length).toBeGreaterThan(15);
      const stats = (v: number[]) => {
        const s = [...v].sort((a, b) => a - b);
        return { p50: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] };
      };
      const w = stats(inWorker);
      const r = stats(roundTrips);
      console.info(
        `[live wire] 2048², Width 64: edge map ${prepareMs.toFixed(0)} ms; ${inWorker.length} replies, ` +
          `in worker p50 ${w.p50.toFixed(1)} / p95 ${w.p95.toFixed(1)} / max ${w.max.toFixed(1)} ms, ` +
          `round trip p50 ${r.p50.toFixed(1)} / p95 ${r.p95.toFixed(1)} / max ${r.max.toFixed(1)} ms`,
      );
      expect(w.p95).toBeLessThan(16);
      expect(r.p50).toBeLessThan(16);

      // Frequency 0: no automatic points, so each search covers the whole way from the click.
      inWorker.length = 0;
      roundTrips.length = 0;
      const long = createMagneticLasso(timed, { width: () => 64, contrast: () => contrastLevels(10), spacing: () => Infinity, onChange: () => {} });
      await long.click(at(Math.PI));
      for (let a = Math.PI + 0.004; a <= Math.PI + Math.PI / 4; a += 0.0043) {
        long.move(at(a));
        await long.idle();
      }
      const lw = stats(inWorker);
      console.info(
        `[live wire] 2048², Width 64, Frequency 0 (an eighth of the circle, ${pathLengthOf(long.state.live!)} px from the click): ` +
          `in worker p50 ${lw.p50.toFixed(1)} / p95 ${lw.p95.toFixed(1)} / max ${lw.max.toFixed(1)} ms`,
      );
      expect(lw.p50).toBeLessThan(16);
    } finally {
      timed.dispose();
    }
  }, 60_000);
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

  test("magnetic lasso: traced along a red square's sides and closed → the cut follows the square within 2 px", async () => {
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

    // Near (not on) the sides, as a hand traces: the Width finds the edge. Up the left side, along
    // the top, a little down the right; Enter closes back round the bottom along the edges.
    click(store, [66, 120]);
    await until(() => document.querySelectorAll("[data-fastening-point]").length >= 1);
    for (let y = 116; y >= 66; y -= 4) pointer(store, "pointermove", [65, y]);
    for (let x = 68; x <= 190; x += 4) pointer(store, "pointermove", [x, 66]);
    for (let y = 70; y <= 136; y += 4) pointer(store, "pointermove", [190, y]);
    click(store, [190, 136]);
    await until(() => document.querySelectorAll("[data-fastening-point]").length >= 3);
    // The path is a thin line, the fastening points small squares.
    expect(document.querySelector("[data-magnetic-path]")?.getAttribute("stroke-width")).toBe("1");
    expect(document.querySelector("[data-fastening-point]")?.getAttribute("width")).toBe("5");
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

    // The outline pass draws round what the eraser left: the disc (radius 140 output px), 6 px out.
    store.setOutline("enabled", true);
    store.setOutline("radius", 6);
    store.setOutline("color", "#00ff00");
    const outlined = await finish(wrapper, store, 1);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2]]) {
      expect(rgbaAt(outlined, 256 + dx * 143, 256 + dy * 143), `outline at ${dx},${dy}`).toEqual([0, 255, 0, 255]);
      expect(alphaAt(outlined, 256 + dx * 160, 256 + dy * 160), `beyond the outline at ${dx},${dy}`).toBe(0);
    }
  }, 30_000);

  test("magic eraser: a red disc cut from grey has a red soft edge in the file, no grey rim", async () => {
    const src = await blobUrl(...MEDIA, (ctx) => {
      ctx.fillStyle = "rgb(128, 128, 128)";
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "rgb(230, 20, 20)";
      ctx.beginPath();
      ctx.arc(128, 128, 70.3, 0, Math.PI * 2);
      ctx.fill();
    });
    const { wrapper, store } = await openEditor(src);
    await pickTool(store, "magicEraser");
    expect(store.uiState.cutoutOptions).toMatchObject({ magicTolerance: 32, magicAntiAlias: true, contiguous: true });
    click(store, [12, 12]);
    await nextTick();
    const op = store.mediaState.mask.strokes[0];
    expect(op).toMatchObject({ kind: "raster" });
    expect(op.kind === "raster" && store.getMaskSource(op.raster)?.colour?.length).toBeGreaterThan(0);

    const img = await finish(wrapper, store);
    // Every partly transparent pixel round the disc (radius 140 output px) is the disc's red.
    let partial = 0;
    const rim: string[] = [];
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const [r, g, b, a] = rgbaAt(img, x, y);
        if (a <= 12 || a >= 243) continue;
        partial++;
        if (!(r > 200 && g < 60 && b < 60)) rim.push(`(${x},${y}) rgba=${r},${g},${b},${a}`);
      }
    }
    expect(partial).toBeGreaterThan(300);
    expect(rim.slice(0, 5)).toEqual([]);
    expect(rgbaAt(img, 256, 256)).toEqual([230, 20, 20, 255]);
    expect(alphaAt(img, 20, 20)).toBe(0);
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
    // Photoshop's defaults: continuous sampling, contiguous limits; this stroke samples once.
    expect(store.uiState.cutoutOptions).toMatchObject({ sampling: "continuous", limits: "contiguous" });
    document.querySelector<HTMLButtonElement>('[data-option="sampling"] [data-value="once"]')!.click();
    await nextTick();
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
