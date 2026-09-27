/**
 * Custom emoji and stickers per space (real Dexie on fake-indexeddb).
 *
 * What these pin: the cached copy is read first and revalidated with its version as `known`; an
 * answer without packs keeps it; the six deltas apply in place when they follow on from our
 * version, and anything else refetches — debounced and jittered; search; recents; the upload
 * sequence; and refusals surfacing as a typed error with an i18n key.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia, type Pinia } from "pinia";

await vi.hoisted(async () => {
  const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
});

const h = vi.hoisted(() => ({
  svc: null as any,
  uploadFile: null as any,
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    get spaceExpressionInteraction() {
      return h.svc;
    },
  }),
}));
vi.mock("@/lib/uploadFile", () => ({
  uploadFile: (...args: unknown[]) => h.uploadFile(...args),
}));

import {
  ExpressionError,
  ExpressionFormat,
  ExpressionKind,
  FailedItem,
  FailedPack,
  ItemDeleted,
  ItemUpserted,
  ItemsReordered,
  PackDeleted,
  PackUpserted,
  PacksReordered,
  SpaceExpressionsChanged,
  SuccessItem,
  SuccessPack,
  SuccessUploadFile,
  type ArgonSpaceBase,
  type ExpressionItem,
  type ExpressionPack,
  type ExpressionsSnapshot,
  type IExpressionDelta,
} from "@argon/glue";
import { db, ensureDbOpen } from "@/store/db/dexie";
import {
  useExpressionsStore,
  toMedia,
  EXPRESSIONS_LOAD_ALL_GAP_MS,
  EXPRESSIONS_LOAD_ALL_INTERVAL_MS,
  EXPRESSIONS_REFRESH_DEBOUNCE_MS,
  EXPRESSIONS_REFRESH_JITTER_MS,
  EXPRESSIONS_REVALIDATE_MS,
  RECENT_EXPRESSIONS_LIMIT,
} from "@/store/data/expressionsStore";
import { ExpressionRefusal, expressionErrorKey } from "@/lib/refusals";
import { createStoreResolver, noopResolver, useExpressionResolver } from "@/lib/expressions/resolver";
import { runSessionReset } from "@/store/system/sessionLifecycle";
import en from "../../packages/i18n/src/core/en.json";
import ru from "../../packages/i18n/src/core/ru.json";

const SPACE = "space-1";
const OTHER = "space-2";

const item = (itemId: string, packId: string, extra: Partial<ExpressionItem> = {}): ExpressionItem => ({
  itemId,
  packId,
  spaceId: SPACE,
  kind: ExpressionKind.Sticker,
  format: ExpressionFormat.Static,
  name: itemId,
  fileId: `f-${itemId}`,
  thumbFileId: null,
  width: 512,
  height: 512,
  fileSize: 100,
  emoji: [],
  keywords: [],
  outline: null,
  textColor: false,
  sortOrder: 0,
  downloadUrl: null,
  thumbUrl: null,
  creatorId: null,
  ...extra,
});

const pack = (
  packId: string,
  sortOrder: number,
  items: ExpressionItem[],
  extra: Partial<ExpressionPack> = {},
): ExpressionPack => ({
  packId,
  spaceId: SPACE,
  kind: ExpressionKind.Sticker,
  title: packId,
  slug: packId,
  coverItemId: null,
  sortOrder,
  version: 1n,
  items,
  creatorId: null,
  ...extra,
});

const snapshot = (version: string, packs: ExpressionPack[] | null): ExpressionsSnapshot => ({ version, packs });

const changed = (version: string, baseVersion: string | null, delta: IExpressionDelta | null, spaceId = SPACE) =>
  new SpaceExpressionsChanged(spaceId, version, baseVersion, delta);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A macrotask turn: fake-indexeddb completes its requests on setImmediate, which stays real. */
const { setImmediate: nextTurn } = globalThis as unknown as { setImmediate: (fn: () => void) => void };
const tick = () => new Promise<void>((r) => nextTurn(r));

async function until(check: () => boolean | Promise<boolean>, turns = 50) {
  for (let i = 0; i < turns; i++) {
    if (await check()) return;
    await tick();
  }
  throw new Error("condition never became true");
}

