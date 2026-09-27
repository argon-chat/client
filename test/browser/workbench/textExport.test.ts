/**
 * Text layers reach the export: in the default font and in a custom one (drawn with that face, which
 * the export loads itself), where the editor shows them, through a zoomed crop turned a quarter, in
 * sticker mode, and — with the editor mounted — exactly where the preview lays the glyphs out.
 *
 * The custom fonts come from a Google Fonts stylesheet the editor adds as `#media-editor-fonts`. These
 * tests put their own stylesheet under that id first, so nothing goes to the network: every custom
 * family is Press Start 2P, a local face whose glyphs are a full em wide, which no fallback can pass for.
 *
 * WebGPU: skipped without an adapter; run with `ARGON_TEST_GPU=1`.
 */

import "../../../packages/assets/styles/index.css";
import pressStartUrl from "../../../packages/assets/fonts/Press_Start_2P/PressStart2P-Regular.ttf?url";
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
  type EditorLayer,
  type EditorMode,
  type MediaEditorFinalResult,
  type TextStyle,
  type Vec2,
} from "@argon/media-editor";
import { fitToAspectRatio, rotatePoint } from "../../../packages/media-editor/src/geometry";

const adapter = typeof navigator !== "undefined" && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const SKIP = adapter ? "" : " — skipped: no WebGPU adapter (set ARGON_TEST_GPU=1)";

type Img = { data: Uint8ClampedArray; width: number; height: number };
type Rect = { x0: number; y0: number; x1: number; y1: number };
type Ink = Rect & { count: number };

const MEDIA: Vec2 = [800, 600];
const CANVAS: Vec2 = [880, 716];
const CENTRE: Vec2 = [CANVAS[0] / 2, CANVAS[1] / 2];
const BG = [40, 44, 52];
const PURPLE = "#bd5cf3";
const PURPLE_RGB = [189, 92, 243];
const LINE = 48; // 40 px at line-height 1.2
const CUSTOM_FAMILIES = ["Suez One", "Rubik Bubbles", "Playwrite BE VLG", "Chewy", "Courier Prime", "Fugaz One", "Sedan"];

function installFonts(): void {
  if (document.querySelector("#media-editor-fonts[data-test]")) return;
  document.getElementById("media-editor-fonts")?.remove();
  const src = new URL(pressStartUrl, location.href).href;
  const css = CUSTOM_FAMILIES.map((family) => `@font-face { font-family: '${family}'; src: url("${src}") format("truetype"); font-weight: 100 900; }`).join("\n");
  const link = document.createElement("link");
  link.id = "media-editor-fonts";
  link.rel = "stylesheet";
  link.dataset.test = "";
  link.href = URL.createObjectURL(new Blob([css], { type: "text/css" }));
  document.head.appendChild(link);
}

