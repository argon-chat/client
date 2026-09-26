/**
 * The latest-announcement banner at the top of a space's channel list.
 *
 * It shows the newest post of the space's main announcement channel while that post is unread for
 * the member, and "unread" is the notification store's own rule: a member who just joined has no
 * read state for the channel, which counts as unread. Dismiss acks through the ordinary ack path,
 * so once the read state catches up the banner is gone — here and on every other device.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const h = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  const { vi } = await import("vitest");
  const { Subject } = await import("rxjs");
  return {
    servers: reactive(new Map<string, any>()),
    channels: reactive(new Map<string, any>()),
    users: reactive(new Map<string, any>()),
    readStates: reactive(new Map<string, bigint>()),
    mutes: reactive(new Map<string, number>()),
    queryMessages: vi.fn(),
    cached: vi.fn(async (_id: bigint): Promise<any> => undefined),
    live: new Subject<any>(),
    scheduleAck: vi.fn(),
    flushAcks: vi.fn(),
    setLastChannel: vi.fn(),
    selectedTextChannel: { value: null as string | null },
  };
});

vi.mock("@/store/db/dexie", () => ({
  db: {
    servers: { get: (id: string) => Promise.resolve(h.servers.get(id)) },
    channels: { get: (id: string) => Promise.resolve(h.channels.get(id)) },
  },
}));
vi.mock("@/composables/useLiveQuery", async () => {
  const { ref, watchEffect } = await import("vue");
  return {
    useLiveQuery: (fn: () => unknown) => {
      const result = ref<unknown>();
      watchEffect(() => {
        void Promise.resolve(fn()).then((v) => (result.value = v));
      });
      return result;
    },
  };
});
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelInteraction: { QueryMessages: h.queryMessages },
    serverInteraction: { PrefetchUser: async () => { throw new Error("offline"); } },
  }),
}));
vi.mock("@/store/data/notificationStore", () => ({
  useNotificationStore: () => ({
    isChannelUnread: (channelId: string, last: bigint) =>
      h.readStates.has(channelId) ? last > h.readStates.get(channelId)! : last > 0n,
    effectiveMuteLevel: (channelId: string, spaceId: string) => h.mutes.get(channelId) ?? h.mutes.get(spaceId) ?? 0,
    scheduleAck: (channelId: string, messageId: bigint, spaceId: string) => {
      h.scheduleAck(channelId, messageId, spaceId);
      h.readStates.set(channelId, messageId);
    },
    flushAcksImmediate: h.flushAcks,
  }),
}));
vi.mock("@/store/data/poolStore", async () => {
  const { computed } = await import("vue");
  return {
    usePoolStore: () => ({
      getMessageById: (id: bigint) => h.cached(id),
      onNewMessageReceived: h.live,
      getUser: async (id: string) => h.users.get(id),
      getUserReactive: (id: { value: string | undefined }) => computed(() => (id.value ? h.users.get(id.value) ?? null : null)),
      trackUser: async () => {},
      set selectedTextChannel(v: string) { h.selectedTextChannel.value = v; },
    }),
  };
});
vi.mock("@/lib/recentSpaces", () => ({ setLastChannel: h.setLastChannel }));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} }, cn: (...c: unknown[]) => c.filter(Boolean).join(" ") }));
vi.mock("@/components/ArgonAvatar.vue", () => ({ default: { name: "ArgonAvatar", setup: () => () => null } }));

import { ChannelType, EntityType } from "@argon/glue";
import AnnouncementBanner from "@/components/space/AnnouncementBanner.vue";
import { SPOILER_MASK } from "@/lib/chat/spoilers";

const post = (messageId: bigint, text = "Season two starts on Friday\nBring friends\nand snacks") => ({
  messageId,
  channelId: "news",
  spaceId: "s1",
  sender: "author",
  text,
  timeSent: { toDate: () => new Date(2026, 8, 26, 9, 5) },
});

function space(mainAnnouncementChannelId: string | null) {
  h.servers.set("s1", { spaceId: "s1", name: "Space", mainAnnouncementChannelId });
}

function channel(lastMessageId: bigint, type = ChannelType.Announcement) {
  h.channels.set("news", { channelId: "news", spaceId: "s1", name: "news", type, lastMessageId });
}

async function render(openChannelId: string | null = "general") {
  const w = mount(AnnouncementBanner, { props: { spaceId: "s1", openChannelId } });
  await flushPromises();
  await flushPromises();
  return w;
}

const banner = (w: ReturnType<typeof mount>) => w.find('[data-testid="announcement-banner"]');

beforeEach(() => {
  h.servers.clear();
  h.channels.clear();
  h.users.clear();
  h.readStates.clear();
  h.mutes.clear();
  h.queryMessages.mockReset();
  h.queryMessages.mockImplementation(async () => [post(10n)]);
  h.cached.mockReset();
  h.cached.mockImplementation(async () => undefined);
  h.scheduleAck.mockReset();
  h.setLastChannel.mockReset();
  h.selectedTextChannel.value = null;
  h.users.set("author", { userId: "author", displayName: "Captain" });
});

describe("the banner", () => {
  test("shows the channel, the author, the time and the first two lines of an unread post", async () => {
    space("news");
    channel(10n);
    h.readStates.set("news", 5n);

    const w = await render();

    expect(banner(w).exists()).toBe(true);
    expect(banner(w).text()).toContain("news");
    expect(w.find('[data-testid="announcement-author"]').text()).toBe("Captain");
    expect(w.find('[data-testid="announcement-text"]').text()).toBe("Season two starts on Friday\nBring friends");
    expect(w.find("time").exists()).toBe(true);
    expect(h.queryMessages).toHaveBeenCalledWith("s1", "news", null, 1);
  });

  test("is not there when the space has no main announcement channel", async () => {
    space(null);
    channel(10n);

    const w = await render();

    expect(banner(w).exists()).toBe(false);
    expect(h.queryMessages).not.toHaveBeenCalled();
  });

  test("is not there once the post is read", async () => {
    space("news");
    channel(10n);
    h.readStates.set("news", 10n);

    const w = await render();

    expect(banner(w).exists()).toBe(false);
  });

  test("shows for a member who just joined and has no read state for the channel", async () => {
    space("news");
    channel(10n);

    const w = await render();

    expect(banner(w).exists()).toBe(true);
  });

  test("stays hidden while the announcement channel itself is open, and for a muted channel", async () => {
    space("news");
    channel(10n);

    expect(banner(await render("news")).exists()).toBe(false);

    h.mutes.set("news", 2);
    expect(banner(await render()).exists()).toBe(false);
  });

  test("Dismiss acks the channel up to the post and the banner goes", async () => {
    space("news");
    channel(10n);
    const w = await render();

    await w.find('[data-action="dismiss"]').trigger("click");
    await flushPromises();

    expect(h.scheduleAck).toHaveBeenCalledWith("news", 10n, "s1");
    expect(h.flushAcks).toHaveBeenCalled();
    expect(banner(w).exists()).toBe(false);
  });

  test("Dismiss acks to the channel's mark when the newest post was deleted", async () => {
    space("news");
    channel(12n);
    const w = await render();

    await w.find('[data-action="dismiss"]').trigger("click");

    expect(h.scheduleAck).toHaveBeenCalledWith("news", 12n, "s1");
  });

  test("Open asks to navigate to the channel and remembers it", async () => {
    space("news");
    channel(10n);
    const w = await render();

    await w.find('[data-action="open"]').trigger("click");

    expect(w.emitted("open")?.[0]).toEqual(["news"]);
    expect(h.setLastChannel).toHaveBeenCalledWith("s1", "news");
    expect(h.selectedTextChannel.value).toBe("news");
    expect(h.scheduleAck).not.toHaveBeenCalled();
  });

  test("follows a new post from its MessageSent, without asking the server", async () => {
    space("news");
    channel(10n);
    const w = await render();
    expect(h.queryMessages).toHaveBeenCalledTimes(1);

    // What MessageSent does: the post arrives on the stream, then the channel's mark moves.
    h.live.next(post(11n, "Hotfix is live"));
    channel(11n);
    await flushPromises();
    await flushPromises();

    expect(w.find('[data-testid="announcement-text"]').text()).toBe("Hotfix is live");
    expect(h.queryMessages).toHaveBeenCalledTimes(1);
  });

  test("a post seen live before the banner was due is shown once it is, still without a call", async () => {
    space("news");
    channel(10n);
    h.readStates.set("news", 10n);
    const w = await render();
    expect(banner(w).exists()).toBe(false);

    h.live.next(post(11n, "Hotfix is live"));
    channel(11n);
    await flushPromises();
    await flushPromises();

    expect(w.find('[data-testid="announcement-text"]').text()).toBe("Hotfix is live");
    expect(h.queryMessages).not.toHaveBeenCalled();
  });

  test("posts in other channels are not taken for the banner's", async () => {
    space("news");
    channel(10n);
    const w = await render();

    h.live.next({ ...post(11n, "chatter"), channelId: "general" });
    await flushPromises();

    expect(w.find('[data-testid="announcement-text"]').text()).toBe("Season two starts on Friday\nBring friends");
  });

  test("a mark that moved with no event keeps the shown post rather than asking", async () => {
    space("news");
    channel(10n);
    const w = await render();

    channel(12n);
    await flushPromises();
    await flushPromises();

    expect(banner(w).exists()).toBe(true);
    expect(h.queryMessages).toHaveBeenCalledTimes(1);
  });

  test("on mount the cached post is used, but not a cached row of another message under the same key", async () => {
    space("news");
    channel(10n);
    h.cached.mockImplementation(async (id: bigint) => post(id, "from the cache"));
    const fromCache = await render();
    expect(fromCache.find('[data-testid="announcement-text"]').text()).toBe("from the cache");
    expect(h.queryMessages).not.toHaveBeenCalled();

    // Past 2^53 two snowflakes round to one Number key.
    h.cached.mockImplementation(async () => post(2n ** 60n + 1n, "another message"));
    channel(2n ** 60n + 2n);
    h.queryMessages.mockImplementation(async () => [post(2n ** 60n + 2n, "the real one")]);
    const collided = await render();

    expect(collided.find('[data-testid="announcement-text"]').text()).toBe("the real one");
  });

  test("a spoiler in the post is masked", async () => {
    space("news");
    channel(10n);
    h.queryMessages.mockImplementation(async () => [
      { ...post(10n, "The winner is Bob, congrats"), entities: [{ type: EntityType.Spoiler, offset: 14, length: 3, version: 1 }] },
    ]);

    const w = await render();

    expect(w.find('[data-testid="announcement-text"]').text()).toBe(`The winner is ${SPOILER_MASK}, congrats`);
  });

  test("goes when the channel stops being the main one or turns into a text channel", async () => {
    space("news");
    channel(10n);
    const w = await render();
    expect(banner(w).exists()).toBe(true);

    channel(10n, ChannelType.Text);
    await flushPromises();
    expect(banner(w).exists()).toBe(false);

    channel(10n);
    space(null);
    await flushPromises();
    await flushPromises();
    expect(banner(w).exists()).toBe(false);
  });

  test("says the post is an attachment when it has no text", async () => {
    space("news");
    channel(10n);
    h.queryMessages.mockImplementation(async () => [post(10n, "")]);

    const w = await render();

    expect(w.find('[data-testid="announcement-text"]').text()).toBe("attachment");
  });
});