const ids = (list: { itemId: string }[]) => list.map((i) => i.itemId);
const packIds = (list: ExpressionPack[]) => list.map((p) => p.packId);

let pinia: Pinia;

beforeEach(async () => {
  await ensureDbOpen();
  await db.expressions.clear();
  // setImmediate stays real: fake-indexeddb completes its requests on it.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
  pinia = createPinia();
  setActivePinia(pinia);
  localStorage.clear();

  h.svc = {
    GetExpressions: vi.fn(async () => snapshot("v1", [])),
    CreatePack: vi.fn(),
    UpdatePack: vi.fn(),
    DeletePack: vi.fn(),
    ReorderPacks: vi.fn(),
    BeginUploadExpression: vi.fn(),
    AddItem: vi.fn(),
    UpdateItem: vi.fn(),
    DeleteItem: vi.fn(),
    ReorderItems: vi.fn(),
  };
  h.uploadFile = vi.fn();
});

afterEach(async () => {
  for (const store of (pinia as unknown as { _s: Map<string, { $dispose(): void }> })._s.values()) store.$dispose();
  await runSessionReset();
  vi.useRealTimers();
});

/** A store whose SPACE was loaded with `packs` at `version`. */
async function loaded(packs: ExpressionPack[], version = "v1") {
  const store = useExpressionsStore();
  h.svc.GetExpressions.mockResolvedValueOnce(snapshot(version, packs));
  await store.ensureLoaded(SPACE);
  return store;
}

describe("loading", () => {
  test("the cached copy is shown first, then revalidated with its version as `known`", async () => {
    await db.expressions.put({
      spaceId: SPACE,
      version: "v1",
      packs: [{ ...pack("p1", 0, []), version: "5", items: [{ ...item("a", "p1"), outline: btoa("\x01\x02\xff") }] }],
      updatedAt: 1,
    });
    const answer = deferred<ExpressionsSnapshot>();
    h.svc.GetExpressions.mockReturnValueOnce(answer.promise);

    const store = useExpressionsStore();
    const done = store.ensureLoaded(SPACE);
    await until(() => h.svc.GetExpressions.mock.calls.length === 1);

    expect(h.svc.GetExpressions).toHaveBeenCalledWith(SPACE, "v1");
    const cached = store.bySpace.get(SPACE)!;
    expect(cached.version).toBe("v1");
    expect(cached.loadedAt).toBe(0);
    expect(cached.packs[0].version).toBe(5n);
    expect(cached.packs[0].items[0].outline).toEqual(new Uint8Array([1, 2, 255]));

    answer.resolve(snapshot("v2", [pack("p1", 0, [item("b", "p1", { outline: new Uint8Array([7]) })])]));
    await done;

    expect(store.bySpace.get(SPACE)!.version).toBe("v2");
    expect(ids(store.stickerPacks(SPACE)[0].items)).toEqual(["b"]);
    await until(async () => (await db.expressions.get(SPACE))?.version === "v2");
    const row = (await db.expressions.get(SPACE))!;
    expect(row.packs[0].items[0].outline).toBe(btoa("\x07"));
    expect(row.packs[0].version).toBe("1");
  });

  test("with nothing cached, `known` is null", async () => {
    await loaded([]);
    expect(h.svc.GetExpressions).toHaveBeenCalledWith(SPACE, null);
  });

  test("an answer without packs keeps what we hold", async () => {
    const store = await loaded([pack("p1", 0, [item("a", "p1")])]);
    h.svc.GetExpressions.mockResolvedValueOnce(snapshot("v1", null));

    await store.refresh(SPACE, { force: true });

    expect(h.svc.GetExpressions).toHaveBeenLastCalledWith(SPACE, "v1");
    expect(store.bySpace.get(SPACE)!.version).toBe("v1");
    expect(ids(store.stickerPacks(SPACE)[0].items)).toEqual(["a"]);
  });

  test("revalidates at most once per window", async () => {
    const store = await loaded([]);
    await store.ensureLoaded(SPACE);
    await store.ensureLoaded(SPACE);
    expect(h.svc.GetExpressions).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + EXPRESSIONS_REVALIDATE_MS + 1);
    await store.ensureLoaded(SPACE);
    expect(h.svc.GetExpressions).toHaveBeenCalledTimes(2);
    expect(h.svc.GetExpressions).toHaveBeenLastCalledWith(SPACE, "v1");
  });

  test("packs and items come out in sortOrder", async () => {
    const store = await loaded([
      pack("late", 2, []),
      pack("early", 0, [item("y", "early", { sortOrder: 1 }), item("x", "early", { sortOrder: 0 })]),
    ]);
    expect(packIds(store.stickerPacks(SPACE))).toEqual(["early", "late"]);
    expect(ids(store.stickerPacks(SPACE)[0].items)).toEqual(["x", "y"]);
  });
});

