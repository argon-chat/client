/**
 * The space's emoji & sticker settings in a real browser, over a stand-in store: files dropped on a
 * pack show as cells at the end of its grid with their progress, are checked locally (animations
 * get a first-frame WEBP and an outline), and a file the server would refuse never reaches it; a
 * refusal shows on its cell with retry; the uploaded item takes the cell's place. Animated items play
 * in the grid. Who may change what follows the server's rule (one's own with Create Expressions,
 * anybody's with Manage Expressions), and the whole view waits for the stickers-and-emoji flag.
 */

import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { ExpressionError, ExpressionFormat, ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";
import fixtureUrl from "../fixtures/tiny-lottie.json?url";

const h = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  return {
    flags: reactive({ stickersAndEmojiActive: true }),
    perms: reactive(new Set<string>(["CreateExpressions", "ManageExpressions"])),
  };
});

vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/system/fileStorage", async () => {
  const { default: url } = await import("../fixtures/tiny-lottie.json?url");
  return { cdnUrl: () => url, cdnFetchUrl: () => url, cdnCrossOrigin: () => undefined };
});
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => ({ selectedServer: "s1" }) }));
vi.mock("@/store/data/permissionStore", () => ({
  usePexStore: () => ({ has: (flag: string) => h.perms.has(flag), hasInSpace: (_space: string, flag: string) => h.perms.has(flag) }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/features/featureFlagsStore", () => ({ useFeatureFlags: () => h.flags }));
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
    ensureLoaded: [] as string[],
  };
  /** Run before the next upload finishes: it may wait, report progress, or throw a refusal. */
  const hooks: ((options: unknown) => Promise<void>)[] = [];
  const count = (kind: number) => state.packs.filter((p) => p.kind === kind).reduce((n, p) => n + p.items.length, 0);
  const store = {
    ensureLoaded: async (id: string) => void calls.ensureLoaded.push(id),
    packs: (_spaceId: string, kind: number) => state.packs.filter((p) => p.kind === kind),
    emojiPacks: () => state.packs.filter((p) => p.kind === 1),
    stickerPacks: () => state.packs.filter((p) => p.kind === 0),
    quotaUsage: () => ({ emoji: count(1), stickers: count(0), packs: state.packs.length }),
    uploadItem: async (options: { name: string; kind: number; format: number; packId: string; onProgress?: (p: number) => void }) => {
      calls.uploadItem.push(options);
      const hook = hooks.shift();
      if (hook) await hook(options);
      options.onProgress?.(1);
      const item = {
        itemId: `new-${calls.uploadItem.length}`,
        packId: options.packId,
        spaceId: "s1",
        kind: options.kind,
        format: options.format,
        name: options.name,
        fileId: `new-${calls.uploadItem.length}`,
        thumbFileId: null,
        width: 100,
        height: 100,
        fileSize: 1,
        emoji: [],
        keywords: [],
        outline: null,
        textColor: false,
        sortOrder: 99,
        downloadUrl: null,
        thumbUrl: null,
        creatorId: "me",
      };
      const pack = state.packs.find((p) => p.packId === options.packId);
      if (pack) pack.items = [...pack.items, item as never];
      return item;
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
    __hooks: hooks,
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
import { ExpressionRefusal } from "@/lib/refusals";

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
  keywords: string[];
  outline?: Uint8Array | null;
  onProgress?: (p: number) => void;
};

const {
  __state: state,
  __calls: calls,
  __hooks: hooks,
} = storeModule as unknown as {
  __state: { packs: ExpressionPack[] };
  __calls: { uploadItem: UploadCall[]; createPack: unknown[][]; reorderPacks: unknown[][]; ensureLoaded: string[] };
  __hooks: ((options: UploadCall) => Promise<void>)[];
};

const item = (itemId: string, packId: string, kind: ExpressionKind, creatorId: string | null = "me", format = ExpressionFormat.Lottie): ExpressionItem => ({
  itemId,
  packId,
  spaceId: "s1",
  kind,
  format,
  name: itemId,
  fileId: itemId,
  thumbFileId: null,
  width: kind === ExpressionKind.Emoji ? 100 : 512,
  height: kind === ExpressionKind.Emoji ? 100 : 512,
  fileSize: 1,
  emoji: [],
  keywords: [],
  outline: null,
  textColor: false,
  sortOrder: 0,
  downloadUrl: null,
  thumbUrl: null,
  creatorId,
});

const pack = (packId: string, kind: ExpressionKind, sortOrder: number, items: ExpressionItem[] = [], creatorId: string | null = "me"): ExpressionPack => ({
  packId,
  spaceId: "s1",
  kind,
  title: `Pack ${packId}`,
  slug: packId,
  coverItemId: null,
  sortOrder,
  version: 1n,
  items,
  creatorId,
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function drop(target: Element, ...files: File[]) {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  target.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
}

async function png(width: number, height: number, name = "Tiny Face.png"): Promise<File> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgb(0, 128, 255)";
  ctx.fillRect(10, 10, width - 20, height - 20);
  return new File([await canvas.convertToBlob({ type: "image/png" })], name, { type: "image/png" });
}

async function gzip(bytes: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The pixel at (fx, fy) of what a canvas shows, as fractions of its size. */
function pixel(canvas: HTMLCanvasElement, fx: number, fy: number): number[] {
  const probe = document.createElement("canvas");
  probe.width = canvas.width;
  probe.height = canvas.height;
  const ctx = probe.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  return Array.from(ctx.getImageData(Math.floor(canvas.width * fx), Math.floor(canvas.height * fy), 1, 1).data);
}

const $ = (wrapper: VueWrapper, selector: string) => (wrapper.element as HTMLElement).querySelector<HTMLElement>(selector);
const zone = (wrapper: VueWrapper) => $(wrapper, "[data-upload-zone]")!;

beforeEach(() => {
  h.flags.stickersAndEmojiActive = true;
  h.perms.clear();
  h.perms.add("CreateExpressions");
  h.perms.add("ManageExpressions");
  state.packs = [pack("ep", ExpressionKind.Emoji, 0), pack("ep2", ExpressionKind.Emoji, 1), pack("sp", ExpressionKind.Sticker, 2)];
  calls.uploadItem.length = 0;
  calls.createPack.length = 0;
  calls.reorderPacks.length = 0;
  calls.ensureLoaded.length = 0;
  hooks.length = 0;
});

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
});

describe("uploads", () => {
  test("a static PNG goes up as it is (no thumbnail, no outline, no associated emoji) and its item takes the cell's place", async () => {
    const wrapper = open();
    await nextTick();
    drop(zone(wrapper), await png(100, 100));

    await until(() => calls.uploadItem.length === 1);
    const call = calls.uploadItem[0];
    expect(call).toMatchObject({
      spaceId: "s1",
      packId: "ep",
      kind: ExpressionKind.Emoji,
      format: ExpressionFormat.Static,
      contentType: "image/png",
      name: "tiny_face",
      emoji: [],
      keywords: [],
    });
    expect(call.thumb ?? null).toBeNull();
    expect(call.outline ?? null).toBeNull();
    await until(() => !!$(wrapper, '[data-item-id="new-1"]') && !$(wrapper, "[data-upload-row]"));
  });

  test("a gzipped Lottie goes up with a WEBP of its first frame and an outline of it", async () => {
    const wrapper = open();
    await nextTick();
    const tgs = await gzip(await (await fetch(fixtureUrl)).arrayBuffer());
    drop(zone(wrapper), new File([tgs], "party.tgs"));

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

  test("dropped files show as cells at the end of the pack's grid, with their picture and progress", async () => {
    state.packs[0].items = [item("e1", "ep", ExpressionKind.Emoji)];
    const gate = deferred();
    let reported: UploadCall | null = null;
    hooks.push(async (options) => {
      reported = options;
      await gate.promise;
    });
    const wrapper = open();
    await nextTick();
    drop(zone(wrapper), await png(100, 100, "wave.png"));
    await nextTick();

    const grid = $(wrapper, "[data-item-grid]")!;
    const cells = () => Array.from(grid.children) as HTMLElement[];
    expect(cells().map((c) => c.dataset.itemId ?? `upload:${c.dataset.status}`)).toEqual(["e1", expect.stringMatching(/^upload:/)]);
    const cell = cells()[1];
    expect(cell.querySelector<HTMLImageElement>("[data-upload-preview]")!.src).toMatch(/^blob:/);
    expect(cell.querySelector('[role="progressbar"]')).not.toBeNull();

    await until(() => !!reported && cell.dataset.status === "uploading");
    reported!.onProgress!(0.5);
    await nextTick();
    expect(cell.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("50");
    // No separate queue: the grid is the only place the file shows.
    expect($(wrapper, "[data-upload-rows]")).toBeNull();

    gate.resolve();
    await until(() => cells().every((c) => !c.dataset.uploadRow));
    expect(cells().map((c) => c.dataset.itemId)).toEqual(["e1", "new-1"]);
  });

  test("a refusal shows on the file's cell with its reason; retry sends it again", async () => {
    hooks.push(async () => {
      throw new ExpressionRefusal(ExpressionError.RATE_LIMITED);
    });
    const wrapper = open();
    await nextTick();
    drop(zone(wrapper), await png(100, 100));

    await until(() => !!$(wrapper, '[data-upload-row][data-status="failed"]'));
    const cell = $(wrapper, "[data-upload-row]")!;
    expect(cell.querySelector("[data-refusal]")!.getAttribute("data-refusal-key")).toBe("expression_error_rate_limited");
    expect(cell.textContent).toContain("expression_error_rate_limited");
    expect(cell.querySelector("[data-discard-upload]")).not.toBeNull();

    cell.querySelector<HTMLElement>("[data-retry-upload]")!.click();
    await until(() => calls.uploadItem.length === 2 && !$(wrapper, "[data-upload-row]"));
    expect($(wrapper, '[data-item-id="new-2"]')).not.toBeNull();
  });

  test("a file refused before it leaves says why on its cell; the rest of the batch still goes up", async () => {
    const wrapper = open();
    await nextTick();
    drop(zone(wrapper), new File([new Uint8Array([1, 2, 3, 4])], "junk.webm"), await png(100, 100));

    await until(() => calls.uploadItem.length === 1 && !!$(wrapper, '[data-upload-row][data-status="failed"]'));
    const cell = $(wrapper, '[data-upload-row][data-status="failed"]')!;
    expect(cell.textContent).toContain("expression_settings_upload_error_type");
    expect(cell.querySelector("[data-refusal]")).not.toBeNull();
    // Trying again cannot help a wrong type: only removing it is offered.
    expect(cell.querySelector("[data-retry-upload]")).toBeNull();
    expect(calls.uploadItem[0].name).toBe("tiny_face");

    cell.querySelector<HTMLElement>("[data-discard-upload]")!.click();
    await until(() => !$(wrapper, "[data-upload-row]"));
  });

  test("a still image refused for its canvas waits for the workbench instead of failing", async () => {
    const wrapper = open();
    await nextTick();
    drop(zone(wrapper), await png(64, 64));
    await until(() => !!$(wrapper, '[data-upload-row][data-status="pending"]'));
    const cell = $(wrapper, '[data-status="pending"]')!;
    expect(cell.textContent).toContain("expression_settings_upload_error_dims_emoji");
    // It can be discarded; "Edit" shows only where WebGPU can run the workbench.
    const edit = cell.querySelector("[data-edit-upload]");
    expect(!!edit).toBe(!!(navigator.gpu && (await navigator.gpu.requestAdapter().catch(() => null))));
    (cell.querySelector("[data-discard-upload]") as HTMLElement).click();
    await until(() => !$(wrapper, '[data-status="pending"]'));
    expect(calls.uploadItem).toHaveLength(0);
  });

  test("pasted files go up too, from inside the settings' own drawer, but not from a dialog over it", async () => {
    const drawer = document.createElement("div");
    drawer.setAttribute("role", "dialog");
    document.body.append(drawer);
    const wrapper = mount(ExpressionsSettings, { props: { spaceId: "s1", boostLevel: 0 }, attachTo: drawer });
    await nextTick();
    const paste = (target: Element, file: File) => {
      const data = new DataTransfer();
      data.items.add(file);
      target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    };

    const over = document.createElement("div");
    over.setAttribute("role", "dialog");
    const button = document.createElement("button");
    over.append(button);
    document.body.append(over);
    paste(button, await png(100, 100, "ignored.png"));
    await nextTick();
    expect($(wrapper, "[data-upload-row]")).toBeNull();

    paste($(wrapper, '[data-kind="emoji"]')!, await png(100, 100, "pasted.png"));
    await until(() => calls.uploadItem.length === 1);
    expect(calls.uploadItem[0]).toMatchObject({ name: "pasted", packId: "ep" });

    wrapper.unmount();
    over.remove();
    drawer.remove();
  });

  test("the upload strip is one slim line: no batch emoji field, no separate queue", async () => {
    const wrapper = open();
    await nextTick();
    const strip = $(wrapper, "[data-upload-strip]")!;
    expect(strip.getBoundingClientRect().height).toBeLessThanOrEqual(64);
    expect($(wrapper, "[data-default-emoji]")).toBeNull();
    expect($(wrapper, "[data-upload-rows]")).toBeNull();
  });
});

describe("the grid", () => {
  test("an animated emoji plays in the pack's grid", async () => {
    state.packs[0].items = [item("lottie-emoji", "ep", ExpressionKind.Emoji)];
    const wrapper = open();
    await nextTick();
    const view = () => $(wrapper, '[data-item-id="lottie-emoji"] .sticker-view');
    await until(() => view()?.dataset.phase === "ready");
    const canvas = view()!.querySelector<HTMLCanvasElement>("canvas:not([style*='display: none'])")!;
    expect(canvas.width).toBeGreaterThan(0);
    // Drawn: the square's middle is red.
    expect(pixel(canvas, 0.5, 0.5)).toEqual([255, 0, 0, 255]);

    // Playing: the square turns (0° → 90° over a second), so a point near its corner is covered at
    // some moments and bare at others.
    const seen = new Set<string>();
    const deadline = performance.now() + 3_000;
    while (seen.size < 2 && performance.now() < deadline) {
      seen.add(pixel(canvas, 0.22, 0.22)[3] > 0 ? "covered" : "bare");
      await new Promise((r) => setTimeout(r, 30));
    }
    expect([...seen].sort()).toEqual(["bare", "covered"]);
  });

  test("a new pack takes its short name from the title", async () => {
    const wrapper = open();
    await nextTick();
    $(wrapper, "[data-new-pack]")!.click();
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

    expect($(wrapper, '[data-quota="emoji"]')!.textContent).toContain("0 / 60");
    expect($(wrapper, '[data-quota="stickers"]')!.textContent).toContain("0 / 6");
    expect($(wrapper, '[data-quota="packs"]')!.textContent).toContain("3 / 10");
  });
});

describe("who may change what", () => {
  beforeEach(() => {
    state.packs = [
      pack("ep", ExpressionKind.Emoji, 0, [item("mine", "ep", ExpressionKind.Emoji, "me"), item("theirs", "ep", ExpressionKind.Emoji, "other")], "me"),
      pack("ep2", ExpressionKind.Emoji, 1, [item("legacy", "ep2", ExpressionKind.Emoji, null)], "other"),
    ];
  });

  test("with Create Expressions only: one's own items and packs can be changed, nothing can be reordered", async () => {
    h.perms.delete("ManageExpressions");
    const wrapper = open();
    await nextTick();

    expect($(wrapper, "[data-create-only-hint]")).not.toBeNull();
    expect($(wrapper, '[data-item-id="mine"]')!.hasAttribute("data-editable")).toBe(true);
    expect($(wrapper, '[data-item-id="mine"] button.item-tile__main')).not.toBeNull();
    expect($(wrapper, '[data-item-id="theirs"]')!.hasAttribute("data-editable")).toBe(false);
    expect($(wrapper, '[data-item-id="theirs"] button')).toBeNull();
    expect($(wrapper, ".item-tile__move")).toBeNull();
    expect($(wrapper, ".pack-row__actions")).toBeNull();
    expect($(wrapper, "[data-edit-pack]")).not.toBeNull();
    expect($(wrapper, "[data-delete-pack]")).not.toBeNull();
    // Uploading into any pack is allowed.
    expect($(wrapper, "[data-upload-strip]")!.hasAttribute("disabled")).toBe(false);

    // The own item opens, with its own pack's cover control.
    $(wrapper, '[data-item-id="mine"] button.item-tile__main')!.click();
    await until(() => !!document.querySelector("[data-expression-item-dialog]"));
    expect(document.querySelector("[data-delete-item]")).not.toBeNull();
    expect(document.querySelector("[data-set-cover]")).not.toBeNull();

    // Somebody else's pack: no edit or delete; an item without a known creator is not one's own.
    $(wrapper, '[data-pack-id="ep2"]')!.click();
    await nextTick();
    expect($(wrapper, "[data-edit-pack]")).toBeNull();
    expect($(wrapper, "[data-delete-pack]")).toBeNull();
    expect($(wrapper, '[data-item-id="legacy"]')!.hasAttribute("data-editable")).toBe(false);
    expect($(wrapper, "[data-upload-strip]")!.hasAttribute("disabled")).toBe(false);
  });

  test("with Manage Expressions: anybody's items and packs can be changed and reordered", async () => {
    h.perms.delete("CreateExpressions");
    const wrapper = open();
    await nextTick();

    expect($(wrapper, "[data-create-only-hint]")).toBeNull();
    for (const id of ["mine", "theirs"]) expect($(wrapper, `[data-item-id="${id}"]`)!.hasAttribute("data-editable")).toBe(true);
    expect(wrapper.element.querySelectorAll(".item-tile__move")).toHaveLength(2);
    expect(wrapper.element.querySelectorAll(".pack-row__actions")).toHaveLength(2);

    $(wrapper, '[data-pack-id="ep2"]')!.click();
    await nextTick();
    expect($(wrapper, "[data-edit-pack]")).not.toBeNull();
    expect($(wrapper, '[data-item-id="legacy"]')!.hasAttribute("data-editable")).toBe(true);
  });
});

describe("the stickers-and-emoji flag", () => {
  test("off, the view shows nothing to manage and loads nothing; on, it comes back", async () => {
    h.flags.stickersAndEmojiActive = false;
    const wrapper = open();
    await nextTick();
    expect($(wrapper, "[data-expressions-unavailable]")).not.toBeNull();
    expect($(wrapper, "[data-upload-zone]")).toBeNull();
    expect($(wrapper, ".pack-row")).toBeNull();
    expect(calls.ensureLoaded).toEqual([]);

    h.flags.stickersAndEmojiActive = true;
    await nextTick();
    expect($(wrapper, "[data-expressions-unavailable]")).toBeNull();
    expect($(wrapper, "[data-upload-zone]")).not.toBeNull();
    expect(calls.ensureLoaded).toEqual(["s1"]);
  });
});
