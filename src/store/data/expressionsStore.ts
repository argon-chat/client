import { defineStore } from "pinia";
import { computed, shallowReactive, shallowRef } from "vue";
import { delay, logger } from "@argon/core";
import { persisted, type PersistedRef } from "@argon/storage";
import {
  ExpressionError,
  ExpressionFormat,
  ExpressionKind,
  type ExpressionItem,
  type ExpressionPack,
  type ExpressionsSnapshot,
  type IExpressionDelta,
  type IItemResult,
  type IPackResult,
  type IReorderResult,
  type SpaceExpressionsChanged,
} from "@argon/glue";
import type { IonPartial } from "@argon-chat/ion.webcore";
import { useApi } from "@/store/system/apiStore";
import { db, type StoredExpressionItem, type StoredExpressionPack, type StoredExpressions } from "@/store/db/dexie";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { userScopedKey } from "@/lib/userScopedStorage";
import { uploadFile } from "@/lib/uploadFile";
import { ExpressionRefusal } from "@/lib/refusals";
import { metrics } from "@/lib/telemetry/metrics";
import type { ExpressionMedia } from "@/lib/expressions/types";

/** A space is revalidated against the server at most this often, unless an event says it moved. */
export const EXPRESSIONS_REVALIDATE_MS = 60_000;
/** After a failed revalidation, how soon the next `ensureLoaded` may try again. */
export const EXPRESSIONS_RETRY_MS = 5_000;
/** Event-triggered refetches wait for the burst to end, then a random share of the jitter. */
export const EXPRESSIONS_REFRESH_DEBOUNCE_MS = 300;
export const EXPRESSIONS_REFRESH_JITTER_MS = 2_000;
export const RECENT_EXPRESSIONS_LIMIT = 32;
/** `ensureLoadedAll` sweeps the user's spaces at most this often. */
export const EXPRESSIONS_LOAD_ALL_INTERVAL_MS = 5 * 60_000;
/** Pause between two of the sweep's requests, so opening the picker is not a burst. */
export const EXPRESSIONS_LOAD_ALL_GAP_MS = 250;

export const RECENT_STICKERS_KEY = "argon_recent_stickers";
export const RECENT_EMOJI_KEY = "argon_recent_emoji";

export interface SpaceExpressions {
  /** The server's token for the whole set, sent back as `known`. */
  version: string | null;
  /** By sortOrder; each pack's items by sortOrder. */
  packs: ExpressionPack[];
  /** When the server last confirmed this copy; 0 while it is only the cached one. */
  loadedAt: number;
}

export interface ExpressionQuotaUsage {
  emoji: number;
  stickers: number;
  packs: number;
}

export type ExpressionPackPatch = Pick<IonPartial<ExpressionPack>, "title" | "slug" | "coverItemId">;
export type ExpressionItemPatch = Pick<IonPartial<ExpressionItem>, "name" | "emoji" | "keywords" | "textColor">;

export interface UploadExpressionOptions {
  spaceId: string;
  packId: string;
  kind: ExpressionKind;
  format: ExpressionFormat;
  file: Blob;
  contentType: string;
  /** A static preview, uploaded as its own blob. */
  thumb?: Blob | null;
  name: string;
  emoji: string[];
  keywords: string[];
  outline?: Uint8Array | null;
  /** 0–1 over the whole upload, AddItem included. */
  onProgress?: (progress: number) => void;
}

/** The six delta cases, detached from the glue classes so local results can use the same path. */
type ExpressionChange =
  | { type: "packUpserted"; pack: ExpressionPack }
  | { type: "packDeleted"; packId: string }
  | { type: "itemUpserted"; item: ExpressionItem }
  | { type: "itemDeleted"; packId: string; itemId: string }
  | { type: "packsReordered"; kind: ExpressionKind; ordered: string[] }
  | { type: "itemsReordered"; packId: string; ordered: string[] };