describe("every space the user is in (a direct chat's picker)", () => {
  const THIRD = "space-3";
  const ALL = [SPACE, OTHER, THIRD];

  const spaceRow = (spaceId: string): ArgonSpaceBase => ({
    spaceId,
    name: spaceId,
    description: "",
    avatarFieldId: null,
    topBannerFileId: null,
    boostCount: 0,
    boostLevel: 0,
    isVerified: false,
    isOfficial: false,
    hideBoostStrip: false,
    inviteImageFileId: null,
    isCommunity: null,
    mainAnnouncementChannelId: null,
  });

  const asked = () => h.svc.GetExpressions.mock.calls.map((c: unknown[]) => c[0]);

  /** Lets the sweep's pauses pass until it is done. */
  async function settle(run: Promise<void>) {
    let done = false;
    void run.then(() => (done = true));
    for (let i = 0; i < 100 && !done; i++) {
      await vi.advanceTimersByTimeAsync(EXPRESSIONS_LOAD_ALL_GAP_MS);
      await tick();
    }
    expect(done).toBe(true);
  }

  beforeEach(async () => {
    await db.servers.clear();
    await db.servers.bulkPut(ALL.map(spaceRow));
  });

  afterEach(async () => {
    await db.servers.clear();
  });

  test("the cached copies at once, then one request per space with a pause between", async () => {
    await db.expressions.put({ spaceId: THIRD, version: "v0", packs: [], updatedAt: 1 });
    const store = useExpressionsStore();
    const run = store.ensureLoadedAll();

    await until(() => asked().length === 1);
    expect(store.bySpace.get(THIRD)?.loadedAt).toBe(0);

    await vi.advanceTimersByTimeAsync(EXPRESSIONS_LOAD_ALL_GAP_MS - 1);
    await tick();
    expect(asked()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => asked().length === 2);

    await settle(run);
    expect(asked()).toEqual(ALL);
    expect(h.svc.GetExpressions).toHaveBeenLastCalledWith(THIRD, "v0");
    expect([...store.bySpace.keys()].sort()).toEqual(ALL);
  });

  test("at most one sweep per interval; a call meanwhile joins the running one", async () => {
    const store = useExpressionsStore();
    const run = Promise.all([store.ensureLoadedAll(), store.ensureLoadedAll()]).then(() => {});
    await settle(run);
    expect(asked()).toHaveLength(3);

    await store.ensureLoadedAll();
    expect(asked()).toHaveLength(3);

    vi.setSystemTime(Date.now() + EXPRESSIONS_LOAD_ALL_INTERVAL_MS);
    await settle(store.ensureLoadedAll());
    expect(asked()).toHaveLength(6);
  });

  test("a space loaded lately is not asked again, and costs no pause", async () => {
    const store = useExpressionsStore();
    await store.ensureLoaded(OTHER);
    const run = store.ensureLoadedAll();
    await until(() => asked().length === 2);
    await vi.advanceTimersByTimeAsync(EXPRESSIONS_LOAD_ALL_GAP_MS);
    await until(() => asked().length === 3);
    await settle(run);
    expect(asked()).toEqual([OTHER, SPACE, THIRD]);
  });

  test("a session reset stops a sweep under way", async () => {
    const store = useExpressionsStore();
    const run = store.ensureLoadedAll();
    await until(() => asked().length === 1);
    await runSessionReset();
    await settle(run);
    expect(asked()).toHaveLength(1);
  });
});

