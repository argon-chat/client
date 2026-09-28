/**
 * Undo and redo through the editor's keys: a crop, a text layer and a magic erase are three steps,
 * Ctrl+Z takes them back one by one and Ctrl+Shift+Z (or Ctrl+Y) brings them back, whatever the
 * keyboard layout; a slider drag is one step; keys typed into a text field stay the field's.
 * Needs WebGPU (`ARGON_TEST_GPU=1`) to mount the editor; skipped otherwise.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { page } from "vitest/browser";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { MediaEditor, useMediaEditorStore, type Vec2 } from "@argon/media-editor";
import { sourceToCanvas } from "../../../packages/media-editor/src/mask/maskMath";

const adapter = typeof navigator !== "undefined" && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const SKIP = adapter ? "" : " — skipped: no WebGPU adapter (set ARGON_TEST_GPU=1)";

/** Wider than tall, so that a 1:1 crop changes the ratio and the zoom. */
const MEDIA: Vec2 = [320, 200];
const mounted: VueWrapper[] = [];

async function until(check: () => boolean, timeout = 15_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

async function source(): Promise<string> {
  const canvas = new OffscreenCanvas(...MEDIA);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(60, 170, 90)";
  ctx.fillRect(0, 0, ...MEDIA);
  ctx.fillStyle = "rgb(30, 60, 220)";
  ctx.beginPath();
  ctx.arc(160, 100, 60, 0, Math.PI * 2);
  ctx.fill();
  return URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
}

async function openEditor() {
  const pinia = createPinia();
  const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false, messages: { en: {} } });
  const wrapper = mount(MediaEditor, {
    props: { modelValue: true, src: await source(), mediaType: "image", mode: "sticker", exportFormat: "png" },
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

const settled = (store: Store) => until(() => !store.uiState.gesture && !store.uiState.isMoving);

async function tab(store: Store, id: string) {
  document.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)!.click();
  await nextTick();
  await settled(store);
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>(".media-editor__container button")).find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

function clickImage(store: Store, p: Vec2) {
  const overlay = document.querySelector<HTMLElement>("[data-cutout-overlay]")!;
  const rect = overlay.getBoundingClientRect();
  const dpr = store.uiState.pixelRatio;
  const [cw, ch] = store.uiState.canvasSize!;
  const c = sourceToCanvas(p, store.uiState.finalTransform, [Math.round(cw * dpr), Math.round(ch * dpr)], MEDIA);
  const at = { clientX: rect.left + c[0] / dpr, clientY: rect.top + c[1] / dpr, pointerId: 1, button: 0, bubbles: true, cancelable: true };
  overlay.dispatchEvent(new PointerEvent("pointerdown", { ...at, buttons: 1 }));
  overlay.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0 }));
}

/** Ctrl + a letter key; `key` is what the layout types there (я on a Russian layout for Z). */
function shortcut(code: string, options: { shift?: boolean; key?: string; target?: EventTarget } = {}) {
  const letter = code.slice(3).toLowerCase();
  const key = options.key ?? (options.shift ? letter.toUpperCase() : letter);
  const event = new KeyboardEvent("keydown", { key, code, ctrlKey: true, shiftKey: !!options.shift, bubbles: true, cancelable: true });
  (options.target ?? document.body).dispatchEvent(event);
  return event;
}

