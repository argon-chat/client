/**
 * Esc and closing the editor with unsaved changes. Esc first cancels what is in progress (a lasso
 * being drawn); with nothing in progress it closes the editor, asking first when there are changes
 * ("Close the editor?", Cancel / Close without saving) — and it never reaches whatever holds the
 * editor, a settings drawer that closes on Esc. The close button, the backdrop and the holder
 * closing ask the same. The editor is wired as its hosts wire it: the app's confirmation dialog and
 * `useMediaEditorCloseGuard`. Needs WebGPU (`ARGON_TEST_GPU=1`) to mount the editor; skipped otherwise.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { page } from "vitest/browser";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";

const RU: Record<string, string> = vi.hoisted(() => ({
  media_editor_close_title: "Закрыть редактор?",
  media_editor_close_body: "Несохранённые изменения будут потеряны.",
  media_editor_close_cancel: "Отмена",
  media_editor_close_discard: "Закрыть без сохранения",
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => RU[k] ?? k }) }));
import { MediaEditor, useMediaEditorStore, type Vec2 } from "@argon/media-editor";
import { sourceToCanvas } from "../../../packages/media-editor/src/mask/maskMath";
import MediaEditorCloseConfirm from "@/components/common/MediaEditorCloseConfirm.vue";
import { useMediaEditorCloseGuard } from "@/components/common/mediaEditorCloseGuard";

const adapter = typeof navigator !== "undefined" && navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
const SKIP = adapter ? "" : " — skipped: no WebGPU adapter (set ARGON_TEST_GPU=1)";

const MEDIA: Vec2 = [256, 256];

async function until(check: () => boolean, timeout = 15_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

/** Editor, confirmation and a "drawer" holding them, wired like the settings hosts. */
const Host = defineComponent({
  props: { src: { type: String, required: true } },
  setup(props, { expose }) {
    const editorOpen = ref(true);
    const hostOpen = ref(true);
    const cancels = ref(0);
    const { editor, closeConfirm, confirmDiscard } = useMediaEditorCloseGuard({
      open: () => hostOpen.value,
      setOpen: (v) => {
        hostOpen.value = v;
      },
      editorOpen: () => editorOpen.value,
      closeEditor: () => {
        editorOpen.value = false;
      },
    });
    expose({ editorOpen, hostOpen, cancels });
    return () =>
      hostOpen.value
        ? [
            h(MediaEditor, {
              ref: editor,
              modelValue: editorOpen.value,
              "onUpdate:modelValue": (v: boolean) => {
                editorOpen.value = v;
              },
              onCancel: () => cancels.value++,
              src: props.src,
              mediaType: "image",
              mode: "sticker",
              confirmDiscard,
            }),
            h(MediaEditorCloseConfirm, { ref: closeConfirm }),
          ]
        : [];
  },
});

type HostVm = { editorOpen: boolean; hostOpen: boolean; cancels: number };
const mounted: VueWrapper[] = [];

async function openHost() {
  const canvas = new OffscreenCanvas(...MEDIA);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(200, 100, 50)";
  ctx.fillRect(0, 0, ...MEDIA);
  const src = URL.createObjectURL(await canvas.convertToBlob({ type: "image/png" }));
  const pinia = createPinia();
  const i18n = createI18n({ legacy: false, locale: "ru", missingWarn: false, fallbackWarn: false, messages: { ru: RU } });
  const wrapper = mount(Host, { props: { src }, attachTo: document.body, global: { plugins: [pinia, i18n] } });
  mounted.push(wrapper);
  const store = useMediaEditorStore(pinia);
  await until(() => store.uiState.isReady);
  await nextTick();
  return { host: wrapper.vm as unknown as HostVm, store };
}

const confirmation = () => document.querySelector<HTMLElement>("[data-media-editor-close-confirm]");
const answer = (which: "cancel" | "discard") => document.querySelector<HTMLButtonElement>(`[data-close-confirm="${which}"]`)!.click();