describe("deltas that follow on from our version", () => {
  const base = () => [
    pack("p1", 0, [item("a", "p1", { sortOrder: 0 }), item("b", "p1", { sortOrder: 1 })]),
    pack("p2", 1, [item("c", "p2")]),
  ];

  async function applied(delta: IExpressionDelta) {
    const store = await loaded(base());
    store.applyChange(changed("v2", "v1", delta));
    expect(store.bySpace.get(SPACE)!.version).toBe("v2");
    await until(async () => (await db.expressions.get(SPACE))?.version === "v2");
    expect(h.svc.GetExpressions).toHaveBeenCalledTimes(1);
    return store;
  }

  test("PackUpserted replaces the pack's details and keeps its items", async () => {
    const store = await applied(new PackUpserted(pack("p1", 5, [], { title: "Renamed" })));
    const packs = store.stickerPacks(SPACE);
    expect(packIds(packs)).toEqual(["p2", "p1"]);
    expect(packs[1].title).toBe("Renamed");
    expect(ids(packs[1].items)).toEqual(["a", "b"]);
  });

  test("PackUpserted adds a new pack in its place", async () => {
    const store = await applied(new PackUpserted(pack("p0", -1, [item("z", "p0")])));
    expect(packIds(store.stickerPacks(SPACE))).toEqual(["p0", "p1", "p2"]);
    expect(store.itemById("z")?.packId).toBe("p0");
  });

  test("PackDeleted drops the pack and its items", async () => {
    const store = await applied(new PackDeleted("p1"));
    expect(packIds(store.stickerPacks(SPACE))).toEqual(["p2"]);
    expect(store.itemById("a")).toBeNull();
  });

  test("ItemUpserted inserts by sortOrder, or replaces in place", async () => {
    const store = await applied(new ItemUpserted(item("m", "p1", { sortOrder: 1, name: "middle" })));
    // Equal sortOrder: tie broken by id.
    expect(ids(store.stickerPacks(SPACE)[0].items)).toEqual(["a", "b", "m"]);

    store.applyChange(changed("v3", "v2", new ItemUpserted(item("a", "p1", { sortOrder: 9, name: "renamed" }))));
    expect(ids(store.stickerPacks(SPACE)[0].items)).toEqual(["b", "m", "a"]);
    expect(store.itemById("a")?.name).toBe("renamed");
  });

  test("ItemDeleted drops the item", async () => {
    const store = await applied(new ItemDeleted("p1", "a"));
    expect(ids(store.stickerPacks(SPACE)[0].items)).toEqual(["b"]);
  });

  test("PacksReordered reorders the packs of that kind", async () => {
    const store = await applied(new PacksReordered(ExpressionKind.Sticker, ["p2", "p1"]));
    expect(packIds(store.stickerPacks(SPACE))).toEqual(["p2", "p1"]);
  });

  test("ItemsReordered reorders the pack's items", async () => {
    const store = await applied(new ItemsReordered("p1", ["b", "a"]));
    expect(ids(store.stickerPacks(SPACE)[0].items)).toEqual(["b", "a"]);
  });
});