describe.skipIf(!adapter)(`undo and redo in the editor${SKIP}`, () => {
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });
  afterEach(() => {
    for (const w of mounted.splice(0)) w.unmount();
  });

  test("crop, text, magic erase: Ctrl+Z three times takes them back, Ctrl+Shift+Z three times brings them back", async () => {
    const { store } = await openEditor();
    const original = store.mediaState.currentImageRatio;
    expect(original).toBeCloseTo(1.6, 5);

    // Crop to 1:1: the ratio, its key and the zoom, one step once the animation is over.
    await tab(store, "crop");
    button("1:1").click();
    await settled(store);
    expect(store.mediaState.currentImageRatio).toBe(1);
    expect(store.uiState.fixedImageRatioKey).toBe("1x1");
    const croppedScale = store.mediaState.scale;
    expect(croppedScale).toBeGreaterThan(1);
    expect(store.mediaState.history).toHaveLength(1);

    // A text layer.
    await tab(store, "text");
    button("media_editor_add_text").click();
    await nextTick();
    expect(store.mediaState.resizableLayers).toHaveLength(1);
    expect(store.mediaState.history).toHaveLength(2);

    // The magic eraser on the green.
    await tab(store, "cutout");
    document.querySelector<HTMLButtonElement>('[data-cutout-tool="magicEraser"]')!.click();
    await until(() => !!document.querySelector('[data-cutout-overlay="magicEraser"]'));
    clickImage(store, [10, 10]);
    await nextTick();
    expect(store.mediaState.mask.strokes).toMatchObject([{ kind: "raster", mode: "erase" }]);
    expect(store.mediaState.history).toHaveLength(3);
    expect(store.isDirty).toBe(true);

    expect(shortcut("KeyZ").defaultPrevented).toBe(true);
    expect(store.mediaState.mask.strokes).toHaveLength(0);
    expect(store.mediaState.resizableLayers).toHaveLength(1);
    shortcut("KeyZ");
    expect(store.mediaState.resizableLayers).toHaveLength(0);
    expect(store.mediaState.currentImageRatio).toBe(1);
    shortcut("KeyZ");
    expect(store.mediaState.currentImageRatio).toBeCloseTo(original, 5);
    expect(store.mediaState.scale).toBe(1);
    expect(store.uiState.fixedImageRatioKey).toBeUndefined();
    expect(store.mediaState.history).toHaveLength(0);
    expect(store.isDirty).toBe(false);
    // Nothing left to undo: a no-op.
    shortcut("KeyZ");
    expect(store.mediaState.redoHistory).toHaveLength(3);

    shortcut("KeyZ", { shift: true });
    expect(store.mediaState.currentImageRatio).toBe(1);
    expect(store.mediaState.scale).toBeCloseTo(croppedScale, 5);
    expect(store.uiState.fixedImageRatioKey).toBe("1x1");
    shortcut("KeyZ", { shift: true });
    expect(store.mediaState.resizableLayers).toHaveLength(1);
    shortcut("KeyZ", { shift: true });
    expect(store.mediaState.mask.strokes).toHaveLength(1);
    expect(store.mediaState.redoHistory).toHaveLength(0);
    expect(store.isDirty).toBe(true);
  }, 30_000);

  test("Ctrl+Y redoes; a Russian layout's Ctrl+Я undoes; a drag on a slider is one step", async () => {
    const { store } = await openEditor();
    await tab(store, "adjustments");
    // Drag the first slider (Enhance) from its start to about 70 % in several moves.
    const track = document.querySelector<HTMLElement>(".media-editor__container .range-input .relative")!;
    const rect = track.getBoundingClientRect();
    const at = (f: number) => ({ clientX: rect.left + rect.width * f, clientY: rect.top + rect.height / 2, pointerId: 7, button: 0, bubbles: true });
    track.dispatchEvent(new PointerEvent("pointerdown", { ...at(0.1), buttons: 1 }));
    for (const f of [0.2, 0.35, 0.5, 0.6, 0.7]) track.dispatchEvent(new PointerEvent("pointermove", { ...at(f), buttons: 1 }));
    expect(store.uiState.gesture).toBe(true);
    track.dispatchEvent(new PointerEvent("pointerup", { ...at(0.7), buttons: 0 }));
    const enhanced = store.mediaState.adjustments.enhance;
    expect(enhanced).toBeGreaterThan(0.5);
    expect(store.mediaState.history).toHaveLength(1);

    shortcut("KeyZ", { key: "я" });
    expect(store.mediaState.adjustments.enhance).toBe(0);
    shortcut("KeyY");
    expect(store.mediaState.adjustments.enhance).toBe(enhanced);
  }, 30_000);

  test("Ctrl+Z in a text field is the field's own; Esc during a slider drag puts the value back", async () => {
    const { store } = await openEditor();
    store.set(["adjustments", "brightness"], 0.4);
    const input = document.createElement("input");
    input.type = "text";
    document.querySelector(".media-editor__container")!.appendChild(input);
    input.focus();
    const typed = shortcut("KeyZ", { target: input });
    expect(typed.defaultPrevented).toBe(false);
    expect(store.mediaState.adjustments.brightness).toBe(0.4);
    input.remove();

    await tab(store, "adjustments");
    const track = document.querySelector<HTMLElement>(".media-editor__container .range-input .relative")!;
    const rect = track.getBoundingClientRect();
    const at = (f: number) => ({ clientX: rect.left + rect.width * f, clientY: rect.top + rect.height / 2, pointerId: 8, button: 0, bubbles: true });
    track.dispatchEvent(new PointerEvent("pointerdown", { ...at(0.3), buttons: 1 }));
    track.dispatchEvent(new PointerEvent("pointermove", { ...at(0.8), buttons: 1 }));
    expect(store.mediaState.adjustments.enhance).toBeGreaterThan(0.5);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(store.mediaState.adjustments.enhance).toBe(0);
    expect(store.uiState.gesture).toBe(false);
    // The drag is over: later moves do nothing.
    track.dispatchEvent(new PointerEvent("pointermove", { ...at(0.9), buttons: 1 }));
    expect(store.mediaState.adjustments.enhance).toBe(0);
    expect(store.mediaState.history).toHaveLength(1);
  }, 30_000);
});
