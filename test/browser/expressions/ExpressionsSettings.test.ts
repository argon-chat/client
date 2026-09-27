/**
 * The space's emoji & sticker settings in a real browser, over a stand-in store: files dropped on a
 * pack are checked locally, animations get a first-frame WEBP and an outline, and what the store is
 * asked to upload is exactly that; a file the server would refuse never reaches it.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { ExpressionFormat, ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";
import fixtureUrl from "../fixtures/tiny-lottie.json?url";

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/system/fileStorage", async () => {
  const { default: url } = await import("../fixtures/tiny-lottie.json?url");
  return { cdnUrl: () => url, cdnFetchUrl: () => url, cdnCrossOrigin: () => undefined };
});
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ selectedServer: "s1" }) }));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ has: () => true, hasInSpace: () => true }) }));
vi.mock("@/store/db/dexie", () => ({ db: { servers: { get: async () => undefined } } }));
vi.mock("@/composables/useLiveQuery", async () => {
  const { ref } = await import("vue");
  return { useLiveQuery: () => ref(undefined) };
});
vi.mock("@/store/data/expressionsStore", async () => {
  const { reactive } = await import("vue");
  const state = reactive({ packs: [] as ExpressionPack[] });
  const calls = {
    uploadItem: [] as unknown[],
    createPack: [] as unknown[][],
    reorderPacks: [] as unknown[][],
  };
  const count = (kind: number) => state.packs.filter((p) => p.kind === kind).reduce((n, p) => n + p.items.length, 0);
  const store = {
    ensureLoaded: async () => {},
    packs: (_spaceId: string, kind: number) => state.packs.filter((p) => p.kind === kind),
    emojiPacks: () => state.packs.filter((p) => p.kind === 1),
    stickerPacks: () => state.packs.filter((p) => p.kind === 0),
    quotaUsage: () => ({ emoji: count(1), stickers: count(0), packs: state.packs.length }),
    uploadItem: async (options: { name: string; kind: number; packId: string; onProgress?: (p: number) => void }) => {
      calls.uploadItem.push(options);
      options.onProgress?.(1);
      return { itemId: `new-${calls.uploadItem.length}`, name: options.name, kind: options.kind, packId: options.packId } as unknown;
    },
    createPack: async (...args: unknown[]) => {
      calls.createPack.push(args);
      return { packId: "created", kind: args[1], title: args[2], slug: args[3], items: [] };
    },
    reorderPacks: async (...args: unknown[]) => {
      calls.reorderPacks.push(args);
      return args[2];
    },
    updatePack: async () => ({}),
    deletePack: async () => {},
    updateItem: async () => ({}),
    deleteItem: async () => {},
    reorderItems: async () => [],
  };
  return {
    __state: state,
    __calls: calls,
    useExpressionsStore: () => store,
    toMedia: (item: ExpressionItem) => ({
      fileId: item.fileId,
      format: item.format,
      width: item.width,
      height: item.height,
      outline: item.outline,
      textColor: item.textColor,
    }),
  };
});

import ExpressionsSettings from "@/components/settings/spaces/ExpressionsSettings.vue";
import * as storeModule from "@/store/data/expressionsStore";
import { decodeOutline } from "@/lib/expressions/outline";

type UploadCall = {
  spaceId: string;
  packId: string;
  kind: ExpressionKind;
  format: ExpressionFormat;
  file: Blob;
  contentType: string;
  thumb?: Blob | null;
  name: string;
  emoji: string[];
  outline?: Uint8Array | null;
};

const { __state: state, __calls: calls } = storeModule as unknown as {
  __state: { packs: ExpressionPack[] };
  __calls: { uploadItem: UploadCall[]; createPack: unknown[][]; reorderPacks: unknown[][] };
};

const pack = (packId: string, kind: ExpressionKind, sortOrder: number, items: ExpressionItem[] = []): ExpressionPack => ({
  packId,
  spaceId: "s1",
  kind,
  title: `Pack ${packId}`,
  slug: packId,
  coverItemId: null,
  sortOrder,
  version: 1n,
  items,
});

const mounted: VueWrapper[] = [];

function open() {
  const wrapper = mount(ExpressionsSettings, { props: { spaceId: "s1", boostLevel: 0 }, attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}

async function until(check: () => boolean, timeout = 10_000) {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 16));
  }
}

function drop(target: Element, ...files: File[]) {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  target.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
}

async function png(width: number, height: number): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(0, 128, 255)";
  ctx.fillRect(10, 10, width - 20, height - 20);
  return new File([await canvas.convertToBlob({ type: "image/png" })], "Tiny Face.png", { type: "image/png" });
}

async function gzip(bytes: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

beforeEach(() => {
  state.packs = [pack("ep", ExpressionKind.Emoji, 0), pack("ep2", ExpressionKind.Emoji, 1), pack("sp", ExpressionKind.Sticker, 2)];
  calls.uploadItem.length = 0;
  calls.createPack.length = 0;
  calls.reorderPacks.length = 0;
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe("ExpressionsSettings", () => {
  test("a static PNG goes up as it is: no thumbnail, no outline (the server traces it)", async () => {
    const wrapper = open();
    await nextTick();
    const zone = wrapper.element.querySelector("[data-upload-zone]")!;
    drop(zone, await png(100, 100));

    await until(() => calls.uploadItem.length === 1);
    const call = calls.uploadItem[0];
    expect(call).toMatchObject({
      spaceId: "s1",
      packId: "ep",
      kind: ExpressionKind.Emoji,
      format: ExpressionFormat.Static,
      contentType: "image/png",
      name: "tiny_face",
      emoji: ["🙂"],
    });
    expect(call.thumb ?? null).toBeNull();
    expect(call.outline ?? null).toBeNull();
    await until(() => !!wrapper.element.querySelector('[data-upload-rows] [data-status="done"]'));
  });

  test("a gzipped Lottie goes up with a WEBP of its first frame and an outline of it", async () => {
    const wrapper = open();
    await nextTick();
    const tgs = await gzip(await (await fetch(fixtureUrl)).arrayBuffer());
    drop(wrapper.element.querySelector("[data-upload-zone]")!, new File([tgs], "party.tgs"));

    await until(() => calls.uploadItem.length === 1, 20_000);
    const call = calls.uploadItem[0];
    expect(call).toMatchObject({ format: ExpressionFormat.Lottie, contentType: "application/x-tgsticker", name: "party" });

    expect(call.thumb).toBeInstanceOf(Blob);
    expect(call.thumb!.type).toBe("image/webp");
    const bitmap = await createImageBitmap(call.thumb!);
    expect([bitmap.width, bitmap.height]).toEqual([100, 100]);
    bitmap.close();

    // Frame 0 is a 60×60 square in the middle of 100×100: 20…80, ×5.12 in the outline's 512 box.
    expect(call.outline!.length).toBeGreaterThan(0);
    const path = decodeOutline(call.outline!);
    expect(path).toMatch(/^M\d+,\d+l.*z$/);
    const [x0, y0] = /^M(\d+),(\d+)/.exec(path)!.slice(1).map(Number);
    expect(x0).toBeGreaterThanOrEqual(96);
    expect(x0).toBeLessThanOrEqual(416);
    expect(y0).toBeGreaterThanOrEqual(96);
    expect(y0).toBeLessThanOrEqual(416);
  });

  test("a file the server would refuse never leaves: the row says why", async () => {
    const wrapper = open();
    await nextTick();
    drop(wrapper.element.querySelector("[data-upload-zone]")!, await png(64, 64));
    await until(() => !!wrapper.element.querySelector('[data-upload-rows] [data-status="failed"]'));
    expect(wrapper.element.querySelector('[data-status="failed"]')!.textContent).toContain(
      "expression_settings_upload_error_dims_emoji",
    );
    expect(calls.uploadItem).toHaveLength(0);
  });

  test("a new pack takes its short name from the title", async () => {
    const wrapper = open();
    await nextTick();
    (wrapper.element as HTMLElement).querySelector<HTMLElement>("[data-new-pack]")!.click();
    await until(() => !!document.getElementById("expression-pack-title"));
    const title = document.getElementById("expression-pack-title") as HTMLInputElement;
    title.value = "Party Time!";
    title.dispatchEvent(new Event("input"));
    await nextTick();
    expect((document.getElementById("expression-pack-slug") as HTMLInputElement).value).toBe("party_time");

    title.closest("form")!.requestSubmit();
    await until(() => calls.createPack.length === 1);
    expect(calls.createPack[0]).toEqual(["s1", ExpressionKind.Emoji, "Party Time!", "party_time"]);
  });

  test("packs reorder with the arrows; the quota shows what is used of the boost level's share", async () => {
    const wrapper = open();
    await nextTick();
    const [, down] = (wrapper.element as HTMLElement).querySelectorAll<HTMLButtonElement>(".pack-row")[0].querySelectorAll<HTMLButtonElement>("button:not(.pack-row__main)");
    down.click();
    await until(() => calls.reorderPacks.length === 1);
    expect(calls.reorderPacks[0]).toEqual(["s1", ExpressionKind.Emoji, ["ep2", "ep"]]);

    expect(wrapper.element.querySelector('[data-quota="emoji"]')!.textContent).toContain("0 / 60");
    expect(wrapper.element.querySelector('[data-quota="stickers"]')!.textContent).toContain("0 / 6");
    expect(wrapper.element.querySelector('[data-quota="packs"]')!.textContent).toContain("3 / 10");
  });
});
