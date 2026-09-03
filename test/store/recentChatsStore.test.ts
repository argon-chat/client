/**
 * Unread counts around the recent-chat snapshot.
 *
 * The regressions these guard, both of them races the UI cannot show you:
 *
 *  - `setChats()` decorates the server's snapshot asynchronously (it resolves display names first).
 *    A message arriving inside that window is not in the snapshot's counts, and the old code threw
 *    the buffered bump away along with the whole buffer — the badge never appeared.
 *  - `upsert()` awaits too, and it used to trust the count captured in its payload. A bump that
 *    landed during that await was overwritten by the stale capture on commit.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const getUsersBatch = vi.fn(async () => new Map());
const getUser = vi.fn(async () => undefined);

vi.mock("@/store/data/poolStore", () => ({
  usePoolStore: () => ({ getUsersBatch, getUser }),
}));
vi.mock("@/store/system/sessionLifecycle", () => ({
  onSessionReset: () => {},
}));
vi.mock("@argon/core", () => ({
  logger: { debug() {}, info() {}, warn() {}, error() {} },
}));

import { useRecentChatsStore } from "@/store/chat/useRecentChatsStore";

/** Only the fields the store reads; `lastMessageAt` is an IonDateTime, of which it wants the ticks. */
const chat = (peerId: string, unreadCount = 0, ticks = 1n) =>
  ({
    peerId,
    isPinned: false,
    pinnedAt: null,
    lastMsg: "hi",
    lastMessageAt: { unixTicks: ticks },
    unreadCount,
  }) as never;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("useRecentChatsStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getUsersBatch.mockImplementation(async () => new Map());
    getUser.mockImplementation(async () => undefined);
  });

  test("keeps a message that arrives while the snapshot is being applied", async () => {
    const store = useRecentChatsStore();
    const gate = deferred<Map<string, unknown>>();
    getUsersBatch.mockImplementation(() => gate.promise as never);

    // The server answered with a read conversation...
    const loading = store.setChats([chat("peer-a", 0)]);

    // ...and a message landed before the snapshot reached `recent`.
    store.bumpUnread("peer-a");

    gate.resolve(new Map<string, unknown>());
    await loading;

    expect(store.recent).toHaveLength(1);
    expect(store.recent[0].unreadCount).toBe(1);
  });

  test("keeps a conversation the snapshot has never heard of", async () => {
    const store = useRecentChatsStore();
    await store.setChats([chat("peer-a", 0)]);

    const gate = deferred<Map<string, unknown>>();
    getUsersBatch.mockImplementation(() => gate.promise as never);

    const loading = store.setChats([chat("peer-a", 0)]);
    await store.upsert(chat("peer-new", 0, 2n));
    store.bumpUnread("peer-new");

    gate.resolve(new Map<string, unknown>());
    await loading;

    const created = store.recent.find((x) => x.peerId === "peer-new");
    expect(created).toBeDefined();
    expect(created!.unreadCount).toBe(1);
  });

  test("the server's own counts win over anything buffered before the load", async () => {
    const store = useRecentChatsStore();

    // Nothing to attach to yet, so this is buffered — and it predates the snapshot.
    store.bumpUnread("peer-a");
    await store.setChats([chat("peer-a", 3)]);

    expect(store.recent[0].unreadCount).toBe(3);
  });

  test("an upsert does not roll back a bump that raced it", async () => {
    const store = useRecentChatsStore();
    await store.setChats([chat("peer-a", 0)]);

    const gate = deferred<undefined>();
    getUser.mockImplementation(() => gate.promise as never);

    // The event that triggered this carried no count of its own, as RecentChatUpdatedEvent does not.
    const writing = store.upsert(chat("peer-a", 0, 5n));
    store.bumpUnread("peer-a");

    gate.resolve(undefined);
    await writing;

    expect(store.recent[0].unreadCount).toBe(1);
  });

  test("opening a chat clears both the row and anything buffered for it", async () => {
    const store = useRecentChatsStore();
    await store.setChats([chat("peer-a", 4)]);

    store.markRead("peer-a");
    expect(store.recent[0].unreadCount).toBe(0);

    // A buffered count for the same peer must not resurface on the next upsert.
    store.bumpUnread("peer-b");
    store.markRead("peer-b");
    await store.upsert(chat("peer-b", 0, 3n));

    expect(store.recent.find((x) => x.peerId === "peer-b")!.unreadCount).toBe(0);
  });
});