function esc(target: EventTarget = document.body) {
  const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe.skipIf(!adapter)(`Esc and the close guard${SKIP}`, () => {
  // A settings drawer closes on Esc from the window; the editor must keep it from seeing any.
  let drawerSawEscape = 0;
  const drawer = (e: KeyboardEvent) => {
    if (e.key === "Escape") drawerSawEscape++;
  };

  beforeEach(async () => {
    await page.viewport(1280, 800);
    drawerSawEscape = 0;
    window.addEventListener("keydown", drawer);
  });
  afterEach(() => {
    window.removeEventListener("keydown", drawer);
    for (const w of mounted.splice(0)) w.unmount();
  });

  test("no changes: Esc closes the editor at once, without asking", async () => {
    const { host } = await openHost();
    esc();
    await until(() => !host.editorOpen);
    expect(confirmation()).toBeNull();
    expect(host.cancels).toBe(1);
    expect(host.hostOpen).toBe(true);
    expect(drawerSawEscape).toBe(0);
  }, 30_000);

  test("changes: Esc asks; Cancel keeps the editor; Close without saving closes it", async () => {
    const { host, store } = await openHost();
    document.querySelector<HTMLButtonElement>("[data-outline-toggle]")!.click();
    await nextTick();
    expect(store.isDirty).toBe(true);

    esc();
    await until(() => !!confirmation());
    expect(confirmation()!.textContent).toContain("Закрыть редактор?");
    expect(confirmation()!.textContent).toContain("Несохранённые изменения будут потеряны.");
    // Shown above the editor.
    const frame = confirmation()!.closest<HTMLElement>('[data-slot="dialog-frame"]')!;
    expect(getComputedStyle(frame).zIndex).toBe("10000");
    answer("cancel");
    await until(() => !confirmation());
    expect(host.editorOpen).toBe(true);
    expect(store.mediaState.outline.enabled).toBe(true);

    esc();
    await until(() => !!confirmation());
    answer("discard");
    await until(() => !host.editorOpen);
    expect(host.cancels).toBe(1);
    expect(host.hostOpen).toBe(true);
    expect(drawerSawEscape).toBe(0);
  }, 30_000);

  test("Esc while the question shows only takes the question away", async () => {
    const { host, store } = await openHost();
    store.setOutline("enabled", true);
    esc();
    await until(() => !!confirmation());
    esc(document.activeElement ?? document.body);
    await until(() => !confirmation());
    expect(host.editorOpen).toBe(true);
    expect(drawerSawEscape).toBe(0);
  }, 30_000);

  test("the close button and the holder closing ask too; the holder stays open until the answer", async () => {
    const { host, store } = await openHost();
    store.setOutline("enabled", true);
    document.querySelector<HTMLButtonElement>("[data-editor-close]")!.click();
    await until(() => !!confirmation());
    answer("cancel");
    await until(() => !confirmation());
    expect(host.editorOpen).toBe(true);

    // The drawer is told to close: it is held open and the editor asks.
    host.hostOpen = false;
    expect(host.hostOpen).toBe(true);
    await until(() => !!confirmation());
    answer("cancel");
    await until(() => !confirmation());
    expect(host.hostOpen).toBe(true);
    expect(host.editorOpen).toBe(true);

    host.hostOpen = false;
    await until(() => !!confirmation());
    answer("discard");
    await until(() => !host.hostOpen);
    expect(host.editorOpen).toBe(false);
  }, 30_000);

  test("Esc while a lasso is being drawn cancels only the lasso", async () => {
    const { host, store } = await openHost();
    document.querySelector<HTMLButtonElement>('[data-cutout-tool="lasso"]')!.click();
    await until(() => !!document.querySelector('[data-cutout-overlay="lasso"]'));
    document.querySelector<HTMLButtonElement>('[data-option="lasso-mode"] [data-value="polygon"]')!.click();
    await nextTick();
    const overlay = document.querySelector<HTMLElement>("[data-cutout-overlay]")!;
    const rect = overlay.getBoundingClientRect();
    const dpr = store.uiState.pixelRatio;
    const [cw, ch] = store.uiState.canvasSize!;
    for (const p of [[40, 40], [200, 40]] as Vec2[]) {
      const c = sourceToCanvas(p, store.uiState.finalTransform, [Math.round(cw * dpr), Math.round(ch * dpr)], MEDIA);
      const at = { clientX: rect.left + c[0] / dpr, clientY: rect.top + c[1] / dpr, pointerId: 1, button: 0, bubbles: true, cancelable: true };
      overlay.dispatchEvent(new PointerEvent("pointerdown", { ...at, buttons: 1 }));
      overlay.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0 }));
    }
    await nextTick();
    expect(overlay.querySelectorAll("circle").length).toBe(2);

    esc();
    await nextTick();
    expect(overlay.querySelectorAll("circle").length).toBe(0);
    expect(host.editorOpen).toBe(true);
    expect(confirmation()).toBeNull();
    expect(store.mediaState.history).toHaveLength(0);

    // Nothing in progress now, nothing changed: the next Esc closes.
    esc();
    await until(() => !host.editorOpen);
    expect(drawerSawEscape).toBe(0);
  }, 30_000);
});