describe("deltas that do not line up", () => {
  test("a mismatched base is refetched once, after the debounce and the jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const store = await loaded([pack("p1", 0, [])]);
    h.svc.GetExpressions.mockResolvedValueOnce(snapshot("v4", [pack("p9", 0, [])]));

    store.applyChange(changed("v3", "v2", new PackDeleted("p1")));
    store.applyChange(changed("v4", "v3", new PackDeleted("p1")));
    // Untouched until the refetch lands.
    expect(store.bySpace.get(SPACE)!.version).toBe("v1");

    await vi.advanceTimersByTimeAsync(EXPRESSIONS_REFRESH_DEBOUNCE_MS + EXPRESSIONS_REFRESH_JITTER_MS - 1);
    expect(h.svc.GetExpressions).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await until(() => store.bySpace.get(SPACE)!.version === "v4");
    expect(h.svc.GetExpressions).toHaveBeenCalledTimes(2);
    expect(h.svc.GetExpressions).toHaveBeenLastCalledWith(SPACE, "v1");
    expect(packIds(store.stickerPacks(SPACE))).toEqual(["p9"]);
  });

  test("a change with no delta is refetched", async () => {
    const store = await loaded([]);
    store.applyChange(changed("v2", "v1", null));
    await vi.advanceTimersByTimeAsync(EXPRESSIONS_REFRESH_DEBOUNCE_MS + EXPRESSIONS_REFRESH_JITTER_MS);
    await until(() => h.svc.GetExpressions.mock.calls.length === 2);
  });

  test("an item for a pack we do not have is refetched", async () => {
    const store = await loaded([]);
    store.applyChange(changed("v2", "v1", new ItemUpserted(item("a", "nowhere"))));
    expect(store.bySpace.get(SPACE)!.version).toBe("v1");
    await vi.advanceTimersByTimeAsync(EXPRESSIONS_REFRESH_DEBOUNCE_MS + EXPRESSIONS_REFRESH_JITTER_MS);
    await until(() => h.svc.GetExpressions.mock.calls.length === 2);
  });

  test("a space not loaded this session is left for its next load", async () => {
    const store = await loaded([]);
    store.applyChange(changed("v2", "v1", new PackDeleted("p1"), OTHER));
    await vi.advanceTimersByTimeAsync(EXPRESSIONS_REFRESH_DEBOUNCE_MS + EXPRESSIONS_REFRESH_JITTER_MS);
    expect(h.svc.GetExpressions).toHaveBeenCalledTimes(1);
    expect(store.bySpace.has(OTHER)).toBe(false);
  });

  test("a change during the first load asks again once it lands", async () => {
    const store = useExpressionsStore();
    const first = deferred<ExpressionsSnapshot>();
    h.svc.GetExpressions.mockReturnValueOnce(first.promise);
    h.svc.GetExpressions.mockResolvedValueOnce(snapshot("v2", [pack("p2", 0, [])]));

    const done = store.ensureLoaded(SPACE);
    await until(() => h.svc.GetExpressions.mock.calls.length === 1);
    store.applyChange(changed("v2", "v1", new PackUpserted(pack("p2", 0, []))));
    first.resolve(snapshot("v1", [pack("p1", 0, [])]));
    await done;

    expect(h.svc.GetExpressions).toHaveBeenLastCalledWith(SPACE, "v1");
    expect(store.bySpace.get(SPACE)!.version).toBe("v2");
    expect(packIds(store.stickerPacks(SPACE))).toEqual(["p2"]);
  });

  test("an answer overtaken by a delta is dropped and asked again", async () => {
    const store = await loaded([pack("p1", 0, [])]);
    const stale = deferred<ExpressionsSnapshot>();
    h.svc.GetExpressions.mockReturnValueOnce(stale.promise);
    h.svc.GetExpressions.mockResolvedValueOnce(snapshot("v2", null));

    const done = store.refresh(SPACE, { force: true });
    await until(() => h.svc.GetExpressions.mock.calls.length === 2);
    store.applyChange(changed("v2", "v1", new PackUpserted(pack("p2", 1, []))));
    stale.resolve(snapshot("v1", null));
    await done;

    expect(h.svc.GetExpressions).toHaveBeenCalledTimes(3);
    expect(h.svc.GetExpressions).toHaveBeenLastCalledWith(SPACE, "v2");
    expect(store.bySpace.get(SPACE)!.version).toBe("v2");
    expect(packIds(store.stickerPacks(SPACE))).toEqual(["p1", "p2"]);
  });
});