// ── pure helpers ────────────────────────────────────────────────────────────────────────────────

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const compareItems = (a: ExpressionItem, b: ExpressionItem) => a.sortOrder - b.sortOrder || byId(a.itemId, b.itemId);
const comparePacks = (a: ExpressionPack, b: ExpressionPack) => a.sortOrder - b.sortOrder || byId(a.packId, b.packId);

function normalizePack(pack: ExpressionPack): ExpressionPack {
  return { ...pack, items: [...(pack.items ?? [])].sort(compareItems) };
}

function reorder<T extends { sortOrder: number }>(
  list: T[],
  idOf: (x: T) => string,
  ordered: readonly string[],
  applies: (x: T) => boolean = () => true,
): T[] {
  const rank = new Map(ordered.map((id, i) => [id, i]));
  // Anything the list does not name goes after it, in its current order.
  let tail = ordered.length;
  return list.map((x) => (applies(x) ? { ...x, sortOrder: rank.get(idOf(x)) ?? tail++ } : x));
}

function fromDelta(delta: IExpressionDelta): ExpressionChange | null {
  if (delta.isPackUpserted()) return { type: "packUpserted", pack: delta.pack };
  if (delta.isPackDeleted()) return { type: "packDeleted", packId: delta.packId };
  if (delta.isItemUpserted()) return { type: "itemUpserted", item: delta.item };
  if (delta.isItemDeleted()) return { type: "itemDeleted", packId: delta.packId, itemId: delta.itemId };
  if (delta.isPacksReordered()) return { type: "packsReordered", kind: delta.kind, ordered: [...delta.ordered] };
  if (delta.isItemsReordered()) return { type: "itemsReordered", packId: delta.packId, ordered: [...delta.ordered] };
  return null;
}