const faces = (family: string) => [...document.fonts].filter((f) => f.family.replace(/^["']|["']$/g, "") === family);

async function solid([w, h]: Vec2): Promise<string> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `rgb(${BG.join(", ")})`;
  ctx.fillRect(0, 0, w, h);
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

const at = (img: Img, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/** Bounds of every pixel that is not the background, optionally only those `keep` accepts. */
function ink(img: Img, keep: (px: number[], x: number, y: number) => boolean = () => true): Ink | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, count = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const px = at(img, x, y);
      const d = Math.max(Math.abs(px[0] - BG[0]), Math.abs(px[1] - BG[1]), Math.abs(px[2] - BG[2]), 255 - px[3]);
      if (d <= 60 || !keep(px, x, y)) continue;
      count++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return count ? { x0, y0, x1: x1 + 1, y1: y1 + 1, count } : null;
}

const near = (px: number[], rgb: number[], d = 16) => px[3] === 255 && rgb.every((v, i) => Math.abs(v - px[i]) <= d);

const fmt = (r: Rect) => `(${r.x0.toFixed(1)}, ${r.y0.toFixed(1)}) → (${r.x1.toFixed(1)}, ${r.y1.toFixed(1)})`;

function expectInside(box: Rect, rect: Rect, tolerance = 2) {
  const msg = `ink ${fmt(box)} inside ${fmt(rect)}`;
  expect(box.x0, msg).toBeGreaterThanOrEqual(rect.x0 - tolerance);
  expect(box.y0, msg).toBeGreaterThanOrEqual(rect.y0 - tolerance);
  expect(box.x1, msg).toBeLessThanOrEqual(rect.x1 + tolerance);
  expect(box.y1, msg).toBeLessThanOrEqual(rect.y1 + tolerance);
}

function expectSame(box: Rect, rect: Rect, tolerance = 2) {
  const msg = `ink ${fmt(box)} is ${fmt(rect)}`;
  for (const side of ["x0", "y0", "x1", "y1"] as const) expect(Math.abs(box[side] - rect[side]), `${side}: ${msg}`).toBeLessThanOrEqual(tolerance);
}

function measure(font: string, text: string): TextMetrics {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = font;
  return ctx.measureText(text);
}

const inkWidth = (m: TextMetrics) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight;

/** What the editor shows as the crop — contained in the canvas, centred — is the output. */
function toOutput(canvas: Vec2, out: Vec2, cropRatio: number) {
  const [cw, ch] = fitToAspectRatio(cropRatio, canvas[0], canvas[1]);
  const k = Math.max(out[0] / cw, out[1] / ch);
  return { k, map: ([x, y]: Vec2): Vec2 => [(x - canvas[0] / 2) * k + out[0] / 2, (y - canvas[1] / 2) * k + out[1] / 2] };
}

/** A `w × h` block centred on `centre` (output px), turned and scaled about it: its bounds. */
function blockRect(centre: Vec2, [w, h]: Vec2, rotation: number, scale: number, k: number): Rect {
  const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => rotatePoint([x * scale * k, y * scale * k], rotation));
  const xs = corners.map((p) => p[0] + centre[0]);
  const ys = corners.map((p) => p[1] + centre[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** The editor state a crop to `rect` (source pixels) leaves, turned by `quarterTurns` (as in cropExport). */
function cropTo(canvas: Vec2, media: Vec2, rect: { x: number; y: number; w: number; h: number }, quarterTurns = 0) {
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

let nextId = 1;
function textLayer(text: Partial<TextStyle> & { content: string }, position: Vec2, rotation = 0, scale = 1): EditorLayer {
  return {
    id: nextId++,
    type: "text",
    position,
    rotation,
    scale,
    textInfo: { color: PURPLE, alignment: "left", style: "normal", size: 40, font: "suez", ...text },
  };
}

async function exportLayers(src: string, layers: EditorLayer[], opts: { mode?: EditorMode; canvas?: Vec2; state?: object } = {}) {
  const { mode = "full", canvas = CANVAS, state = {} } = opts;
  const store = useMediaEditorStore();
  store.init({ src, type: "image", mode });
  Object.assign(store.mediaState, state);
  store.mediaState.resizableLayers = layers;
  const result = await createFinalResult({
    mediaSrc: src,
    mediaType: "image",
    mediaState: store.mediaState,
    canvasSize: canvas,
    mediaRatio: MEDIA[0] / MEDIA[1],
    renderingPayload: { media: { width: MEDIA[0], height: MEDIA[1] } },
    mode,
    getMaskSource: store.getMaskSource,
    exportFormat: "png",
  });
  const { blob } = await result.getResult();
  return { img: await pixels(blob), width: result.width, height: result.height };
}

describe.skipIf(!adapter)(`text layers → export on the GPU${SKIP}`, () => {
  let src = "";
  beforeEach(async () => {
    setActivePinia(createPinia());
    src ||= await solid(MEDIA);
  });

  // First on purpose: nothing in this document has asked for the face before the export does.
  test("a custom font: the export loads the face itself and draws the text with it, where the layer is", async () => {
    expect(faces("Suez One")).toEqual([]);
    // Still loading when the export starts.
    installFonts();

    const { img, width, height } = await exportLayers(src, [textLayer({ content: "iiii" }, CENTRE)]);
    expect(faces("Suez One").map((f) => f.status)).toEqual(["loaded"]);
    expect([width, height]).toEqual(MEDIA);

    const { k, map } = toOutput(CANVAS, [width, height], MEDIA[0] / MEDIA[1]);
    const m = measure("400 40px 'Suez One'", "iiii");
    const box = ink(img);
    expect(box, "the export has no text").not.toBeNull();
    expectInside(box!, blockRect(map(CENTRE), [m.width, LINE], 0, 1, k));
    // Four em-wide cells; the fallback face's `iiii` is a fraction of that.
    const want = inkWidth(m) * k;
    expect(Math.abs(want - inkWidth(measure("400 40px serif", "iiii")) * k)).toBeGreaterThan(40);
    expect(Math.abs(box!.x1 - box!.x0 - want), `ink width ${box!.x1 - box!.x0}, want ${want.toFixed(1)}`).toBeLessThanOrEqual(3);
    expect(ink(img, (px) => near(px, PURPLE_RGB))!.count / box!.count).toBeGreaterThan(0.5);

    const without = await exportLayers(src, []);
    expect(ink(without.img)).toBeNull();
  });

  test("the default font and style (Roboto, white outline): drawn, where the layer is", async () => {
    const pos: Vec2 = [300, 250];
    const layer = textLayer({ content: "Text", font: "roboto", style: "outline", color: "#ffffff" }, pos);
    const { img, width, height } = await exportLayers(src, [layer]);

    const { k, map } = toOutput(CANVAS, [width, height], MEDIA[0] / MEDIA[1]);
    const m = measure("500 40px 'Roboto'", "Text");
    const box = ink(img);
    expect(box, "the export has no text").not.toBeNull();
    // The 2 px stroke reaches 1 px past the glyphs.
    expectInside(box!, blockRect(map(pos), [m.width + 2, LINE + 2], 0, 1, k));
    const want = (inkWidth(m) + 2) * k;
    expect(Math.abs(box!.x1 - box!.x0 - want), `ink width ${box!.x1 - box!.x0}, want ${want.toFixed(1)}`).toBeLessThanOrEqual(3);
  });

  test("background style, two centred lines: the rounded box in the colour, the text in its contrast", async () => {
    installFonts();
    const layer = textLayer({ content: "iiii\nii", font: "chewy", style: "background", color: "#ffd60a", alignment: "center" }, CENTRE);
    const { img, width, height } = await exportLayers(src, [layer]);

    const { k, map } = toOutput(CANVAS, [width, height], MEDIA[0] / MEDIA[1]);
    const long = measure("400 40px 'Chewy'", "iiii");
    const short = measure("400 40px 'Chewy'", "ii");
    const [cx, cy] = map(CENTRE);
    // The text block plus the 8 × 4 px padding.
    const rect = blockRect([cx, cy], [long.width + 16, 2 * LINE + 8], 0, 1, k);
    const box = ink(img);
    expect(box, "the export has no text").not.toBeNull();
    expectSame(box!, rect);
    expect(near(at(img, Math.round(rect.x0 + 4), Math.round(cy)), [255, 214, 10])).toBe(true);

    // #ffd60a is 52 % light, under the 80 % that turns the text black.
    expect(ink(img, (px) => near(px, [255, 255, 255], 24)), "no white text").not.toBeNull();
    // The second line's glyphs, edges included: only white brings blue into the yellow.
    const second = ink(img, (px, _x, y) => y > cy && px[2] > 60);
    expect(second, "no second line").not.toBeNull();
    expect(Math.abs((second!.x0 + second!.x1) / 2 - cx), "the second line is centred").toBeLessThanOrEqual(2);
    expect(Math.abs(second!.x1 - second!.x0 - inkWidth(short) * k)).toBeLessThanOrEqual(3);
  });

  test("through a zoomed crop turned a quarter, a turned and scaled layer lands where it is shown", async () => {
    installFonts();
    const state = cropTo(CANVAS, MEDIA, { x: 200, y: 150, w: 400, h: 300 }, 1);
    const pos: Vec2 = [CENTRE[0] + 60, CENTRE[1] - 40];
    const { img, width, height } = await exportLayers(src, [textLayer({ content: "iiii" }, pos, Math.PI / 2, 1.5)], { state });
    expect([width, height]).toEqual([300, 400]);

    const { k, map } = toOutput(CANVAS, [width, height], state.currentImageRatio);
    const m = measure("400 40px 'Suez One'", "iiii");
    const box = ink(img);
    expect(box, "the export has no text").not.toBeNull();
    expectInside(box!, blockRect(map(pos), [m.width, LINE], Math.PI / 2, 1.5, k));
    // Turned clockwise: the line runs down the output.
    const want = inkWidth(m) * 1.5 * k;
    expect(Math.abs(box!.y1 - box!.y0 - want), `ink height ${box!.y1 - box!.y0}, want ${want.toFixed(1)}`).toBeLessThanOrEqual(3);
  });

  test("sticker mode: the text keeps its colour and full alpha", async () => {
    installFonts();
    const canvas: Vec2 = [800, 600];
    const { img, width, height } = await exportLayers(src, [textLayer({ content: "iiii" }, [400, 300])], { mode: "sticker", canvas });
    expect([width, height]).toEqual([512, 384]);

    const { k, map } = toOutput(canvas, [width, height], MEDIA[0] / MEDIA[1]);
    const m = measure("400 40px 'Suez One'", "iiii");
    const box = ink(img);
    expect(box, "the export has no text").not.toBeNull();
    expectInside(box!, blockRect(map([400, 300]), [m.width, LINE], 0, 1, k));
    expect(ink(img, (px) => near(px, PURPLE_RGB))!.count / box!.count).toBeGreaterThan(0.5);
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

const button = (text: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".media-editor__container button")).find((b) => b.textContent?.trim().includes(text))!;

describe.skipIf(!adapter)(`text → export through the editor${SKIP}`, () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
    installFonts();
  });
  afterEach(() => {
    for (const w of mounted.splice(0)) w.unmount();
  });

  test("a custom font picked in the text tab: the export has the glyphs exactly where the preview draws them", async () => {
    const { wrapper, store } = await openEditor(await solid(MEDIA), "full", "text");
    button("media_editor_font_suez").click();
    button("media_editor_add_text").click();
    await nextTick();

    const layerEl = document.querySelector<HTMLElement>(".media-editor__container .cursor-move")!;
    layerEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await nextTick();
    const area = document.querySelector<HTMLTextAreaElement>(".media-editor__container textarea")!;
    area.value = "iiiiii\nii";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    area.dispatchEvent(new FocusEvent("blur"));
    await nextTick();
    expect(store.mediaState.resizableLayers[0].textInfo).toMatchObject({ font: "suez", content: "iiiiii\nii" });

    // The preview's glyphs, from the text's own boxes: each spans the face's ascent + descent, so
    // the baseline is its top plus the ascent.
    const textEl = layerEl.querySelector<HTMLElement>("div")!;
    await until(() => textEl.getBoundingClientRect().width > 200);
    const origin = layerEl.parentElement!.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const lines = [...range.getClientRects()].filter((r) => r.width > 1);
    expect(lines).toHaveLength(2);
    const font = "400 40px 'Suez One'";
    const face = measure(font, "i");
    const shown: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    lines.forEach((r, i) => {
      expect(Math.abs(r.height - (face.fontBoundingBoxAscent + face.fontBoundingBoxDescent))).toBeLessThanOrEqual(1);
      const m = measure(font, i === 0 ? "iiiiii" : "ii");
      const left = r.left - origin.left;
      const baseline = r.top - origin.top + face.fontBoundingBoxAscent;
      // Default style: a 2 px white outline, 1 px past the glyphs.
      shown.x0 = Math.min(shown.x0, left - m.actualBoundingBoxLeft - 1);
      shown.x1 = Math.max(shown.x1, left + m.actualBoundingBoxRight + 1);
      shown.y0 = Math.min(shown.y0, baseline - m.actualBoundingBoxAscent - 1);
      shown.y1 = Math.max(shown.y1, baseline + m.actualBoundingBoxDescent + 1);
    });
    const canvas = [...store.uiState.canvasSize!] as Vec2;

    await until(() => !store.uiState.isMoving);
    button("Done").click();
    await until(() => !!wrapper.emitted("done"));
    const result = wrapper.emitted("done")![0][0] as MediaEditorFinalResult;
    const img = await pixels((await result.getResult()).blob);

    const { map } = toOutput(canvas, [img.width, img.height], MEDIA[0] / MEDIA[1]);
    const [x0, y0] = map([shown.x0, shown.y0]);
    const [x1, y1] = map([shown.x1, shown.y1]);
    const box = ink(img);
    expect(box, "the export has no text").not.toBeNull();
    expectSame(box!, { x0, y0, x1, y1 });
  }, 30_000);
});
