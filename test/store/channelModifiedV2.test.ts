/**
 * ChannelModifiedV2 carries the change itself: a present key is the new value, null clears it,
 * anything absent is untouched. The handler patches the Dexie row and the live voice copy in
 * place, and only falls back to a full fetch for a channel it has never seen.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { FakeDb } from "./inMemoryDexie";

type Handler = (ev: any) => void;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler[]>(),
  db: null as any,
  getChannels: null as any,
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} },
}));
vi.mock("@/store/realtime/busStore", () => ({
  useBus: () => ({
    onServerEvent: (event: string, handler: Handler) => {
      h.handlers.set(event, [...(h.handlers.get(event) ?? []), handler]);
      return { unsubscribe() {} };
    },
  }),
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    serverInteraction: {},
    channelInteraction: { GetChannels: (...args: unknown[]) => h.getChannels(...args) },
  }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/db/dexie", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/store/data/userStore", () => ({
  useUserStore: () => ({ getUser: async () => null, trackUser: async () => {} }),
}));
vi.mock("@/store/data/channelStore", () => ({
  useChannelStore: () => ({
    trackChannel: async (channel: any) => {
      await h.db.channels.put(channel, channel.channelId);
    },
  }),
}));
vi.mock("@/store/data/archetypeStore", () => ({ useArchetypeStore: () => ({}) }));
vi.mock("@/store/data/serverStore", () => ({ useSpaceStore: () => ({}) }));
vi.mock("@/store/data/notificationStore", () => ({
  useNotificationStore: () => ({ subscribeToEvents() {} }),
}));
vi.mock("@/store/features/featureFlagsStore", () => ({
  useFeatureFlags: () => ({ subscribeToEvents() {} }),
}));
vi.mock("@/composables/useBotInteraction", () => ({
  useBotInteraction: () => ({ subscribe() {} }),
}));

import { useRealtimeStore } from "@/store/realtime/realtimeStore";
import { useEventStore } from "@/store/realtime/eventStore";

const SPACE = "space-1";

const channel = (channelId: string, extra: Record<string, unknown> = {}) =>
  ({
    channelId,
    spaceId: SPACE,
    name: channelId,
    type: 1,
    description: null,
    groupId: null,
    fractionalIndex: null,
    lastMessageId: 0,
    slowModeSeconds: null,
    bitrate: 64000,
    broadcast: null,
    ...extra,
  }) as any;

const settings = (targets: string[]) => ({
  targets,
  overlap: 0,
  duckingDb: -8,
  maxTransmitSeconds: 120,
  chirp: false,
});

const fire = (event: string, payload: unknown) => {
  for (const handler of h.handlers.get(event) ?? []) handler(payload);
};

/** Let the async event handlers run to the end. */
const settle = () => new Promise((r) => setTimeout(r, 0));

const modified = (channelId: string, patch: Record<string, unknown>) =>
  fire("ChannelModifiedV2", { spaceId: SPACE, channelId, patch });

beforeEach(() => {
  setActivePinia(createPinia());
  h.handlers.clear();
  h.db = new FakeDb();
  h.getChannels = vi.fn(async () => []);
  useEventStore().subscribeToEvents();
});

describe("ChannelModifiedV2 applies the patch locally", () => {
  test("a name patch changes the name and nothing else", async () => {
    h.db.channels.seed(channel("c1", { broadcast: settings(["c2"]) }));
    const rt = useRealtimeStore();
    rt.initRealtimeChannel(channel("c1", { broadcast: settings(["c2"]) }));

    modified("c1", { name: "Command" });
    await settle();

    const row = h.db.channels.peek("c1");
    expect(row.name).toBe("Command");
    expect(row.bitrate).toBe(64000);
    expect(row.broadcast).toEqual(settings(["c2"]));
    expect(rt.getRealtimeChannel("c1")!.Channel.name).toBe("Command");
    expect(h.getChannels).not.toHaveBeenCalled();
  });

  test("broadcast set lands in Dexie and on the live channel", async () => {
    h.db.channels.seed(channel("c1"));
    const rt = useRealtimeStore();
    rt.initRealtimeChannel(channel("c1"));

    modified("c1", { broadcast: settings(["c2", "c3"]) });
    await settle();

    expect(h.db.channels.peek("c1").broadcast).toEqual(settings(["c2", "c3"]));
    expect(rt.getRealtimeChannel("c1")!.Channel.broadcast).toEqual(settings(["c2", "c3"]));
    expect(rt.getRealtimeChannel("c1")!.Channel.name).toBe("c1");
  });

  test("broadcast: null clears the mode", async () => {
    h.db.channels.seed(channel("c1", { broadcast: settings(["c2"]) }));
    const rt = useRealtimeStore();
    rt.initRealtimeChannel(channel("c1", { broadcast: settings(["c2"]) }));

    modified("c1", { broadcast: null });
    await settle();

    const row = h.db.channels.peek("c1");
    expect(row.broadcast).toBeNull();
    expect(row.name).toBe("c1");
    expect(rt.getRealtimeChannel("c1")!.Channel.broadcast).toBeNull();
  });

  test("a channel not in voice only updates Dexie", async () => {
    h.db.channels.seed(channel("c1"));

    modified("c1", { name: "Renamed" });
    await settle();

    expect(h.db.channels.peek("c1").name).toBe("Renamed");
    expect(useRealtimeStore().getRealtimeChannel("c1")).toBeUndefined();
  });

  test("an unknown channel is fetched whole instead", async () => {
    h.getChannels = vi.fn(async () => [{ channel: channel("c9", { name: "Fresh", broadcast: settings([]) }) }]);

    modified("c9", { name: "Fresh" });
    await settle();

    expect(h.getChannels).toHaveBeenCalledWith(SPACE, "c9");
    expect(h.db.channels.peek("c9")).toMatchObject({ name: "Fresh", broadcast: settings([]) });
  });

  test("an unknown channel the server no longer lists stays absent", async () => {
    modified("c9", { name: "Gone" });
    await settle();

    expect(h.getChannels).toHaveBeenCalledWith(SPACE, "c9");
    expect(h.db.channels.peek("c9")).toBeUndefined();
  });
});
