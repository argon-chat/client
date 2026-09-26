/**
 * Jumping to a message that is not loaded (a pin, a reply's original).
 *
 * The list used to hold only the newest messages and what scrolling up had added to them, so a pin
 * further back answered "scroll up to find it". Now the server's page around the message replaces
 * the list, which stops following the present: new messages are held and counted, scrolling down
 * pages towards the present, and sending from there goes back to it.
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
    before: vi.fn(),
    around: vi.fn(),
  };
});

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelInteraction: {
      QueryMessages: (...a: unknown[]) => h.before(...a),
      QueryMessagesAround: (...a: unknown[]) => h.around(...a),
    },
  }),
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
import { useChatMessages } from "@/composables/useChatMessages";

const msg = (messageId: bigint, sender = "u1") =>
  ({ messageId, channelId: "c1", spaceId: "s1", text: `m${messageId}`, entities: [], sender, replyId: null }) as any;

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => BigInt(from + i));
const cmp = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** A server holding these ids, answering both queries the way the real one does: newest first. */
function serve(held: bigint[]) {
  const asc = [...held].sort(cmp);
  const desc = [...asc].reverse();
  h.before.mockImplementation(async (_s: string, _c: string, from: bigint | null, limit: number) =>
    desc.filter((id) => from === null || id < from).slice(0, limit).map((id) => msg(id)));
  h.around.mockImplementation(async (_s: string, _c: string, id: bigint, older: number, newer: number) => {
    const before = desc.filter((x) => x <= id).slice(0, older + 1);
    const after = asc.filter((x) => x > id).slice(0, newer + 1);
    return {
      messages: [...after.slice(0, newer).reverse(), ...before.slice(0, older)].map((x) => msg(x)),
      hasOlder: before.length > older,
      hasNewer: after.length > newer,
      containsAnchor: older > 0 && before[0] === id,
    };
  });
}

const ids = (chat: ReturnType<typeof useChatMessages>) => chat.messages.value.map((m) => m.messageId);
const settle = () => new Promise((r) => setTimeout(r, 20));

async function openChannel() {
  const chat = useChatMessages(() => "c1", () => "s1");
  chat.subscribeToNewMessages("c1", () => {});
  await chat.loadInitialMessages(() => {});
  return chat;
}

beforeEach(async () => {
  setActivePinia(createPinia());
  await ensureDbOpen();
  await db.messages.clear();
  vi.clearAllMocks();
});

describe("jumping to a message", () => {
  test("one that is loaded asks the server nothing", async () => {
    serve(range(1, 300));
    const chat = await openChannel();

    expect(await chat.jumpToMessage(280n)).toBe(true);
    expect(h.around).not.toHaveBeenCalled();
    expect(chat.hasReachedLatest.value).toBe(true);
    chat.cleanup();
  });

  test("one far back opens the history around it, and the list stops following the present", async () => {
    serve(range(1, 300));
    const chat = await openChannel();
    expect(ids(chat)[0]).toBe(251n);

    expect(await chat.jumpToMessage(100n)).toBe(true);

    expect(ids(chat)).toEqual(range(76, 125));
    expect(chat.hasReachedLatest.value).toBe(false);
    expect(chat.hasReachedEnd.value).toBe(false);
    // Kept out of the cache, which holds one run back from the newest message.
    const cached = (await db.messages.toArray()).map((r) => r.messageId);
    expect(cached).not.toContain(100n);
    expect(cached).toContain(300n);
    chat.cleanup();
  });

  test("one that no longer exists leaves the list as it was", async () => {
    serve(range(1, 300).filter((id) => id !== 100n));
    const chat = await openChannel();
    const before = ids(chat);

    expect(await chat.jumpToMessage(100n)).toBe(false);

    expect(ids(chat)).toEqual(before);
    expect(chat.hasReachedLatest.value).toBe(true);
    chat.cleanup();
  });

  test("scrolling down pages to the present, then what arrived meanwhile joins and the list follows again", async () => {
    serve(range(1, 300));
    const chat = await openChannel();
    await chat.jumpToMessage(200n);

    // Held while away, and counted: it has nowhere to go past the gap.
    h.onNewMessageReceived.next(msg(301n));
    await settle();
    expect(ids(chat)).not.toContain(301n);
    expect(chat.newMessagesCount.value).toBe(1);

    while (!chat.hasReachedLatest.value) await chat.loadNewerMessages();

    expect(ids(chat)).toEqual(range(176, 301));
    expect(chat.newMessagesCount.value).toBe(0);

    h.onNewMessageReceived.next(msg(302n));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await settle();
    expect(ids(chat).at(-1)).toBe(302n);
    chat.cleanup();
  });

  test("sending from older history goes back to the present with the message being sent", async () => {
    serve(range(1, 300));
    const chat = await openChannel();
    await chat.jumpToMessage(50n);

    const pending = { ...msg(9_999n, "me"), text: "hello" };
    chat.addOptimisticMessage(pending, 9_999n);
    await settle();

    expect(chat.hasReachedLatest.value).toBe(true);
    expect(ids(chat).slice(0, -1)).toEqual(range(251, 300));
    expect(chat.messages.value.at(-1)).toMatchObject({ text: "hello", _optimistic: true });
    chat.cleanup();
  });

  test("the way back to the present from older history", async () => {
    serve(range(1, 300));
    const chat = await openChannel();
    await chat.jumpToMessage(50n);

    await chat.returnToPresent();

    expect(chat.hasReachedLatest.value).toBe(true);
    expect(ids(chat)).toEqual(range(251, 300));
    chat.cleanup();
  });
});