describe("lookups", () => {
  const stickers = pack("stickers", 0, [
    item("s-cat", "stickers", { name: "cat_wave", keywords: ["hello", "hi"], emoji: ["👋"] }),
    item("s-dog", "stickers", { name: "dog", keywords: ["woof"], emoji: ["🐶", "❤️"] }),
    item("s-hi", "stickers", { name: "hi" }),
  ]);
  const emoji = pack(
    "emoji",
    1,
    [
      item("e-parrot", "emoji", { kind: ExpressionKind.Emoji, name: "PartyParrot", keywords: ["bird"], sortOrder: 0 }),
      item("e-party", "emoji", { kind: ExpressionKind.Emoji, name: "party", emoji: ["🎉"], sortOrder: 1 }),
      item("e-cat", "emoji", { kind: ExpressionKind.Emoji, name: "blobcat", sortOrder: 2 }),
    ],
    { kind: ExpressionKind.Emoji },
  );

  test("stickers by emoji, ignoring skin tone and presentation selectors", async () => {
    const store = await loaded([stickers, emoji]);
    expect(ids(store.searchStickers(SPACE, "👋🏽"))).toEqual(["s-cat"]);
    expect(ids(store.searchStickers(SPACE, "❤"))).toEqual(["s-dog"]);
    expect(ids(store.searchStickers(SPACE, "🎉"))).toEqual([]);
  });

  test("stickers by name and keyword, best match first", async () => {
    const store = await loaded([stickers, emoji]);
    expect(ids(store.searchStickers(SPACE, "hi"))).toEqual(["s-hi", "s-cat"]);
    expect(ids(store.searchStickers(SPACE, "woo"))).toEqual(["s-dog"]);
    expect(ids(store.searchStickers(SPACE, "wave"))).toEqual(["s-cat"]);
    expect(ids(store.searchStickers(SPACE, "  "))).toEqual(["s-cat", "s-dog", "s-hi"]);
  });

  test("emoji search covers only emoji", async () => {
    const store = await loaded([stickers, emoji]);
    expect(ids(store.searchEmoji(SPACE, "cat"))).toEqual(["e-cat"]);
    expect(ids(store.searchEmoji(SPACE, "bird"))).toEqual(["e-parrot"]);
    expect(ids(store.searchEmoji(SPACE, "🎉"))).toEqual(["e-party"]);
  });

  test("emoji by name: case-insensitive, colons optional, across spaces with null", async () => {
    const store = await loaded([stickers, emoji]);
    expect(store.emojiByName(SPACE, ":partyparrot:")?.itemId).toBe("e-parrot");
    expect(store.emojiByName(SPACE, "PARTY")?.itemId).toBe("e-party");
    expect(store.emojiByName(SPACE, "dog")).toBeNull();
    expect(store.emojiByName(OTHER, "party")).toBeNull();
    expect(store.emojiByName(null, "party")?.itemId).toBe("e-party");
  });

  test("candidates: prefix matches shortest first, then substring matches, capped", async () => {
    const store = await loaded([stickers, emoji]);
    expect(ids(store.emojiCandidates(SPACE, ":par", 10))).toEqual(["e-party", "e-parrot"]);
    expect(ids(store.emojiCandidates(SPACE, "cat", 10))).toEqual(["e-cat"]);
    expect(ids(store.emojiCandidates(SPACE, "", 2))).toEqual(["e-parrot", "e-party"]);
    expect(store.emojiCandidates(SPACE, "a", 1)).toHaveLength(1);
  });

  test("items by id across loaded spaces, and quota usage", async () => {
    const store = await loaded([stickers, emoji]);
    expect(store.itemById("S-DOG")?.name).toBe("dog");
    expect(store.itemById("missing")).toBeNull();
    expect(store.quotaUsage(SPACE)).toEqual({ emoji: 3, stickers: 3, packs: 2 });
    expect(store.quotaUsage(OTHER)).toEqual({ emoji: 0, stickers: 0, packs: 0 });
  });

  test("toMedia carries what the renderer needs", () => {
    const outline = new Uint8Array([1]);
    const media = toMedia(item("a", "p", { format: ExpressionFormat.Lottie, outline, thumbFileId: "t", textColor: true }));
    expect(media).toEqual({
      fileId: "f-a",
      format: 1,
      width: 512,
      height: 512,
      outline,
      thumbFileId: "t",
      downloadUrl: null,
      thumbUrl: null,
      textColor: true,
    });
  });
});

