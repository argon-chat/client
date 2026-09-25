/**
 * Voice flags on the roster.
 *
 * Every member row and tile reads its mute/deafen/stream state from `IRealtimeChannelUser.state`,
 * so rooms we are not in show it too. The regressions worth pinning: a join that resets a server
 * mute to nothing (addUserToChannel used to write 0 unconditionally), and the joiner's restriction
 * getting lost because it arrives while JoinedToChannelUser is still loading the user.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

type Handler = (ev: any) => void;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler[]>(),
  /** Holds userStore.getUser until the test lets it through. */
  userGate: null as Promise<void> | null,
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
vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({ serverInteraction: {} }) }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/db/dexie", () => ({
  db: { channels: { get: async (channelId: string) => ({ channelId }) } },
}));
vi.mock("@/store/data/userStore", () => ({
  useUserStore: () => ({
    getUser: async (userId: string) => {
      if (h.userGate) await h.userGate;
      return { userId, displayName: userId.toUpperCase(), avatarFileId: null };
    },
    trackUser: async () => {},
  }),
}));
vi.mock("@/store/data/channelStore", () => ({ useChannelStore: () => ({}) }));
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
import { VoiceStateBits } from "@argon/calls/voice-state";

const SPACE = "space-1";
const channel = (channelId: string, spaceId = SPACE) =>
  ({ channelId, spaceId, name: channelId, type: 1 }) as any;
const user = (userId: string) => ({ userId, displayName: userId, avatarFileId: null }) as any;

const fire = (event: string, payload: unknown) => {
  for (const handler of h.handlers.get(event) ?? []) handler(payload);
};

/** Let the async event handlers run to the end. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  setActivePinia(createPinia());
  h.handlers.clear();
  h.userGate = null;
});

describe("the roster keeps voice flags", () => {
  test("a new member starts with none, or with what the caller knows", () => {
    const rt = useRealtimeStore();
    rt.initRealtimeChannel(channel("c1"));

    rt.addUserToChannel("c1", "u1", user("u1"));
    rt.addUserToChannel("c1", "u2", user("u2"), VoiceStateBits.MUTED);

    expect(rt.getRealtimeChannel("c1")!.Users.get("u1")!.state).toBe(0);
    expect(rt.getRealtimeChannel("c1")!.Users.get("u2")!.state).toBe(VoiceStateBits.MUTED);
  });

  test("adding a member again does not wipe a server mute", () => {
    const rt = useRealtimeStore();
    rt.initRealtimeChannel(channel("c1"));
    rt.addUserToChannel("c1", "u1", user("u1"));
    rt.setUserVoiceState("c1", "u1", VoiceStateBits.MUTED_BY_SERVER);

    // A repeated JoinedToChannelUser, or the LiveKit reconciliation, re-adds the row.
    rt.addUserToChannel("c1", "u1", user("u1"));

    expect(rt.getRealtimeChannel("c1")!.Users.get("u1")!.state).toBe(VoiceStateBits.MUTED_BY_SERVER);
  });

  test("flags for someone not added yet wait for them", () => {
    const rt = useRealtimeStore();
    rt.initRealtimeChannel(channel("c1"));

    rt.setUserVoiceState("c1", "u1", VoiceStateBits.MUTED_HEADPHONES_BY_SERVER);
    expect(rt.getRealtimeChannel("c1")!.Users.has("u1")).toBe(false);

    rt.addUserToChannel("c1", "u1", user("u1"));
    expect(rt.getRealtimeChannel("c1")!.Users.get("u1")!.state).toBe(VoiceStateBits.MUTED_HEADPHONES_BY_SERVER);
  });

  test("parked flags do not outlive a leave", () => {
    const rt = useRealtimeStore();
    rt.initRealtimeChannel(channel("c1"));
    rt.setUserVoiceState("c1", "u1", VoiceStateBits.MUTED_BY_SERVER);

    rt.removeUserFromChannel("c1", "u1");
    rt.addUserToChannel("c1", "u1", user("u1"));

    expect(rt.getRealtimeChannel("c1")!.Users.get("u1")!.state).toBe(0);
  });

  test("a moderation reply changes only the moderation bits, only in that space", () => {
    const rt = useRealtimeStore();
    rt.initRealtimeChannel(channel("c1"));
    rt.initRealtimeChannel(channel("c9", "space-2"));
    rt.addUserToChannel("c1", "u1", user("u1"), VoiceStateBits.MUTED | VoiceStateBits.STREAMING);
    rt.addUserToChannel("c9", "u1", user("u1"), 0);

    rt.setUserServerVoiceState(SPACE, "u1", true, false);

    expect(rt.getRealtimeChannel("c1")!.Users.get("u1")!.state)
      .toBe(VoiceStateBits.MUTED | VoiceStateBits.STREAMING | VoiceStateBits.MUTED_BY_SERVER);
    expect(rt.getRealtimeChannel("c9")!.Users.get("u1")!.state).toBe(0);
  });
});

describe("VoiceMemberStateChanged", () => {
  test("lands on the member's row", async () => {
    const rt = useRealtimeStore();
    useEventStore().subscribeToEvents();
    rt.initRealtimeChannel(channel("c1"));
    rt.addUserToChannel("c1", "u1", user("u1"));

    fire("VoiceMemberStateChanged", { spaceId: SPACE, channelId: "c1", userId: "u1", state: VoiceStateBits.STREAMING });

    expect(rt.getRealtimeChannel("c1")!.Users.get("u1")!.state).toBe(VoiceStateBits.STREAMING);
  });

  test("arriving while the join is still loading the user, it is not lost", async () => {
    const rt = useRealtimeStore();
    useEventStore().subscribeToEvents();
    rt.initRealtimeChannel(channel("c1"));

    let release!: () => void;
    h.userGate = new Promise<void>((r) => (release = r));

    fire("JoinedToChannelUser", { spaceId: SPACE, channelId: "c1", userId: "u1" });
    // The server sends the joiner's restriction right after the join event.
    fire("VoiceMemberStateChanged", {
      spaceId: SPACE, channelId: "c1", userId: "u1",
      state: VoiceStateBits.MUTED_BY_SERVER | VoiceStateBits.MUTED_HEADPHONES_BY_SERVER,
    });
    await settle();
    expect(rt.getRealtimeChannel("c1")!.Users.has("u1")).toBe(false);

    release();
    await settle();

    expect(rt.getRealtimeChannel("c1")!.Users.get("u1")!.state)
      .toBe(VoiceStateBits.MUTED_BY_SERVER | VoiceStateBits.MUTED_HEADPHONES_BY_SERVER);
  });

  test("guests are left to LiveKit", () => {
    const rt = useRealtimeStore();
    useEventStore().subscribeToEvents();
    rt.initRealtimeChannel(channel("c1"));
    const guest = "ccccfcfa-0000-0000-0000-000000000001";
    rt.addUserToChannel("c1", guest, user(guest));

    fire("VoiceMemberStateChanged", { spaceId: SPACE, channelId: "c1", userId: guest, state: VoiceStateBits.MUTED });

    expect(rt.getRealtimeChannel("c1")!.Users.get(guest)!.state).toBe(0);
  });
});