/** The packs after `change`, or null when it cannot be applied to them (a refetch is due). */
function applyToPacks(packs: ExpressionPack[], change: ExpressionChange): ExpressionPack[] | null {
  switch (change.type) {
    case "packUpserted": {
      const existing = packs.find((p) => p.packId === change.pack.packId);
      const next = existing ? { ...change.pack, items: existing.items } : normalizePack(change.pack);
      return [...packs.filter((p) => p.packId !== next.packId), next].sort(comparePacks);
    }
    case "packDeleted":
      return packs.filter((p) => p.packId !== change.packId);
    case "itemUpserted": {
      const item = change.item;
      if (!packs.some((p) => p.packId === item.packId)) return null;
      return packs.map((p) => {
        const rest = p.items.filter((i) => i.itemId !== item.itemId);
        if (p.packId === item.packId) return { ...p, items: [...rest, item].sort(compareItems) };
        return rest.length === p.items.length ? p : { ...p, items: rest };
      });
    }
    case "itemDeleted":
      return packs.map((p) =>
        p.items.some((i) => i.itemId === change.itemId) ? { ...p, items: p.items.filter((i) => i.itemId !== change.itemId) } : p,
      );
    case "packsReordered":
      return reorder(packs, (p) => p.packId, change.ordered, (p) => p.kind === change.kind).sort(comparePacks);
    case "itemsReordered": {
      if (!packs.some((p) => p.packId === change.packId)) return null;
      return packs.map((p) =>
        p.packId === change.packId ? { ...p, items: reorder(p.items, (i) => i.itemId, change.ordered).sort(compareItems) } : p,
      );
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toStoredPack(pack: ExpressionPack): StoredExpressionPack {
  return {
    ...pack,
    version: String(pack.version),
    items: pack.items.map((item): StoredExpressionItem => ({
      ...item,
      emoji: [...item.emoji],
      keywords: [...item.keywords],
      outline: item.outline?.length ? bytesToBase64(item.outline) : null,
    })),
  };
}

function fromStoredPack(pack: StoredExpressionPack): ExpressionPack {
  return {
    ...pack,
    version: BigInt(pack.version),
    items: pack.items.map((item): ExpressionItem => ({
      ...item,
      outline: item.outline ? base64ToBytes(item.outline) : null,
    })),
  };
}

const stripColons = (name: string) => name.trim().replace(/^:+|:+$/g, "");

/** Drops the presentation selector and skin tones, so 👍🏽 finds a sticker tagged 👍. */
const normalizeEmoji = (value: string) => value.replace(/[︎️\u{1F3FB}-\u{1F3FF}]/gu, "");

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const KEYCAP = /[#*0-9]️?⃣/gu;
const WORDY = /[\p{L}\p{N}]/u;

/** Whether a search query is an emoji rather than words. */
export function isEmojiQuery(query: string): boolean {
  const q = query.trim();
  return q.length > 0 && PICTOGRAPH.test(q) && !WORDY.test(q.replace(KEYCAP, ""));
}

/** Items ranked against a search: emoji match `item.emoji`, words match name then keywords. */
function searchItems(items: ExpressionItem[], query: string): ExpressionItem[] {
  const trimmed = query.trim();
  if (!trimmed) return items;

  if (isEmojiQuery(trimmed)) {
    const wanted = normalizeEmoji(trimmed);
    return items.filter((item) => item.emoji.some((e) => normalizeEmoji(e) === wanted));
  }

  const q = stripColons(trimmed).toLowerCase();
  if (!q) return items;
  const score = (item: ExpressionItem): number => {
    const name = item.name.toLowerCase();
    if (name === q) return 6;
    if (name.startsWith(q)) return 5;
    const keywords = item.keywords.map((k) => k.toLowerCase());
    if (keywords.includes(q)) return 4;
    if (keywords.some((k) => k.startsWith(q))) return 3;
    if (name.includes(q)) return 2;
    if (keywords.some((k) => k.includes(q))) return 1;
    return 0;
  };
  return items
    .map((item, order) => ({ item, order, score: score(item) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((x) => x.item);
}

/** What the Phase 2a render components take. */
export function toMedia(item: ExpressionItem): ExpressionMedia {
  return {
    fileId: item.fileId,
    format: item.format as number as ExpressionMedia["format"],
    width: item.width,
    height: item.height,
    outline: item.outline,
    thumbFileId: item.thumbFileId,
    downloadUrl: item.downloadUrl,
    thumbUrl: item.thumbUrl,
    textColor: item.textColor,
  };
}

function unwrapPack(result: IPackResult): ExpressionPack {
  if (result.isFailedPack()) throw new ExpressionRefusal(result.error);
  if (result.isSuccessPack()) return result.pack;
  throw new ExpressionRefusal(ExpressionError.NONE);
}

function unwrapItem(result: IItemResult): ExpressionItem {
  if (result.isFailedItem()) throw new ExpressionRefusal(result.error);
  if (result.isSuccessItem()) return result.item;
  throw new ExpressionRefusal(ExpressionError.NONE);
}

function unwrapReorder(result: IReorderResult): string[] {
  if (result.isFailedReorder()) throw new ExpressionRefusal(result.error);
  if (result.isSuccessReorder()) return [...result.ordered];
  throw new ExpressionRefusal(ExpressionError.NONE);
}

const UPLOAD_FORMATS: Record<ExpressionFormat, "static" | "lottie" | "video"> = {
  [ExpressionFormat.Static]: "static",
  [ExpressionFormat.Lottie]: "lottie",
  [ExpressionFormat.Video]: "video",
};

function uploadMetricAttrs(kind: ExpressionKind, format: ExpressionFormat) {
  return {
    kind: kind === ExpressionKind.Emoji ? "emoji" : "sticker",
    format: UPLOAD_FORMATS[format] ?? "static",
  } as const;
}

/** A server refusal by its reason (`QUOTA_EXCEEDED`), anything else by its class. */
function uploadErrorKind(e: unknown): string {
  return e instanceof ExpressionRefusal ? metrics.enumName(ExpressionError, e.error) : metrics.errorKind(e);
}

/** Only the fields the caller gave; a given null clears the field. */
function partialOf<T>(input: IonPartial<T>, keys: readonly (keyof T)[]): IonPartial<T> {
  const patch: IonPartial<T> = {};
  for (const key of keys) {
    const value = input[key];
    if (value === undefined) continue;
    patch[key] = (Array.isArray(value) ? [...value] : value) as T[keyof T] | null;
  }
  return patch;
}

const PACK_PATCH_KEYS = ["title", "slug", "coverItemId"] as const;
const ITEM_PATCH_KEYS = ["name", "emoji", "keywords", "textColor"] as const;

function openRecent(base: string): PersistedRef<string[]> {
  return persisted<string[]>(userScopedKey(base), []);
}

function readRecent(store: PersistedRef<string[]>): string[] {
  const value = store.value;
  return Array.isArray(value) ? value : [];
}

interface PendingRefresh {
  timer: ReturnType<typeof setTimeout> | undefined;
  promise: Promise<void>;
  resolve: () => void;
}

// ── store ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Custom emoji and stickers per space: cached in Dexie, revalidated with the server's version token,
 * kept current by `SpaceExpressionsChanged` deltas and refetched when a delta does not line up.
 */
export const useExpressionsStore = defineStore("expressions", () => {
  const api = useApi();

  const bySpace = shallowReactive(new Map<string, SpaceExpressions>());

  const hydrations = new Map<string, Promise<void>>();
  const inflight = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const nextRevalidateAt = new Map<string, number>();
  const pending = new Map<string, PendingRefresh>();
  // Bumped on session reset so an answer for the previous account is dropped.
  let generation = 0;

  const recentStickerStore = shallowRef(openRecent(RECENT_STICKERS_KEY));
  const recentEmojiStore = shallowRef(openRecent(RECENT_EMOJI_KEY));
  const recentStickers = computed(() => readRecent(recentStickerStore.value));
  const recentEmoji = computed(() => readRecent(recentEmojiStore.value));

  const index = computed(() => {
    const items = new Map<string, ExpressionItem>();
    const emojiNames = new Map<string, Map<string, ExpressionItem>>();
    for (const [spaceId, entry] of bySpace) {
      const names = new Map<string, ExpressionItem>();
      for (const pack of entry.packs) {
        for (const item of pack.items) {
          items.set(item.itemId.toLowerCase(), item);
          if (pack.kind !== ExpressionKind.Emoji) continue;
          const key = item.name.toLowerCase();
          if (!names.has(key)) names.set(key, item);
        }
      }
      emojiNames.set(spaceId, names);
    }
    return { items, emojiNames };
  });

  // ── loading ──

  async function persist(spaceId: string, entry: SpaceExpressions): Promise<void> {
    try {
      const row: StoredExpressions = {
        spaceId,
        version: entry.version,
        packs: entry.packs.map(toStoredPack),
        updatedAt: Date.now(),
      };
      await db.expressions.put(row);
    } catch (e) {
      logger.warn("[expressions] cache write failed", spaceId, e);
    }
  }

  function commit(spaceId: string, entry: SpaceExpressions): void {
    bySpace.set(spaceId, entry);
    void persist(spaceId, entry);
  }

  /** Reads the cached copy once per session; a copy already fetched is never overwritten by it. */
  function hydrate(spaceId: string): Promise<void> {
    let running = hydrations.get(spaceId);
    if (!running) {
      const gen = generation;
      running = (async () => {
        try {
          const row = await db.expressions.get(spaceId);
          if (gen !== generation || !row || bySpace.has(spaceId)) return;
          bySpace.set(spaceId, { version: row.version, packs: row.packs.map(fromStoredPack), loadedAt: 0 });
        } catch (e) {
          logger.warn("[expressions] cache read failed", spaceId, e);
        }
      })();
      hydrations.set(spaceId, running);
    }
    return running;
  }

  async function fetchOnce(spaceId: string, gen: number): Promise<void> {
    await hydrate(spaceId);
    if (gen !== generation) return;

    const known = bySpace.get(spaceId)?.version ?? null;
    let snapshot: ExpressionsSnapshot;
    try {
      snapshot = await api.spaceExpressionInteraction.GetExpressions(spaceId, known);
    } catch (e) {
      logger.warn("[expressions] fetch failed", spaceId, e);
      if (gen === generation) nextRevalidateAt.set(spaceId, Date.now() + EXPRESSIONS_RETRY_MS);
      return;
    }
    if (gen !== generation) return;

    const current = bySpace.get(spaceId);
    // A delta landed while this was in flight: the answer may be older than what we hold now.
    if ((current?.version ?? null) !== known) {
      again.add(spaceId);
      return;
    }

    const now = Date.now();
    nextRevalidateAt.set(spaceId, now + EXPRESSIONS_REVALIDATE_MS);
    if (snapshot.packs === null) {
      // `known` matched: what we hold is current.
      bySpace.set(spaceId, { version: current?.version ?? snapshot.version, packs: current?.packs ?? [], loadedAt: now });
      return;
    }
    commit(spaceId, { version: snapshot.version, packs: snapshot.packs.map(normalizePack).sort(comparePacks), loadedAt: now });
  }

  /** One request per space at a time; one asked for meanwhile runs once the current one lands. */
  function revalidate(spaceId: string): Promise<void> {
    const running = inflight.get(spaceId);
    if (running) {
      again.add(spaceId);
      return running;
    }
    const gen = generation;
    const run = (async () => {
      try {
        do {
          again.delete(spaceId);
          await fetchOnce(spaceId, gen);
        } while (gen === generation && again.has(spaceId));
      } catch (e) {
        logger.warn("[expressions] revalidation failed", spaceId, e);
      } finally {
        // A session reset already cleared it, and may have registered a newer run since.
        if (gen === generation) inflight.delete(spaceId);
      }
    })();
    inflight.set(spaceId, run);
    return run;
  }

  /**
   * The space's set, from the cache first and then the server — at most once per
   * EXPRESSIONS_REVALIDATE_MS. Cheap enough to call from a render.
   */
  function ensureLoaded(spaceId: string): Promise<void> {
    if (!spaceId) return Promise.resolve();
    const running = inflight.get(spaceId);
    if (running) return running;
    const now = Date.now();
    if (now < (nextRevalidateAt.get(spaceId) ?? 0)) return hydrate(spaceId);
    nextRevalidateAt.set(spaceId, now + EXPRESSIONS_REVALIDATE_MS);
    return revalidate(spaceId);
  }

  let loadAllRun: Promise<void> | null = null;
  let loadAllAt = -Infinity;

  const isDue = (spaceId: string) => !inflight.has(spaceId) && Date.now() >= (nextRevalidateAt.get(spaceId) ?? 0);

  /**
   * Every space the user is in (a direct chat's picker offers all of them): the cached copies at
   * once, then the server one space after another with a pause between. At most once per
   * EXPRESSIONS_LOAD_ALL_INTERVAL_MS; spaces already fresh are skipped.
   */
  function ensureLoadedAll(): Promise<void> {
    if (loadAllRun) return loadAllRun;
    const now = Date.now();
    if (now - loadAllAt < EXPRESSIONS_LOAD_ALL_INTERVAL_MS) return Promise.resolve();
    loadAllAt = now;
    const gen = generation;
    const run = (async () => {
      let spaceIds: string[];
      try {
        spaceIds = (await db.servers.toCollection().primaryKeys()).map(String);
      } catch (e) {
        logger.warn("[expressions] space list read failed", e);
        return;
      }
      if (gen !== generation) return;
      await Promise.all(spaceIds.map(hydrate));
      let requested = false;
      for (const spaceId of spaceIds) {
        if (gen !== generation) return;
        if (!isDue(spaceId)) continue;
        if (requested) {
          await delay(EXPRESSIONS_LOAD_ALL_GAP_MS);
          if (gen !== generation) return;
        }
        requested = true;
        await ensureLoaded(spaceId);
      }
    })().finally(() => {
      if (loadAllRun === run) loadAllRun = null;
    });
    loadAllRun = run;
    return run;
  }

  /**
   * Refetch because an event says the copy is behind; not held back by the revalidation window.
   * Calls within the debounce collapse into one request, sent after a random jitter so a change
   * seen by every member does not arrive at the server all at once. `force` skips the wait.
   */
  function refresh(spaceId: string, { force = false }: { force?: boolean } = {}): Promise<void> {
    let entry = pending.get(spaceId);
    if (!entry) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      entry = { timer: undefined, promise, resolve };
      pending.set(spaceId, entry);
    } else if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
    }

    const scheduled = entry;
    const fire = () => {
      if (pending.get(spaceId) === scheduled) pending.delete(spaceId);
      void revalidate(spaceId).finally(scheduled.resolve);
    };

    if (force) {
      scheduled.timer = undefined;
      fire();
    } else {
      scheduled.timer = setTimeout(fire, EXPRESSIONS_REFRESH_DEBOUNCE_MS + Math.random() * EXPRESSIONS_REFRESH_JITTER_MS);
    }
    return scheduled.promise;
  }

  /**
   * A change on the server. Applied in place when it follows straight on from our version,
   * otherwise refetched. Spaces not loaded this session are left for their next `ensureLoaded`.
   */
  function applyChange(ev: SpaceExpressionsChanged): void {
    const spaceId = String(ev.spaceId);
    const current = bySpace.get(spaceId);
    if (!current) {
      // The first load may already be on its way with an answer from before this change.
      if (inflight.has(spaceId)) again.add(spaceId);
      return;
    }
    if (current.version === ev.version) return;

    const change = ev.delta ? fromDelta(ev.delta) : null;
    if (change && ev.baseVersion !== null && ev.baseVersion === current.version) {
      const packs = applyToPacks(current.packs, change);
      if (packs) {
        commit(spaceId, { ...current, version: ev.version, packs });
        return;
      }
    }
    void refresh(spaceId);
  }

  /** A mutation's own result, applied without waiting for its event (which then applies it again). */
  function applyLocal(spaceId: string, change: ExpressionChange): void {
    const current = bySpace.get(spaceId);
    if (!current) return;
    const packs = applyToPacks(current.packs, change);
    if (packs) commit(spaceId, { ...current, packs });
    else void refresh(spaceId);
  }

  // ── reads ──

  function packs(spaceId: string, kind: ExpressionKind): ExpressionPack[] {
    return (bySpace.get(spaceId)?.packs ?? []).filter((p) => p.kind === kind);
  }

  const stickerPacks = (spaceId: string) => packs(spaceId, ExpressionKind.Sticker);
  const emojiPacks = (spaceId: string) => packs(spaceId, ExpressionKind.Emoji);

  /** Every item of `kind` in pack order; `null` means every loaded space. */
  function itemsOf(spaceId: string | null, kind: ExpressionKind): ExpressionItem[] {
    const spaces = spaceId === null ? [...bySpace.values()] : [bySpace.get(spaceId)];
    const out: ExpressionItem[] = [];
    for (const entry of spaces) {
      if (!entry) continue;
      for (const pack of entry.packs) if (pack.kind === kind) out.push(...pack.items);
    }
    return out;
  }

  function itemById(itemId: string): ExpressionItem | null {
    return itemId ? (index.value.items.get(itemId.toLowerCase()) ?? null) : null;
  }

  /** Case-insensitive, colons optional; `null` looks through every loaded space. */
  function emojiByName(spaceId: string | null, name: string): ExpressionItem | null {
    const key = stripColons(name).toLowerCase();
    if (!key) return null;
    const { emojiNames } = index.value;
    if (spaceId !== null) return emojiNames.get(spaceId)?.get(key) ?? null;
    for (const names of emojiNames.values()) {
      const hit = names.get(key);
      if (hit) return hit;
    }
    return null;
  }

  /** For `:name` completion: names starting with the prefix (shortest first), then containing it. */
  function emojiCandidates(spaceId: string | null, prefix: string, limit: number): ExpressionItem[] {
    const all = itemsOf(spaceId, ExpressionKind.Emoji);
    const q = stripColons(prefix).toLowerCase();
    if (!q) return all.slice(0, limit);
    const starts: ExpressionItem[] = [];
    const contains: ExpressionItem[] = [];
    for (const item of all) {
      const name = item.name.toLowerCase();
      if (name.startsWith(q)) starts.push(item);
      else if (name.includes(q)) contains.push(item);
    }
    starts.sort((a, b) => a.name.length - b.name.length || byId(a.name.toLowerCase(), b.name.toLowerCase()));
    return [...starts, ...contains].slice(0, limit);
  }

  const searchStickers = (spaceId: string | null, query: string) => searchItems(itemsOf(spaceId, ExpressionKind.Sticker), query);
  const searchEmoji = (spaceId: string | null, query: string) => searchItems(itemsOf(spaceId, ExpressionKind.Emoji), query);

  function recentItems(ids: string[], kind: ExpressionKind, spaceId: string | null): ExpressionItem[] {
    const out: ExpressionItem[] = [];
    for (const id of ids) {
      const item = itemById(id);
      if (item && item.kind === kind && (spaceId === null || item.spaceId === spaceId)) out.push(item);
    }
    return out;
  }

  /** Recently sent stickers that are loaded, of this space (`null`: of any loaded space). */
  const recentStickerItems = (spaceId: string | null) => recentItems(recentStickers.value, ExpressionKind.Sticker, spaceId);
  const recentEmojiItems = (spaceId: string | null) => recentItems(recentEmoji.value, ExpressionKind.Emoji, spaceId);

  function pushRecent(store: PersistedRef<string[]>, itemId: string): void {
    const next = [itemId, ...readRecent(store).filter((id) => id !== itemId)].slice(0, RECENT_EXPRESSIONS_LIMIT);
    store.set(next);
  }

  const pushRecentSticker = (item: ExpressionItem) => pushRecent(recentStickerStore.value, item.itemId);
  const pushRecentEmoji = (item: ExpressionItem) => pushRecent(recentEmojiStore.value, item.itemId);

  function quotaUsage(spaceId: string): ExpressionQuotaUsage {
    const usage: ExpressionQuotaUsage = { emoji: 0, stickers: 0, packs: 0 };
    for (const pack of bySpace.get(spaceId)?.packs ?? []) {
      usage.packs++;
      if (pack.kind === ExpressionKind.Emoji) usage.emoji += pack.items.length;
      else if (pack.kind === ExpressionKind.Sticker) usage.stickers += pack.items.length;
    }
    return usage;
  }

  // ── mutations: each throws ExpressionRefusal when refused ──

  const service = () => api.spaceExpressionInteraction;

  async function createPack(spaceId: string, kind: ExpressionKind, title: string, slug: string): Promise<ExpressionPack> {
    const pack = unwrapPack(await service().CreatePack(spaceId, kind, title, slug));
    applyLocal(spaceId, { type: "packUpserted", pack });
    return pack;
  }

  async function updatePack(spaceId: string, packId: string, patch: ExpressionPackPatch): Promise<ExpressionPack> {
    const partial = partialOf<ExpressionPack>(patch, PACK_PATCH_KEYS);
    const pack = unwrapPack(await service().UpdatePack(spaceId, packId, partial));
    applyLocal(spaceId, { type: "packUpserted", pack });
    return pack;
  }

  async function deletePack(spaceId: string, packId: string): Promise<void> {
    unwrapPack(await service().DeletePack(spaceId, packId));
    applyLocal(spaceId, { type: "packDeleted", packId });
  }

  async function reorderPacks(spaceId: string, kind: ExpressionKind, ids: string[]): Promise<string[]> {
    const ordered = unwrapReorder(await service().ReorderPacks(spaceId, kind, [...ids]));
    applyLocal(spaceId, { type: "packsReordered", kind, ordered });
    return ordered;
  }

  /** Begin → upload (and the thumbnail the same way) → AddItem. Recorded as `expression.upload`. */
  async function uploadItem(opts: UploadExpressionOptions): Promise<ExpressionItem> {
    const attrs = uploadMetricAttrs(opts.kind, opts.format);
    const timer = metrics.startTimer("expression.upload.duration", attrs);
    try {
      const item = await uploadItemSteps(opts);
      timer.end({ result: "ok" });
      metrics.count("expression.upload", { ...attrs, result: "ok" });
      return item;
    } catch (e) {
      const error = uploadErrorKind(e);
      timer.end({ result: "failed", error });
      metrics.count("expression.upload", { ...attrs, result: "failed", error });
      throw e;
    }
  }

  async function uploadItemSteps(opts: UploadExpressionOptions): Promise<ExpressionItem> {
    const { spaceId, packId, kind, format, file, contentType, thumb, onProgress } = opts;
    const fileShare = thumb ? 0.8 : 0.95;

    const begin = await service().BeginUploadExpression(spaceId, kind, format, contentType, BigInt(file.size));
    const { blobId } = await uploadFile(begin, file, "Expression", {
      onProgress: (p) => onProgress?.(p * fileShare),
    });

    let thumbBlobId: string | null = null;
    if (thumb) {
      const thumbType = thumb.type || "image/webp";
      const beginThumb = await service().BeginUploadExpression(spaceId, kind, ExpressionFormat.Static, thumbType, BigInt(thumb.size));
      thumbBlobId = (
        await uploadFile(beginThumb, thumb, "ExpressionThumb", {
          onProgress: (p) => onProgress?.(fileShare + p * 0.15),
        })
      ).blobId;
    }

    const item = unwrapItem(
      await service().AddItem(spaceId, packId, blobId, thumbBlobId, opts.name, [...opts.emoji], [...opts.keywords], opts.outline ?? null),
    );
    onProgress?.(1);
    applyLocal(spaceId, { type: "itemUpserted", item });
    return item;
  }

  async function updateItem(spaceId: string, itemId: string, patch: ExpressionItemPatch): Promise<ExpressionItem> {
    const partial = partialOf<ExpressionItem>(patch, ITEM_PATCH_KEYS);
    const item = unwrapItem(await service().UpdateItem(spaceId, itemId, partial));
    applyLocal(spaceId, { type: "itemUpserted", item });
    return item;
  }

  async function deleteItem(spaceId: string, itemId: string): Promise<void> {
    const item = unwrapItem(await service().DeleteItem(spaceId, itemId));
    applyLocal(spaceId, { type: "itemDeleted", packId: item.packId, itemId });
  }

  async function reorderItems(spaceId: string, packId: string, ids: string[]): Promise<string[]> {
    const ordered = unwrapReorder(await service().ReorderItems(spaceId, packId, [...ids]));
    applyLocal(spaceId, { type: "itemsReordered", packId, ordered });
    return ordered;
  }

  // Seamless account switch: drop the previous account's sets and read its successor's recents.
  onSessionReset(() => {
    generation++;
    for (const entry of pending.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.resolve();
    }
    pending.clear();
    hydrations.clear();
    inflight.clear();
    again.clear();
    nextRevalidateAt.clear();
    loadAllRun = null;
    loadAllAt = -Infinity;
    bySpace.clear();
    recentStickerStore.value = openRecent(RECENT_STICKERS_KEY);
    recentEmojiStore.value = openRecent(RECENT_EMOJI_KEY);
  });

  return {
    bySpace,
    recentStickers,
    recentEmoji,

    ensureLoaded,
    ensureLoadedAll,
    refresh,
    applyChange,

    packs,
    stickerPacks,
    emojiPacks,
    itemById,
    emojiByName,
    emojiCandidates,
    searchStickers,
    searchEmoji,
    recentStickerItems,
    recentEmojiItems,
    pushRecentSticker,
    pushRecentEmoji,
    quotaUsage,
    toMedia,

    createPack,
    updatePack,
    deletePack,
    reorderPacks,
    uploadItem,
    updateItem,
    deleteItem,
    reorderItems,
  };
});
