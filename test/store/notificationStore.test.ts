/**
 * Unread state in the channel list, the space icon and the DM badge, against a real Dexie (on
 * fake-indexeddb).
 *
 * The regressions these guard, each one reported from use:
 *
 *  - your own message came back as unread after a restart;
 *  - a channel whose newest message was deleted stayed unread for good, because opening it acked
 *    the newest message on screen, which is below the channel's mark;
 *  - a space icon and its channel list disagreed, each computing unread its own way;
 *  - the DM badge counted messages in one place and conversations in another.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

await vi.hoisted(async () => {
  // Before Dexie loads: it picks up the IndexedDB implementation once, at import.
  const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
  Object.assign(globalThis, { indexedDB, IDBKeyRange, argon: { isArgonHost: false } });
});

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: any) => void>(),
  ackChannel: null as any,
  markChatRead: null as any,
  badges: null as any,
  chats: [] as any[],
  sound: null as any,
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
}));
vi.mock("@argon/glue/native", () => ({ native: null }));
vi.mock("@/lib/taskbarBadge", () => ({ renderOverlayBadge: () => null }));
vi.mock("@argon/ui/toast", () => ({ toast: () => {} }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@/store/system/sessionLifecycle", () => ({ onSessionReset: () => {} }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/media/toneStore", () => ({ useTone: () => ({ playNotificationSound: () => h.sound() }) }));
vi.mock("@/store/data/friendsStore", () => ({ useFriendsStore: () => ({ isIgnored: () => false }) }));
vi.mock("@/store/data/poolStore", () => ({
  usePoolStore: () => ({ getUsersBatch: async () => new Map(), getUser: async () => undefined }),
}));
vi.mock("@/store/realtime/busStore", () => ({
  useBus: () => ({
    onServerEvent: (key: string, cb: (e: any) => void) => {
      h.handlers.set(key, cb);
      return { unsubscribe() {} };
    },
  }),
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    userInteraction: {
      GetGlobalBadges: async () => h.badges,
      AckChannel: (...args: unknown[]) => h.ackChannel(...args),
    },
    userChatInteractions: {
      GetRecentChats: async () => h.chats,
      MarkChatRead: (...args: unknown[]) => h.markChatRead(...args),
    },
  }),
}));

import { ChannelType, EntityType, MuteLevelType } from "@argon/glue";
import { db, ensureDbOpen } from "@/store/db/dexie";
import { useNotificationStore } from "@/store/data/notificationStore";
import { useRecentChatsStore } from "@/store/chat/useRecentChatsStore";

const channel = (channelId: string, lastMessageId: bigint, spaceId = "s1") =>
  ({ channelId, spaceId, name: channelId, type: ChannelType.Text, groupId: null, lastMessageId }) as any;

const readState = (channelId: string, lastReadMessageId: bigint, mentionCount = 0, spaceId = "s1") =>
  ({ channelId, spaceId, lastReadMessageId, mentionCount });

const message = (channelId: string, messageId: bigint, sender = "peer", entities: any[] = []) =>
  ({ messageId, replyId: null, channelId, spaceId: "s1", text: "", entities, sender, reactions: [], crosspost: null }) as any;

const emit = (key: string, e: any) => h.handlers.get(key)!(e);

// Acks go out after a 1.5 s debounce, DM reads after 1 s.
const ACK_WAIT = { timeout: 3000, interval: 50 };

// A second later than every chat() row: ordering compares milliseconds.
const dm = (text: string) => ({ text, createdAt: { unixTicks: 10_000_000n } });

const chat = (peerId: string, unreadCount = 0) =>
  ({ peerId, isPinned: false, pinnedAt: null, lastMsg: "hi", lastMessageAt: { unixTicks: 1n }, unreadCount, userId: "me" }) as any;

async function start(
  channels: any[],
  readStates: any[],
  extra: { mutes?: any[]; chats?: any[]; unreadDmCount?: number } = {},
) {
  await db.channels.bulkPut(channels);
  h.badges = {
    unreadDmCount: extra.unreadDmCount ?? 0,
    spaces: [],
    notifications: { friendRequests: 0, inventory: 0, system: 0 },
    readStates,
    muteSettings: extra.mutes ?? [],
  };
  h.chats = extra.chats ?? [];
  const store = useNotificationStore();
  store.subscribeToEvents();
  await store.initFromGlobalBadges();
  await vi.waitFor(() => expect(useRecentChatsStore().loaded).toBe(true));
  return store;
}

beforeEach(async () => {
  setActivePinia(createPinia());
  h.handlers.clear();
  h.ackChannel = vi.fn(async () => {});
  h.markChatRead = vi.fn(async () => {});
  h.sound = vi.fn();
  vi.useRealTimers();
  await ensureDbOpen();
  await db.channels.clear();
  await db.members.clear();
});

describe("channel unread", () => {
  test("the space icon counts exactly the channels the list shows as unread", async () => {
    const store = await start(
      [channel("read", 5n), channel("never-read", 3n), channel("empty", 0n), channel("muted", 9n)],
      [readState("read", 5n)],
      { mutes: [{ targetId: "muted", targetType: 1, muteLevel: MuteLevelType.All, suppressEveryone: false, expiresAt: null }] },
    );

    expect(store.isChannelUnread("never-read", 3n)).toBe(true);
    expect(store.getSpaceBadge("s1")).toEqual({ spaceId: "s1", unreadChannelCount: 1, totalMentions: 0 });
  });

  test("your own message is read, even in a channel you never opened", async () => {
    const store = await start([channel("general", 3n)], [readState("general", 3n)]);

    emit("MessageSent", { spaceId: "s1", message: message("general", 7n, "me") });

    expect(store.isChannelUnread("general", 7n)).toBe(false);
    expect(store.getSpaceBadge("s1")?.unreadChannelCount).toBe(0);
    await vi.waitFor(async () => expect((await db.channels.get("general"))?.lastMessageId).toBe(7n));
  });

  test("a message from someone else lights the channel and the space", async () => {
    const store = await start([channel("general", 3n)], [readState("general", 3n)]);

    emit("MessageSent", { spaceId: "s1", message: message("general", 8n) });

    expect(store.getSpaceBadge("s1")?.unreadChannelCount).toBe(1);
  });

  test("opening a channel whose newest message was deleted acks the mark, not the last message on screen", async () => {
    const store = await start([channel("general", 12n)], [readState("general", 5n)]);

    // Newest on screen is 10; 11 and 12 were deleted before this client heard of a retraction.
    store.readOnScreen("general", 10n, "s1", true);

    expect(store.isChannelUnread("general", 12n)).toBe(false);
    expect(store.getSpaceBadge("s1")?.unreadChannelCount).toBe(0);
    await vi.waitFor(() => expect(h.ackChannel).toHaveBeenCalledWith("general", 12n), ACK_WAIT);
  });

  test("a message that arrives in the channel on screen is read on arrival", async () => {
    const store = await start([channel("general", 5n)], [readState("general", 5n)]);
    store.readOnScreen("general", 5n, "s1", true);

    emit("MessageSent", { spaceId: "s1", message: message("general", 6n) });

    expect(store.getSpaceBadge("s1")?.unreadChannelCount).toBe(0);
    await vi.waitFor(() => expect(h.ackChannel).toHaveBeenCalledWith("general", 6n), ACK_WAIT);
  });

  test("the same bottom reported on every render pass is acked once", async () => {
    const store = await start([channel("general", 9n)], [readState("general", 5n)]);

    for (let i = 0; i < 5; i++) store.readOnScreen("general", 9n, "s1", true);
    await vi.waitFor(() => expect(h.ackChannel).toHaveBeenCalled(), ACK_WAIT);
    for (let i = 0; i < 5; i++) store.readOnScreen("general", 9n, "s1", true);
    await new Promise((r) => setTimeout(r, 1700));

    expect(h.ackChannel).toHaveBeenCalledTimes(1);
  });
});

describe("a deleted newest message", () => {
  test("takes the channel back to read", async () => {
    const store = await start([channel("general", 5n)], [readState("general", 5n)]);
    emit("MessageSent", { spaceId: "s1", message: message("general", 6n) });
    expect(store.getSpaceBadge("s1")?.unreadChannelCount).toBe(1);

    emit("ChannelMarkRetracted", { spaceId: "s1", channelId: "general", messageId: 6n, lastMessageId: 5n });

    expect(store.getSpaceBadge("s1")?.unreadChannelCount).toBe(0);
    await vi.waitFor(async () => expect((await db.channels.get("general"))?.lastMessageId).toBe(5n));
  });

  test("does not undo a newer message that overtook the event", async () => {
    const store = await start([channel("general", 5n)], [readState("general", 5n)]);
    emit("MessageSent", { spaceId: "s1", message: message("general", 7n) });

    emit("ChannelMarkRetracted", { spaceId: "s1", channelId: "general", messageId: 6n, lastMessageId: 5n });

    expect(store.getSpaceBadge("s1")?.unreadChannelCount).toBe(1);
    await vi.waitFor(async () => expect((await db.channels.get("general"))?.lastMessageId).toBe(7n));
  });

  test("leaves no mention behind to resurface with the next message", async () => {
    const store = await start([channel("general", 5n)], [readState("general", 5n)]);
    emit("MessageSent", {
      spaceId: "s1",
      message: message("general", 6n, "peer", [{ type: EntityType.Mention, userId: "me" }]),
    });
    await vi.waitFor(() => expect(store.getSpaceBadge("s1")?.totalMentions).toBe(1));

    emit("ChannelMarkRetracted", { spaceId: "s1", channelId: "general", messageId: 6n, lastMessageId: 5n });
    emit("MessageSent", { spaceId: "s1", message: message("general", 8n) });

    expect(store.getSpaceBadge("s1")).toEqual({ spaceId: "s1", unreadChannelCount: 1, totalMentions: 0 });
  });
});

describe("mentions", () => {
  test("a ping by name, by @everyone or by a role you hold counts once each", async () => {
    const store = await start([channel("general", 1n)], [readState("general", 1n)]);
    await db.members.put({ memberId: "m1", spaceId: "s1", userId: "me", archetypes: [{ archetypeId: "mods" }] } as any);

    emit("MessageSent", { spaceId: "s1", message: message("general", 2n, "peer", [{ type: EntityType.Mention, userId: "me" }]) });
    emit("MessageSent", { spaceId: "s1", message: message("general", 3n, "peer", [{ type: EntityType.MentionEveryone }]) });
    emit("MessageSent", { spaceId: "s1", message: message("general", 4n, "peer", [{ type: EntityType.MentionRole, archetypeId: "mods" }]) });
    emit("MessageSent", { spaceId: "s1", message: message("general", 5n, "peer", [{ type: EntityType.MentionRole, archetypeId: "other" }]) });

    await vi.waitFor(() => expect(store.channelMentionCount("general", 5n)).toBe(3));
    expect(h.sound).toHaveBeenCalledTimes(3);
  });

  test("a muted channel counts nothing", async () => {
    const store = await start([channel("general", 1n)], [readState("general", 1n)], {
      mutes: [{ targetId: "s1", targetType: 0, muteLevel: MuteLevelType.All, suppressEveryone: false, expiresAt: null }],
    });

    emit("MessageSent", { spaceId: "s1", message: message("general", 2n, "peer", [{ type: EntityType.Mention, userId: "me" }]) });
    await new Promise((r) => setTimeout(r, 30));

    expect(store.getSpaceBadge("s1")?.totalMentions).toBe(0);
    expect(h.sound).not.toHaveBeenCalled();
  });
});

describe("direct messages", () => {
  test("the badge counts conversations, and a first message from someone new is one of them", async () => {
    const store = await start([], [], { chats: [chat("a", 3), chat("b", 0)], unreadDmCount: 1 });

    emit("DirectMessageSent", { senderId: "a", receiverId: "me", message: dm("again") });
    emit("DirectMessageSent", { senderId: "c", receiverId: "me", message: dm("hello") });

    await vi.waitFor(() => expect(store.unreadDmCount).toBe(2));
    const recent = useRecentChatsStore().recent;
    expect(recent[0]).toMatchObject({ peerId: "c", lastMsg: "hello", unreadCount: 1 });
  });

  test("your own message moves the conversation up without counting", async () => {
    const store = await start([], [], { chats: [chat("a", 0), chat("b", 0)] });

    emit("DirectMessageSent", { senderId: "me", receiverId: "b", message: dm("mine") });

    await vi.waitFor(() => expect(useRecentChatsStore().recent[0]).toMatchObject({ peerId: "b", lastMsg: "mine" }));
    expect(store.unreadDmCount).toBe(0);
  });

  test("a message in the chat on screen is not counted, and the server is told it was read", async () => {
    const store = await start([], [], { chats: [chat("a", 0)] });
    useRecentChatsStore().setViewing("a");

    emit("DirectMessageSent", { senderId: "a", receiverId: "me", message: dm("hi") });

    expect(store.unreadDmCount).toBe(0);
    await vi.waitFor(() => expect(h.markChatRead).toHaveBeenCalledWith("a"), ACK_WAIT);
  });

  test("reading a chat clears the badge and the server's count", async () => {
    const store = await start([], [], { chats: [chat("a", 4)] });

    useRecentChatsStore().readChat("a");
    useRecentChatsStore().readChat("a");

    expect(store.unreadDmCount).toBe(0);
    await vi.waitFor(() => expect(h.markChatRead).toHaveBeenCalled(), ACK_WAIT);
    expect(h.markChatRead).toHaveBeenCalledTimes(1);
  });
});