describe("recents", () => {
  test("most recent first, no duplicates, capped", async () => {
    const store = await loaded([pack("p1", 0, [item("a", "p1"), item("b", "p1")])]);
    for (let i = 0; i < 40; i++) store.pushRecentSticker(item(`x${i}`, "p1"));
    expect(store.recentStickers).toHaveLength(RECENT_EXPRESSIONS_LIMIT);
    expect(store.recentStickers[0]).toBe("x39");

    store.pushRecentSticker(item("a", "p1"));
    store.pushRecentSticker(item("b", "p1"));
    store.pushRecentSticker(item("a", "p1"));
    expect(store.recentStickers.slice(0, 2)).toEqual(["a", "b"]);
    expect(store.recentStickers.filter((id) => id === "a")).toHaveLength(1);
    expect(store.recentStickers).toHaveLength(RECENT_EXPRESSIONS_LIMIT);

    // Only what is loaded resolves.
    expect(ids(store.recentStickerItems(SPACE))).toEqual(["a", "b"]);
    expect(JSON.parse(localStorage.getItem("argon_recent_stickers::default")!)[0]).toBe("a");
  });

  test("emoji recents are their own list", async () => {
    const store = await loaded([pack("e", 0, [item("e1", "e", { kind: ExpressionKind.Emoji })], { kind: ExpressionKind.Emoji })]);
    for (let i = 0; i < 40; i++) store.pushRecentEmoji(item(`y${i}`, "e", { kind: ExpressionKind.Emoji }));
    store.pushRecentEmoji(store.itemById("e1")!);
    expect(store.recentEmoji).toHaveLength(RECENT_EXPRESSIONS_LIMIT);
    expect(store.recentStickers).toEqual([]);
    expect(ids(store.recentEmojiItems(SPACE))).toEqual(["e1"]);
  });
});

