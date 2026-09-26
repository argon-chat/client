/**
 * The message cache made to agree with a page of history from the server (real Dexie on
 * fake-indexeddb).
 *
 * MessageDeleted and MessageUpdated reach only the channel's current viewers, so a client that was
 * elsewhere keeps the deleted message, or the old text, in its cache — and the channel serves its
 * cached rows first. A page the server returns is the truth for the ids it spans: cached rows there
 * that it did not return are gone, and the rest take the server's copy.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

await vi.hoisted(async () => {
  const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
});

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
}));

import { db, ensureDbOpen } from "@/store/db/dexie";
import { useMessageStore } from "@/store/data/messageStore";

const msg = (messageId: bigint, text = `m${messageId}`, channelId = "c1") =>
  ({ messageId, channelId, spaceId: "s1", text, entities: [], sender: "u1", replyId: null }) as any;

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => BigInt(from + i));

async function cachedIds(channelId = "c1"): Promise<bigint[]> {
  const rows = await db.messages.toArray();
  return rows
    .filter((r) => r.channelId === channelId)
    .map((r) => r.messageId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

let store: ReturnType<typeof useMessageStore>;

beforeEach(async () => {
  setActivePinia(createPinia());
  await ensureDbOpen();
  await db.messages.clear();
  store = useMessageStore();
});

describe("reconcileMessages", () => {
  test("a cached message the newest page no longer has is deleted, an edited one takes the server's text", async () => {
    await store.cacheMessages([msg(1n), msg(2n, "before the edit"), msg(3n), msg(4n)]);

    const gone = await store.reconcileMessages("s1", "c1", [msg(1n), msg(2n, "after the edit"), msg(4n)], {
      before: null,
      reachedStart: true,
    });

    expect(gone).toEqual([3n]);
    expect(await cachedIds()).toEqual([1n, 2n, 4n]);
    expect((await store.getMessageById(2n))?.text).toBe("after the edit");
  });

  test("the newest page vouches for everything above it: a deleted last message goes too", async () => {
    await store.cacheMessages(range(1, 60).map((id) => msg(id)));
    // A full page: the server has older messages, which this page says nothing about.
    const page = range(10, 59).map((id) => msg(id));

    await store.reconcileMessages("s1", "c1", page, { before: null, reachedStart: false });

    expect(await cachedIds()).toEqual(range(1, 59));
  });

  test("an older page vouches only for its own span", async () => {
    await store.cacheMessages([...range(1, 10), ...range(95, 105)].map((id) => msg(id)));
    // What QueryMessages(from: 100, limit: 50) answers when 97 was deleted: 50 messages below 100.
    const page = range(49, 99)
      .filter((id) => id !== 97n)
      .map((id) => msg(id));

    await store.reconcileMessages("s1", "c1", page, { before: 100n, reachedStart: false });

    // Below the page (1–10) and from `before` up (100–105) are untouched.
    expect(await cachedIds()).toEqual([...range(1, 10), ...range(49, 96), ...range(98, 105)]);
  });

  test("a short page reaches the channel's start: everything older is gone", async () => {
    await store.cacheMessages(range(1, 8).map((id) => msg(id)));

    await store.reconcileMessages("s1", "c1", [msg(5n), msg(6n)], { before: 7n, reachedStart: true });

    expect(await cachedIds()).toEqual([5n, 6n, 7n, 8n]);
  });

  test("an empty newest page empties the channel's cache, and no other channel's", async () => {
    await store.cacheMessages([msg(1n), msg(2n), msg(3n, "x", "c2")]);

    await store.reconcileMessages("s1", "c1", [], { before: null, reachedStart: true });

    expect(await cachedIds("c1")).toEqual([]);
    expect(await cachedIds("c2")).toEqual([3n]);
  });

  test("a message that arrived live while the page was on its way stays", async () => {
    await store.cacheMessages([msg(1n), msg(2n), msg(3n)]);

    await store.reconcileMessages("s1", "c1", [msg(1n), msg(2n)], {
      before: null,
      reachedStart: true,
      keep: new Set([3n]),
    });

    expect(await cachedIds()).toEqual([1n, 2n, 3n]);
  });

  test("a row sharing a rounded key with a returned message is replaced by it", async () => {
    // Beyond 2^53 two snowflakes can round to the same Number key.
    const a = 2n ** 60n + 1n;
    const b = 2n ** 60n + 2n;
    expect(Number(a)).toBe(Number(b));
    await store.cacheMessages([msg(a, "stale")]);

    await store.reconcileMessages("s1", "c1", [msg(b, "fresh")], { before: null, reachedStart: true });

    expect(await cachedIds()).toEqual([b]);
  });
});
