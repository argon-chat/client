/**
 * A message taken down on the server — by its author or a moderator — leaves the open channel and
 * the local cache at once, instead of lingering until the next reload. An announcement published to
 * the followers gets its "Published" stamp the same way.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const h = await vi.hoisted(async () => {
  const { vi } = await import("vitest");
  const { Subject } = await import("rxjs");
  return {
    onNewMessageReceived: new Subject<any>(),
    onMessageUpdated: new Subject<any>(),
    onMessageDeleted: new Subject<any>(),
    onMessagePublished: new Subject<any>(),
    removeCachedMessage: vi.fn(async () => {}),
    cacheMessage: vi.fn(async () => {}),
    getMessageById: vi.fn(async (_id: bigint): Promise<any> => undefined),
  };
});

vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({}) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/media/toneStore", () => ({ useTone: () => ({ playNotificationSound() {} }) }));
vi.mock("@/store/data/notificationStore", () => ({ useNotificationStore: () => ({}) }));
vi.mock("@/store/data/poolStore", () => ({
  usePoolStore: () => ({
    onNewMessageReceived: h.onNewMessageReceived,
    onMessageUpdated: h.onMessageUpdated,
    onMessageDeleted: h.onMessageDeleted,
    onMessagePublished: h.onMessagePublished,
    removeCachedMessage: h.removeCachedMessage,
    cacheMessage: h.cacheMessage,
    getMessageById: h.getMessageById,
  }),
}));

import { IonDateTime } from "@argon-chat/ion.webcore";
import { useChatMessages } from "@/composables/useChatMessages";

const message = (messageId: bigint, channelId = "c1") =>
  ({ messageId, channelId, spaceId: "s1", text: `m${messageId}`, entities: [], sender: "u1" }) as any;

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  h.removeCachedMessage.mockClear();
  h.cacheMessage.mockClear();
  h.getMessageById.mockReset();
  h.getMessageById.mockImplementation(async () => undefined);
});

describe("a deleted message", () => {
  test("leaves the open channel and the cache", async () => {
    const chat = useChatMessages(() => "c1", () => "s1");
    chat.messages.value = [message(1n), message(2n)];
    chat.subscribeToNewMessages("c1", () => {});

    h.onMessageDeleted.next({ spaceId: "s1", channelId: "c1", messageId: 1n, byUserId: "mod" });
    await settle();

    expect(chat.messages.value.map((m) => m.messageId)).toEqual([2n]);
    expect(h.removeCachedMessage).toHaveBeenCalledWith(1n);
    chat.cleanup();
  });

  test("in another channel changes nothing here", async () => {
    const chat = useChatMessages(() => "c1", () => "s1");
    chat.messages.value = [message(1n)];
    chat.subscribeToNewMessages("c1", () => {});

    h.onMessageDeleted.next({ spaceId: "s1", channelId: "c2", messageId: 1n, byUserId: "mod" });
    await settle();

    expect(chat.messages.value).toHaveLength(1);
    expect(h.removeCachedMessage).not.toHaveBeenCalled();
    chat.cleanup();
  });

  test("stops arriving once the channel is left", async () => {
    const chat = useChatMessages(() => "c1", () => "s1");
    chat.messages.value = [message(1n)];
    chat.subscribeToNewMessages("c1", () => {});
    chat.cleanup();

    h.onMessageDeleted.next({ spaceId: "s1", channelId: "c1", messageId: 1n, byUserId: "mod" });
    await settle();

    expect(chat.messages.value).toHaveLength(1);
  });
});

describe("a published announcement", () => {
  const at = () => IonDateTime.fromDate(new Date("2026-09-26T10:00:00Z"));

  test("is stamped in the open channel, re-rendered and re-cached", async () => {
    const chat = useChatMessages(() => "c1", () => "s1");
    chat.messages.value = [message(1n), { ...message(2n), _rev: 3 }];
    chat.subscribeToNewMessages("c1", () => {});

    const publishedAt = at();
    h.onMessagePublished.next({ spaceId: "s1", channelId: "c1", messageId: 2n, publishedAt });
    await settle();

    const row = chat.messages.value[1];
    expect(row.publishedAt).toBe(publishedAt);
    // The list memoises rows on _rev: bumping it is what redraws the row.
    expect(row._rev).toBe(4);
    expect(chat.messages.value[0].publishedAt).toBeUndefined();
    expect(h.cacheMessage).toHaveBeenCalledTimes(1);
    const cached = (h.cacheMessage.mock.calls[0] as any[])[0];
    expect(cached.messageId).toBe(2n);
    expect(cached.publishedAt).toBe(publishedAt);
    expect(cached._rev).toBeUndefined();
    chat.cleanup();
  });

  test("a second stamp for the same message changes nothing", async () => {
    const chat = useChatMessages(() => "c1", () => "s1");
    chat.messages.value = [message(1n)];
    chat.subscribeToNewMessages("c1", () => {});

    const first = at();
    await chat.markPublished(1n, first);
    h.cacheMessage.mockClear();
    h.onMessagePublished.next({ spaceId: "s1", channelId: "c1", messageId: 1n, publishedAt: at() });
    await settle();

    expect(chat.messages.value[0].publishedAt).toBe(first);
    expect(chat.messages.value[0]._rev).toBe(1);
    expect(h.cacheMessage).not.toHaveBeenCalled();
    chat.cleanup();
  });

  test("in another channel changes nothing here", async () => {
    const chat = useChatMessages(() => "c1", () => "s1");
    chat.messages.value = [message(1n)];
    chat.subscribeToNewMessages("c1", () => {});

    h.onMessagePublished.next({ spaceId: "s1", channelId: "c2", messageId: 1n, publishedAt: at() });
    await settle();

    expect(chat.messages.value[0].publishedAt).toBeUndefined();
    expect(h.cacheMessage).not.toHaveBeenCalled();
    chat.cleanup();
  });

  test("not in view, the cached copy is stamped", async () => {
    const chat = useChatMessages(() => "c1", () => "s1");
    chat.messages.value = [message(1n)];
    chat.subscribeToNewMessages("c1", () => {});
    h.getMessageById.mockImplementation(async () => ({ ...message(9n), publishedAt: null }));

    const publishedAt = at();
    h.onMessagePublished.next({ spaceId: "s1", channelId: "c1", messageId: 9n, publishedAt });
    await settle();

    expect(h.getMessageById).toHaveBeenCalledWith(9n);
    expect(h.cacheMessage).toHaveBeenCalledWith(expect.objectContaining({ messageId: 9n, publishedAt }));
    expect(chat.messages.value).toHaveLength(1);
    chat.cleanup();
  });

  test("a cached message of another channel under that id is left alone", async () => {
    const chat = useChatMessages(() => "c1", () => "s1");
    chat.subscribeToNewMessages("c1", () => {});
    h.getMessageById.mockImplementation(async () => ({ ...message(9n, "c2"), publishedAt: null }));

    h.onMessagePublished.next({ spaceId: "s1", channelId: "c1", messageId: 9n, publishedAt: at() });
    await settle();

    expect(h.cacheMessage).not.toHaveBeenCalled();
    chat.cleanup();
  });

  test("stops arriving once the channel is left", async () => {
    const chat = useChatMessages(() => "c1", () => "s1");
    chat.messages.value = [message(1n)];
    chat.subscribeToNewMessages("c1", () => {});
    chat.cleanup();

    h.onMessagePublished.next({ spaceId: "s1", channelId: "c1", messageId: 1n, publishedAt: at() });
    await settle();

    expect(chat.messages.value[0].publishedAt).toBeUndefined();
  });
});
