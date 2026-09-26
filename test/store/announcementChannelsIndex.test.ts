/**
 * The rail's announcement query against a real Dexie (on fake-indexeddb).
 *
 * Every received message writes its channel row (`lastMessageId`), in every space. The query used
 * to be `channels.filter(type === Announcement)`: a full scan, which a live query can only observe
 * as "the whole table", so it ran again on every message anywhere. It now reads the `type` index,
 * and a live query observes the index range it read — a text channel's row moving is outside it.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

await vi.hoisted(async () => {
  // Before Dexie loads: it picks up the IndexedDB implementation once, at import.
  const { indexedDB, IDBKeyRange } = await import("fake-indexeddb");
  Object.assign(globalThis, { indexedDB, IDBKeyRange });
});

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
}));
vi.mock("@/store/data/notificationStore", () => ({
  useNotificationStore: () => ({
    isChannelUnread: (_id: string, last: bigint) => last > 0n,
    effectiveMuteLevel: () => 0,
  }),
}));

import { ChannelType } from "@argon/glue";
import { PoolDatabase, db, ensureDbOpen } from "@/store/db/dexie";
import { useAnnouncementStore } from "@/store/data/announcementStore";

const channel = (channelId: string, type: ChannelType, lastMessageId = 1n, spaceId = "s1") =>
  ({ channelId, spaceId, name: channelId, type, groupId: null, lastMessageId }) as any;

const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  setActivePinia(createPinia());
  await ensureDbOpen();
  await db.channels.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the channels table", () => {
  test("is indexed by type", () => {
    const probe = new PoolDatabase("probe-channel-index");
    expect(probe.channels.schema.idxByName.type).toBeDefined();
  });

  test("keeps its rows across the upgrade that adds the index", async () => {
    const name = "probe-upgrade-v6";
    // What a v6 client left behind.
    const old = new (await import("dexie")).default(name);
    old.version(6).stores({ channels: "channelId, spaceId" });
    await old.table("channels").put(channel("news", ChannelType.Announcement));
    old.close();

    const upgraded = new PoolDatabase(name);
    await upgraded.open();

    expect(await upgraded.channels.where("type").equals(ChannelType.Announcement).count()).toBe(1);
    upgraded.close();
  });
});

describe("the rail's announcement query", () => {
  test("reads through the index and is not re-run by a message in a text channel", async () => {
    await db.channels.bulkPut([channel("general", ChannelType.Text), channel("news", ChannelType.Announcement, 5n)]);
    const where = vi.spyOn(db.channels, "where");
    const filter = vi.spyOn(db.channels, "filter");

    const queries = () => where.mock.calls.length + filter.mock.calls.length;

    const store = useAnnouncementStore();
    store.hasUnreadIn("s1");
    await vi.waitFor(() => expect(store.channels.map((c) => c.channelId)).toEqual(["news"]));
    await settle();
    const runs = queries();
    expect(runs).toBeGreaterThan(0);

    // What notificationStore.trackChannel does for each message received in #general.
    for (let id = 2n; id < 12n; id++) {
      await db.channels.put(channel("general", ChannelType.Text, id), "general");
    }
    await settle();

    expect(queries()).toBe(runs);
    expect(where).toHaveBeenCalledWith("type");
    expect(filter).not.toHaveBeenCalled();
  });

  test("still follows a post in an announcement channel", async () => {
    await db.channels.bulkPut([channel("news", ChannelType.Announcement, 5n)]);
    const store = useAnnouncementStore();
    store.hasUnreadIn("s1");
    await vi.waitFor(() => expect(store.channels[0]?.lastMessageId).toBe(5n));

    await db.channels.put(channel("news", ChannelType.Announcement, 9n), "news");

    await vi.waitFor(() => expect(store.channels[0]?.lastMessageId).toBe(9n));
  });

  test("sees a text channel that becomes an announcement channel", async () => {
    await db.channels.bulkPut([channel("general", ChannelType.Text)]);
    const store = useAnnouncementStore();
    store.hasUnreadIn("s1");
    await settle();
    expect(store.channels).toEqual([]);

    await db.channels.put(channel("general", ChannelType.Announcement), "general");

    await vi.waitFor(() => expect(store.channels.map((c) => c.channelId)).toEqual(["general"]));
  });
});
