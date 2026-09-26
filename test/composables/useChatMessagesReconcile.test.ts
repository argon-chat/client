/**
 * A channel's history served from the local cache first, then made to agree with the server.
 *
 * MessageDeleted and MessageUpdated reach only the channel's current viewers. A member who was
 * elsewhere kept the deleted message (or the old text) in the cache, and the channel served it back
 * on every open — older pages entirely from the cache when it had enough of them. Now every page the
 * server returns reconciles the cache and the list, and an older page shown from the cache is checked
 * with the server behind the user's back (stale-while-revalidate).
 *
 * The cache is the real message store on a real Dexie (fake-indexeddb); only the server is faked.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const h = await vi.hoisted(async () => {
  const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
  const { vi } = await import("vitest");
  const { Subject } = await import("rxjs");
  return {
    onNewMessageReceived: new Subject<any>(),
    onMessageUpdated: new Subject<any>(),
    onMessageDeleted: new Subject<any>(),
    onMessagePublished: new Subject<any>(),
    query: vi.fn(),
  };
});

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ channelInteraction: { QueryMessages: (...a: unknown[]) => h.query(...a) } }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/media/toneStore", () => ({ useTone: () => ({ playNotificationSound() {} }) }));
vi.mock("@/store/data/notificationStore", () => ({ useNotificationStore: () => ({ effectiveMuteLevel: () => 0 }) }));
vi.mock("@/store/data/poolStore", async () => {
  const { useMessageStore } = await import("@/store/data/messageStore");
  return {
    usePoolStore: () => {
      const store = useMessageStore();
      return {
        onNewMessageReceived: h.onNewMessageReceived,
        onMessageUpdated: h.onMessageUpdated,
        onMessageDeleted: h.onMessageDeleted,
        onMessagePublished: h.onMessagePublished,
        loadCachedMessages: store.loadCachedMessages,
        loadOlderCachedMessages: store.loadOlderCachedMessages,
        reconcileMessages: store.reconcileMessages,
        cacheMessages: store.cacheMessages,
        cacheMessage: store.cacheMessage,
        removeCachedMessage: store.removeCachedMessage,
        getMessageById: store.getMessageById,
      };
    },
  };
});

import { db, ensureDbOpen } from "@/store/db/dexie";
import { useMessageStore } from "@/store/data/messageStore";
import { useChatMessages } from "@/composables/useChatMessages";

const msg = (messageId: bigint, text = `m${messageId}`, channelId = "c1") =>
  ({ messageId, channelId, spaceId: "s1", text, entities: [], sender: "u1", replyId: null }) as any;

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => BigInt(from + i));
const msgs = (ids: bigint[]) => ids.map((id) => msg(id));

/** What the server answers QueryMessages(from, 50) with, newest first, from the ids it holds. */
function serverHolding(ids: bigint[], edited: Record<string, string> = {}) {
  const sorted = [...ids].sort((a, b) => (a < b ? 1 : -1));
  return async (_s: string, _c: string, from: bigint | null, limit: number) =>
    sorted
      .filter((id) => from === null || id < from)
      .slice(0, limit)
      .map((id) => msg(id, edited[String(id)] ?? `m${id}`));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function cachedIds(): Promise<bigint[]> {
  const rows = await db.messages.toArray();
  return rows.map((r) => r.messageId).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const ids = (chat: ReturnType<typeof useChatMessages>) => chat.messages.value.map((m) => m.messageId);
const noop = { beforePrepend() {}, afterPrepend() {} };
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(async () => {
  setActivePinia(createPinia());
  await ensureDbOpen();
  await db.messages.clear();
  h.query.mockReset();
});

describe("opening a channel", () => {
  test("a message deleted while the user was away leaves the list and the cache, and does not come back", async () => {
    await useMessageStore().cacheMessages(msgs([1n, 2n, 3n, 4n]));
    h.query.mockImplementation(serverHolding([1n, 2n, 4n]));

    const chat = useChatMessages(() => "c1", () => "s1");
    await chat.loadInitialMessages(() => {});

    expect(ids(chat)).toEqual([1n, 2n, 4n]);
    expect(await cachedIds()).toEqual([1n, 2n, 4n]);
    expect(h.query).toHaveBeenCalledWith("s1", "c1", null, 50);

    // The next open shows the cache first: the deleted message is not there to flash.
    let firstPaint: bigint[] = [];
    h.query.mockImplementation(async () => {
      firstPaint = ids(reopened);
      return msgs([4n, 2n, 1n]);
    });
    const reopened = useChatMessages(() => "c1", () => "s1");
    await reopened.loadInitialMessages(() => {});
    expect(firstPaint).toEqual([1n, 2n, 4n]);
  });

  test("an edited message shows the server's text and is redrawn", async () => {
    await useMessageStore().cacheMessages([msg(1n), msg(2n, "typo")]);
    h.query.mockImplementation(serverHolding([1n, 2n], { "2": "fixed" }));

    const chat = useChatMessages(() => "c1", () => "s1");
    await chat.loadInitialMessages(() => {});

    const [first, second] = chat.messages.value;
    expect(second.text).toBe("fixed");
    // The list memoises rows on _rev: the changed row gets a new one, the unchanged keeps its own.
    expect(second._rev).toBe(1);
    expect(first._rev).toBeUndefined();
    expect((await useMessageStore().getMessageById(2n))?.text).toBe("fixed");
  });

  test("an empty channel on the server empties what the cache showed", async () => {
    await useMessageStore().cacheMessages(msgs([1n, 2n]));
    h.query.mockResolvedValue([]);

    const chat = useChatMessages(() => "c1", () => "s1");
    await chat.loadInitialMessages(() => {});

    expect(ids(chat)).toEqual([]);
    expect(chat.hasReachedEnd.value).toBe(true);
    expect(await cachedIds()).toEqual([]);
  });

  test("a message that arrives while the page is on its way is neither dropped nor uncached", async () => {
    await useMessageStore().cacheMessages(msgs([1n, 2n]));
    const answer = deferred<any[]>();
    h.query.mockReturnValue(answer.promise);

    const chat = useChatMessages(() => "c1", () => "s1");
    chat.subscribeToNewMessages("c1", () => {});
    const loading = chat.loadInitialMessages(() => {});
    await settle();

    h.onNewMessageReceived.next(msg(3n));
    await settle();
    answer.resolve(msgs([2n, 1n]));
    await loading;

    expect(ids(chat)).toEqual([1n, 2n, 3n]);
    expect(await cachedIds()).toEqual([1n, 2n, 3n]);
    chat.cleanup();
  });

  test("a message deleted while the page is on its way does not come back with it", async () => {
    await useMessageStore().cacheMessages(msgs([1n, 2n]));
    const answer = deferred<any[]>();
    h.query.mockReturnValue(answer.promise);

    const chat = useChatMessages(() => "c1", () => "s1");
    chat.subscribeToNewMessages("c1", () => {});
    const loading = chat.loadInitialMessages(() => {});
    await settle();

    h.onMessageDeleted.next({ spaceId: "s1", channelId: "c1", messageId: 2n, byUserId: "mod" });
    await settle();
    // Read before the delete landed.
    answer.resolve(msgs([2n, 1n]));
    await loading;

    expect(ids(chat)).toEqual([1n]);
    expect(await cachedIds()).toEqual([1n]);
    chat.cleanup();
  });

  test("a page for a channel the user already left changes nothing", async () => {
    const answer = deferred<any[]>();
    h.query.mockReturnValueOnce(answer.promise);
    let channel = "c1";

    const chat = useChatMessages(() => channel, () => "s1");
    const first = chat.loadInitialMessages(() => {});
    await settle();

    channel = "c2";
    h.query.mockImplementation(async () => [msg(9n, "general", "c2")]);
    await chat.loadInitialMessages(() => {});
    answer.resolve(msgs([1n]));
    await first;

    expect(ids(chat)).toEqual([9n]);
  });
});

describe("scrolling back", () => {
  test("an older page is shown from the cache at once, then replaced by the server's", async () => {
    await useMessageStore().cacheMessages(msgs(range(1, 120)));
    // Deleted while away: 40 (inside the cached page) and 110 (in the newest page).
    const held = range(1, 120).filter((id) => id !== 40n && id !== 110n);
    const server = serverHolding(held, { "45": "edited" });
    h.query.mockImplementation(server);

    const chat = useChatMessages(() => "c1", () => "s1");
    await chat.loadInitialMessages(() => {});
    expect(ids(chat)[0]).toBe(70n);
    expect(ids(chat)).not.toContain(110n);

    const answer = deferred<any[]>();
    h.query.mockImplementationOnce(async (...a: any[]) => {
      await answer.promise;
      return server(...(a as [string, string, bigint | null, number]));
    });
    await chat.loadOlderMessages(noop);

    // From the cache, before the server has answered: 20..69 as cached, 40 among them.
    expect(ids(chat)[0]).toBe(20n);
    expect(ids(chat)).toContain(40n);
    expect(chat.messages.value.find((m) => m.messageId === 45n)?.text).toBe("m45");

    answer.resolve([]);
    // The check runs in the background; wait for its page to land rather than for a fixed time.
    await vi.waitFor(async () => {
      expect(ids(chat)).toEqual(held.filter((id) => id >= 19n));
      expect(await cachedIds()).not.toContain(40n);
    });

    const edited = chat.messages.value.find((m) => m.messageId === 45n)!;
    expect(edited.text).toBe("edited");
    expect(edited._rev).toBe(1);
    expect(await cachedIds()).not.toContain(40n);
    expect(h.query).toHaveBeenLastCalledWith("s1", "c1", 70n, 50);
  });

  test("the next older page waits for the check, and continues from where the server's page ends", async () => {
    // The cache has a hole (51–70 were never cached): its "previous 50" skips over it.
    await useMessageStore().cacheMessages(msgs([...range(1, 50), ...range(71, 120)]));
    h.query.mockImplementation(serverHolding(range(1, 120)));

    const chat = useChatMessages(() => "c1", () => "s1");
    await chat.loadInitialMessages(() => {});
    await chat.loadOlderMessages(noop);
    await chat.loadOlderMessages(noop);

    // The server's page (21–70) replaced the cached one (1–50); the next load went on from 21.
    await vi.waitFor(() => expect(ids(chat)).toEqual(range(1, 120)));
    expect(h.query.mock.calls.map((c) => c[2])).toEqual([null, 71n, 21n]);
  });

  test("with fewer cached messages than a page, the server's page is reconciled into the cache", async () => {
    await useMessageStore().cacheMessages(msgs([...range(51, 100), 20n, 30n]));
    const held = range(1, 100).filter((id) => id !== 30n);
    h.query.mockImplementation(serverHolding(held));

    const chat = useChatMessages(() => "c1", () => "s1");
    await chat.loadInitialMessages(() => {});
    await chat.loadOlderMessages(noop);

    expect(ids(chat)).toEqual(held);
    expect(chat.hasReachedEnd.value).toBe(true);
    expect(await cachedIds()).not.toContain(30n);
  });
});
