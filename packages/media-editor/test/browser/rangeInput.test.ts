/** Real pointer capture: leave a track, release elsewhere, re-enter without a stuck drag. */
import { afterEach, describe, expect, test } from "vitest";
import { commands } from "vitest/browser";
import { createApp, h, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import RangeInput from "../../src/components/RangeInput.vue";
import { MEDIA_EDITOR_INJECTION_KEY } from "../../src/composables/useMediaEditorContext";
import { useMediaEditorStore } from "../../src/store/editorStore";

declare module "vitest/browser" {
  interface BrowserCommands {
    rangePointer(phase: string, fraction?: number, dy?: number): Promise<void>;
  }
}

let app: App | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await commands.rangePointer("release");
  app?.unmount();
  container?.remove();
  app = undefined;
  container = undefined;
});

async function fixture() {
  const pinia = createPinia();
  const store = useMediaEditorStore(pinia);
  store.init({ src: "blob:range-fixture", type: "image", mode: "full" });
  container = document.createElement("div");
  container.style.cssText = "position:fixed;left:120px;top:120px;width:300px;";
  document.body.append(container);
  app = createApp({ render: () => h(RangeInput, {
    compact: true, min: -1, max: 1,
    modelValue: store.mediaState.adjustments.brightness,
    "onUpdate:modelValue": (value: number) => store.set(["adjustments", "brightness"], value),
  }) });
  app.use(pinia);
  app.provide(MEDIA_EDITOR_INJECTION_KEY, { store, mode: "full", interactions: { register: () => () => {}, cancel: () => false } });
  app.mount(container);
  await nextTick();
  const track = container.querySelector<HTMLElement>(".range-input__track")!;
  // This standalone package test does not import the host's Tailwind sheet.
  track.style.cssText = "position:relative;display:block;width:200px;height:24px;";
  return { store, track };
}

describe("range drag lifecycle", () => {
  test("dragging outside the track continues, and releasing outside ends exactly one edit", async () => {
    const { store, track } = await fixture();
    let pointer = 0;
    track.addEventListener("pointerdown", (e) => { pointer = e.pointerId; });
    await commands.rangePointer("down");
    expect(track.hasPointerCapture(pointer)).toBe(true);
    await commands.rangePointer("move", 1.5, 90);
    expect(store.mediaState.adjustments.brightness).toBe(1);
    await commands.rangePointer("up", 1.5, 90);
    expect(track.hasPointerCapture(pointer)).toBe(false);
    expect(store.uiState.gesture).toBe(false);
    expect(store.mediaState.history).toHaveLength(1);
    await commands.rangePointer("move", 0.1);
    expect(store.mediaState.adjustments.brightness).toBe(1);
    store.undo();
    expect(store.mediaState.adjustments.brightness).toBe(0);
  });

  test("lost capture, window blur, and unmount all detach active move handlers", async () => {
    const { store, track } = await fixture();
    let pointer = 0;
    track.addEventListener("pointerdown", (e) => { pointer = e.pointerId; });
    await commands.rangePointer("down", 0.75);
    track.releasePointerCapture(pointer);
    await commands.rangePointer("move", 0.9);
    expect(store.uiState.gesture).toBe(false);
    expect(store.mediaState.adjustments.brightness).toBe(0.5);
    await commands.rangePointer("up", 0.9);

    await commands.rangePointer("down", 0.9);
    window.dispatchEvent(new Event("blur"));
    expect(store.uiState.gesture).toBe(false);
    expect(store.mediaState.adjustments.brightness).toBe(0.5);
    await commands.rangePointer("up");

    await commands.rangePointer("down", 0.1);
    app!.unmount();
    app = undefined;
    expect(store.uiState.gesture).toBe(false);
    expect(store.mediaState.adjustments.brightness).toBe(0.5);
    expect(track.hasPointerCapture(pointer)).toBe(false);
  });
});