describe("mutations", () => {
  test("uploadItem: begin, upload, thumbnail the same way, then AddItem — and the item is applied", async () => {
    const store = await loaded([pack("p1", 0, [])]);
    const calls: string[] = [];
    let blob = 0;
    h.svc.BeginUploadExpression.mockImplementation(async (_s: string, _k: number, format: number, contentType: string, size: bigint) => {
      calls.push(`begin ${format} ${contentType} ${size}`);
      return new SuccessUploadFile(`blob-${blob++}`, "https://upload", [], 60);
    });
    h.uploadFile.mockImplementation(async (begin: SuccessUploadFile, _data: Blob, _ctx: string, opts?: { onProgress?: (p: number) => void }) => {
      calls.push(`upload ${begin.blobId}`);
      opts?.onProgress?.(1);
      return { blobId: begin.blobId };
    });
    const added = item("new", "p1", { name: "wave", emoji: ["👋"] });
    h.svc.AddItem.mockImplementation(async () => {
      calls.push("add");
      return new SuccessItem(added);
    });

    const progress: number[] = [];
    const outline = new Uint8Array([3, 4]);
    const result = await store.uploadItem({
      spaceId: SPACE,
      packId: "p1",
      kind: ExpressionKind.Sticker,
      format: ExpressionFormat.Lottie,
      file: new Blob(["{}"], { type: "application/json" }),
      contentType: "application/json",
      thumb: new Blob(["png!"], { type: "image/png" }),
      name: "wave",
      emoji: ["👋"],
      keywords: ["hello"],
      outline,
      onProgress: (p) => progress.push(p),
    });

    expect(calls).toEqual([
      "begin 1 application/json 2",
      "upload blob-0",
      "begin 0 image/png 4",
      "upload blob-1",
      "add",
    ]);
    expect(h.svc.AddItem).toHaveBeenCalledWith(SPACE, "p1", "blob-0", "blob-1", "wave", ["👋"], ["hello"], outline);
    expect(result).toBe(added);
    expect(progress.at(-1)).toBe(1);
    expect(ids(store.stickerPacks(SPACE)[0].items)).toEqual(["new"]);
  });

  test("uploadItem without a thumbnail sends a null thumb blob", async () => {
    const store = await loaded([pack("p1", 0, [])]);
    h.svc.BeginUploadExpression.mockResolvedValue(new SuccessUploadFile("blob-0", "https://upload", [], 60));
    h.uploadFile.mockResolvedValue({ blobId: "blob-0" });
    h.svc.AddItem.mockResolvedValue(new SuccessItem(item("new", "p1")));

    await store.uploadItem({
      spaceId: SPACE,
      packId: "p1",
      kind: ExpressionKind.Sticker,
      format: ExpressionFormat.Static,
      file: new Blob(["x"]),
      contentType: "image/webp",
      name: "n",
      emoji: [],
      keywords: [],
    });

    expect(h.svc.BeginUploadExpression).toHaveBeenCalledTimes(1);
    expect(h.svc.AddItem).toHaveBeenCalledWith(SPACE, "p1", "blob-0", null, "n", [], [], null);
  });

  test("createPack and updatePack apply the returned pack; the patch carries only what was given", async () => {
    const store = await loaded([pack("p1", 0, [item("a", "p1")])]);
    h.svc.CreatePack.mockResolvedValue(new SuccessPack(pack("p2", 1, [])));
    h.svc.UpdatePack.mockResolvedValue(new SuccessPack(pack("p1", 0, [], { title: "New" })));

    await store.createPack(SPACE, ExpressionKind.Sticker, "p2", "p2");
    await store.updatePack(SPACE, "p1", { title: "New", slug: undefined, coverItemId: null });

    expect(h.svc.UpdatePack).toHaveBeenCalledWith(SPACE, "p1", { title: "New", coverItemId: null });
    const packs = store.stickerPacks(SPACE);
    expect(packIds(packs)).toEqual(["p1", "p2"]);
    expect(packs[0].title).toBe("New");
    expect(ids(packs[0].items)).toEqual(["a"]);
  });

  test("a refusal is thrown as ExpressionRefusal with its i18n key, and nothing is applied", async () => {
    const store = await loaded([pack("p1", 0, [item("a", "p1")])]);
    h.svc.CreatePack.mockResolvedValue(new FailedPack(ExpressionError.QUOTA_EXCEEDED));
    h.svc.DeleteItem.mockResolvedValue(new FailedItem(ExpressionError.FORBIDDEN));

    const refused = await store.createPack(SPACE, ExpressionKind.Sticker, "t", "t").catch((e) => e);
    expect(refused).toBeInstanceOf(ExpressionRefusal);
    expect(refused).toMatchObject({ error: ExpressionError.QUOTA_EXCEEDED, key: "expression_error_quota_exceeded" });

    await expect(store.deleteItem(SPACE, "a")).rejects.toMatchObject({ key: "expression_error_forbidden" });
    expect(ids(store.stickerPacks(SPACE)[0].items)).toEqual(["a"]);
  });

  test("every error has a message in en and ru; an unknown one gets the generic message", () => {
    const values = Object.values(ExpressionError).filter((v): v is ExpressionError => typeof v === "number");
    for (const value of values) {
      const key = expressionErrorKey(value);
      expect((en as unknown as Record<string, unknown>)[key], key).toBeTruthy();
      expect((ru as unknown as Record<string, unknown>)[key], key).toBeTruthy();
    }
    expect(expressionErrorKey(99 as ExpressionError)).toBe("expression_error_unknown");
    expect(expressionErrorKey(ExpressionError.NONE)).toBe("expression_error_unknown");
  });
});

describe("resolver", () => {
  test("the store-backed resolver reads the store; outside a component the noop one stands in", async () => {
    await loaded([pack("e", 0, [item("e1", "e", { kind: ExpressionKind.Emoji, name: "blob" })], { kind: ExpressionKind.Emoji })]);
    const resolver = createStoreResolver();
    expect(resolver.emojiByName(SPACE, ":blob:")?.itemId).toBe("e1");
    expect(resolver.itemById("e1")?.name).toBe("blob");
    expect(ids(resolver.emojiCandidates(null, "bl", 5))).toEqual(["e1"]);

    resolver.ensureLoaded(OTHER);
    await until(() => h.svc.GetExpressions.mock.calls.length === 2);
    expect(h.svc.GetExpressions).toHaveBeenLastCalledWith(OTHER, null);

    expect(useExpressionResolver()).toBe(noopResolver);
  });
});
