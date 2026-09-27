/**
 * The sticker workbench from the emoji & sticker settings, end to end: a PNG refused for its canvas
 * waits, "Edit" opens it in the editor's emoji mode, and "Done" puts a 100×100 WEBP in its place,
 * which is what the store is then asked to upload. Needs WebGPU (ARGON_TEST_GPU=1); skipped otherwise.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { createPinia } from "pinia";
import { createI18n } from "vue-i18n";
import { ExpressionFormat, ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/ui/configStore", () => ({ useConfigStore: () => ({ devModeEnabled: false }) }));
vi.mock("@/store/features/featureFlagsStore", () => ({ useFeatureFlags: () => ({ stickersAndEmojiActive: true }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/system/fileStorage", () => ({ cdnUrl: () => "", cdnFetchUrl: () => "", cdnCrossOrigin: () => undefined }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ selectedServer: "s1" }) }));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ has: () => true, hasInSpace: () => true }) }));
vi.mock("@/store/db/dexie", () => ({ db: { servers: { get: async () => undefined } }, dropCurrentDb: async () => {} }));
vi.mock("@/composables/useLiveQuery", async () => {
  const { ref } = await import("vue");
  return { useLiveQuery: () => ref(undefined) };
});
vi.mock("@/store/data/expressionsStore", async () => {
  const { reactive } = await import("vue");
  const state = reactive({ packs: [] as ExpressionPack[] });
  const uploads: unknown[] = [];
  const count = (kind: number) => state.packs.filter((p) => p.kind === kind).reduce((n, p) => n + p.items.length, 0);
  const store = {
    ensureLoaded: async () => {},
    packs: (_spaceId: string, kind: number) => state.packs.filter((p) => p.kind === kind),
    emojiPacks: () => state.packs.filter((p) => p.kind === 1),
    stickerPacks: () => state.packs.filter((p) => p.kind === 0),
    quotaUsage: () => ({ emoji: count(1), stickers: count(0), packs: state.packs.length }),
    uploadItem: async (options: { name: string; kind: number; packId: string; onProgress?: (p: number) => void }) => {
      uploads.push(options);
      options.onProgress?.(1);
      return { itemId: `new-${uploads.length}`, name: options.name, kind: options.kind, packId: options.packId } as unknown;
    },
  };
  return { __state: state, __uploads: uploads, useExpressionsStore: () => store, toMedia: () => ({}) };
});

import ExpressionsSettings from "@/components/settings/spaces/ExpressionsSettings.vue";
import * as storeModule from "@/store/data/expressionsStore";
import { useMediaEditorStore } from "@argon/media-editor";
import { initDevice } from "../../../packages/media-editor/src/webgpu/initDevice";

const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;

const { __state: state, __uploads: uploads } = storeModule as unknown as {
  __state: { packs: ExpressionPack[] };
  __uploads: { name: string; kind: ExpressionKind; format: ExpressionFormat; file: Blob; contentType: string }[];
};

const mounted: VueWrapper[] = [];

async function until(check: () => boolean, timeout = 15_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

async function png(width: number, height: number): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(0, 128, 255)";
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, width / 3, 0, Math.PI * 2);
  ctx.fill();
  return new File([await canvas.convertToBlob({ type: "image/png" })], "Tiny Face.png", { type: "image/png" });
}

beforeEach(() => {
  state.packs = [
    { packId: "ep", spaceId: "s1", kind: ExpressionKind.Emoji, title: "Pack", slug: "ep", coverItemId: null, sortOrder: 0, version: 1n, items: [] as ExpressionItem[], creatorId: null },
  ];
  uploads.length = 0;
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe.skipIf(!adapter)(`sticker workbench entry${adapter ? "" : " — skipped: no WebGPU adapter (set ARGON_TEST_GPU=1)"}`, () => {
  test("Edit → emoji mode → Done: a 100×100 WEBP takes the refused PNG's place and is uploaded", async () => {
    const gpuErrors: string[] = [];
    (await initDevice()).addEventListener("uncapturederror", (e) => gpuErrors.push((e as GPUUncapturedErrorEvent).error.message));
    const pinia = createPinia();
    const i18n = createI18n({ legacy: false, locale: "en", missingWarn: false, fallbackWarn: false, messages: { en: {} } });
    const wrapper = mount(ExpressionsSettings, {
      props: { spaceId: "s1", boostLevel: 0 },
      attachTo: document.body,
      global: { plugins: [pinia, i18n] },
    });
    mounted.push(wrapper);
    await nextTick();

    const data = new DataTransfer();
    data.items.add(await png(300, 200));
    wrapper.element.querySelector("[data-upload-zone]")!.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    await until(() => !!wrapper.element.querySelector('[data-status="pending"] [data-edit-upload]'));
    (wrapper.element.querySelector("[data-edit-upload]") as HTMLElement).click();

    const editor = useMediaEditorStore(pinia);
    await until(() => editor.uiState.isReady);
    expect(editor.mode).toBe("emoji");
    expect(document.querySelector('.media-editor__container [data-tab="cutout"]')).not.toBeNull();

    // Background removal through the dialog's worker client.
    (document.querySelector("[data-remove-background]") as HTMLElement).click();
    await until(() => editor.mediaState.mask.source !== null, 60_000);
    expect(editor.uiState.backgroundRemoval.status).toBe("idle");

    (document.querySelector("[data-outline-toggle]") as HTMLElement).click();
    await nextTick();
    expect(editor.mediaState.outline.enabled).toBe(true);

    // An erase stroke on the preview lands in the mask, in source pixels.
    (document.querySelector('.media-editor__container [data-tab="brush"]') as HTMLElement).click();
    await nextTick();
    (document.querySelector('[data-brush="maskErase"]') as HTMLElement).click();
    const brushCanvas = editor.uiState.brushCanvas!;
    const r = brushCanvas.getBoundingClientRect();
    const at = (fx: number, fy: number) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, pointerId: 1, bubbles: true });
    brushCanvas.dispatchEvent(new PointerEvent("pointerdown", at(0.3, 0.5)));
    brushCanvas.dispatchEvent(new PointerEvent("pointermove", at(0.5, 0.5)));
    brushCanvas.dispatchEvent(new PointerEvent("pointerup", at(0.5, 0.5)));
    expect(editor.mediaState.mask.strokes).toHaveLength(1);
    const [p0] = editor.mediaState.mask.strokes[0].points;
    expect(p0[0]).toBeGreaterThan(-300);
    expect(p0[0]).toBeLessThan(600);
    editor.undo();
    expect(editor.mediaState.mask.strokes).toHaveLength(0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(gpuErrors).toEqual([]);

    const done = Array.from(document.querySelectorAll<HTMLButtonElement>(".media-editor__container button")).find((b) => b.textContent?.trim() === "Done")!;
    done.click();

    await until(() => uploads.length === 1);
    const call = uploads[0];
    expect(call).toMatchObject({ kind: ExpressionKind.Emoji, format: ExpressionFormat.Static, contentType: "image/webp", name: "tiny_face" });
    const bitmap = await createImageBitmap(call.file);
    expect([bitmap.width, bitmap.height]).toEqual([100, 100]);
    bitmap.close();
    // Upload cells sit in the pack grid and go once their item is uploaded.
    await until(() => !wrapper.element.querySelector("[data-upload-row]"));
    expect(gpuErrors).toEqual([]);
  }, 90_000);
});
