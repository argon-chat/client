/**
 * Who may draw on whose share. The host decides from its platform (an overlay or not) and its
 * "stream.draw" rule, and says so with the `draw` capability on its participant; a host whose rule
 * says nobody can still allow this one share. Viewers read the offer off the participant and, in
 * a channel, still need CanDrawOnStream. Strokes are attributed to their real sender, and the
 * host's overlay takes only the ones its offer covers.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { nextTick, reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";

const h = vi.hoisted(() => ({
  call: null as any,
  getRule: vi.fn(),
  friends: new Set<string>(),
  entitled: true,
  ff: null as any,
}));

vi.mock("livekit-client", () => ({ RoomEvent: { DataReceived: "dataReceived" } }));
vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => h.call }));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ privacyInteraction: { GetPrivacyRule: h.getRule } }),
}));
vi.mock("@/store/data/friendsStore", () => ({
  useFriendsStore: () => ({ isFriend: (id: string) => h.friends.has(id) }),
}));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ hasIn: () => h.entitled }) }));
vi.mock("@/store/features/featureFlagsStore", () => ({ useFeatureFlags: () => h.ff }));

import { PrivacyRuleMode } from "@argon/glue";
import { DRAW_TOPIC, type DrawPacket } from "@/lib/screencast-draw/types";
import { useDrawingSession } from "@/store/features/drawingSessionStore";

/** The Electron bridge to the native overlay, as the preload exposes it. */
const bridge = {
  available: true,
  isAvailable: vi.fn(async () => bridge.available),
  start: vi.fn(),
  stop: vi.fn(),
  applyStroke: vi.fn(),
};
(window as any).argonScreencastDraw = bridge;

/** A LiveKit room reduced to what the store touches: the data channel, both ways. */
function fakeRoom() {
  const handlers = new Map<string, Function>();
  return {
    on: (event: string, cb: Function) => handlers.set(event, cb),
    off: (event: string) => handlers.delete(event),
    localParticipant: {
      publishData: vi.fn(async (_payload: Uint8Array, _opts: { reliable: boolean; topic: string }) => {}),
    },
    /** Deliver a packet as LiveKit would: payload, the sender, kind, topic. */
    receive(packet: object, sender: string, topic = DRAW_TOPIC) {
      handlers.get("dataReceived")?.(
        new TextEncoder().encode(JSON.stringify(packet)),
        { identity: sender },
        undefined,
        topic,
      );
    },
  };
}

const strokeOn = (target: string, from: string) => ({
  v: 1, from, target, t: 1, kind: "begin", strokeId: "s", tool: "brush",
  color: "#fff", width: 0.01, ttlMs: 1000, p: [[0, 0]],
});

const offers = (caps: Record<string, string>) => ({ capabilities: new Map(Object.entries(caps)) });

const settle = () => new Promise((r) => setTimeout(r, 0));

async function store() {
  const s = useDrawingSession();
  await settle(); // the overlay probe
  return s;
}

beforeEach(() => {
  setActivePinia(createPinia());
  h.call = reactive({
    room: null as any,
    participants: {} as Record<string, any>,
    connectedVoiceChannelId: "chan",
    connectedVoiceSpaceId: "space",
    setCapability: vi.fn(),
    capabilityOf(userId: string, name: string) {
      const value = this.participants[userId]?.capabilities?.get(name);
      return value === undefined ? null : value;
    },
  });
  h.ff = reactive({ screencastDrawingActive: true });
  h.getRule = vi.fn(async () => ({ mode: PrivacyRuleMode.EVERYBODY }));
  h.friends = new Set();
  h.entitled = true;
  bridge.available = true;
  bridge.start.mockReset();
  bridge.stop.mockReset();
  bridge.applyStroke.mockReset();
});

describe("the host's offer", () => {
  test("a client without an overlay offers nothing", async () => {
    bridge.available = false;
    const s = await store();
    await s.beginStreamerSession("screen:1");
    expect(s.offered).toBeNull();
    expect(s.canAllowThisShare).toBe(false);
    expect(h.call.setCapability).not.toHaveBeenCalled();
    expect(bridge.start).not.toHaveBeenCalled();
  });

  test("a rule of everybody offers draw, and the overlay lives as long as the share", async () => {
    const s = await store();
    await s.beginStreamerSession("screen:1");
    expect(s.offered).toBe("");
    expect(h.call.setCapability).toHaveBeenLastCalledWith("draw", "");
    expect(bridge.start).toHaveBeenCalledWith("screen:1");
    expect(s.isDrawable("me")).toBe(true);
    expect(s.canIDrawOn("me")).toBe(false);

    s.endStreamerSession();
    expect(s.offered).toBeNull();
    expect(h.call.setCapability).toHaveBeenLastCalledWith("draw", null);
    expect(bridge.stop).toHaveBeenCalled();
  });

  test("a rule of contacts says so in the offer, and the overlay takes strokes from contacts only", async () => {
    h.getRule.mockResolvedValue({ mode: PrivacyRuleMode.CONTACTS });
    h.friends.add("friend");
    const room = fakeRoom();
    h.call.room = room;
    const s = await store();
    await s.beginStreamerSession(null);
    expect(s.offered).toBe("contacts");
    expect(h.call.setCapability).toHaveBeenLastCalledWith("draw", "contacts");

    const seen: DrawPacket[] = [];
    s.registerConsumer("me", (p) => seen.push(p));
    room.receive(strokeOn("me", "friend"), "friend");
    room.receive(strokeOn("me", "stranger"), "stranger");
    expect(seen.map((p) => p.from)).toEqual(["friend"]);
    expect(bridge.applyStroke).toHaveBeenCalledTimes(1);
  });

  test("a rule of nobody offers nothing until the host allows this share, and that ends with the share", async () => {
    h.getRule.mockResolvedValue({ mode: PrivacyRuleMode.NOBODY });
    const s = await store();
    await s.beginStreamerSession("screen:2");
    expect(s.offered).toBeNull();
    expect(s.canAllowThisShare).toBe(true);
    expect(bridge.start).not.toHaveBeenCalled();

    s.toggleAllowThisShare();
    expect(s.allowedThisShare).toBe(true);
    expect(s.offered).toBe("");
    expect(h.call.setCapability).toHaveBeenLastCalledWith("draw", "");
    expect(bridge.start).toHaveBeenCalledWith("screen:2");

    s.endStreamerSession();
    expect(s.allowedThisShare).toBe(false);
    expect(bridge.stop).toHaveBeenCalled();

    await s.beginStreamerSession("screen:2");
    expect(s.offered).toBeNull();
  });

  test("when the rule cannot be read nothing is offered, but the host may still allow the share", async () => {
    h.getRule.mockRejectedValue(new Error("down"));
    const s = await store();
    await s.beginStreamerSession("screen:1");
    expect(s.offered).toBeNull();
    expect(s.canAllowThisShare).toBe(true);
  });

  test("a share that ended while its rule was loading does not come back", async () => {
    let answer!: (rule: unknown) => void;
    h.getRule.mockReturnValue(new Promise((r) => { answer = r; }));
    const s = await store();
    const begun = s.beginStreamerSession("screen:1");
    s.endStreamerSession();
    answer({ mode: PrivacyRuleMode.EVERYBODY });
    await begun;
    expect(s.offered).toBeNull();
    expect(bridge.start).not.toHaveBeenCalled();
  });

  test("with the feature off nothing is offered or drawable", async () => {
    h.ff.screencastDrawingActive = false;
    const s = await store();
    await s.beginStreamerSession("screen:1");
    h.call.participants.bob = offers({ draw: "" });
    expect(s.offered).toBeNull();
    expect(s.isDrawable("bob")).toBe(false);
  });
});

describe("a viewer", () => {
  test("may draw when the host's offer covers them and the channel lets them", async () => {
    const s = await store();
    h.call.participants.bob = offers({ draw: "" });
    expect(s.isDrawable("bob")).toBe(true);
    expect(s.canIDrawOn("bob")).toBe(true);
    expect(s.canDrawAnywhere).toBe(true);

    h.entitled = false;
    expect(s.canIDrawOn("bob")).toBe(false);
    h.entitled = true;

    h.call.participants.bob = offers({ draw: "contacts" });
    expect(s.isDrawable("bob")).toBe(true);
    expect(s.canIDrawOn("bob")).toBe(false);
    h.friends.add("bob");
    expect(s.canIDrawOn("bob")).toBe(true);

    h.call.participants.bob = offers({});
    expect(s.isDrawable("bob")).toBe(false);
    expect(s.canIDrawOn("bob")).toBe(false);
  });

  test("in a direct call there is no channel right to hold; the offer alone decides", async () => {
    h.call.connectedVoiceChannelId = null;
    h.entitled = false;
    const s = await store();
    h.call.participants.bob = offers({ draw: "" });
    expect(s.canIDrawOn("bob")).toBe(true);
  });

  test("draw mode drops once nothing is drawable", async () => {
    h.call.participants.bob = offers({ draw: "" });
    const s = await store();
    expect(s.canDrawAnywhere).toBe(true);
    s.toggleDrawMode();
    expect(s.drawMode).toBe(true);

    h.call.participants.bob = offers({});
    await nextTick();
    expect(s.canDrawAnywhere).toBe(false);
    expect(s.drawMode).toBe(false);
  });
});

describe("strokes", () => {
  test("are attributed to their real sender and painted only for a host that offers drawing", async () => {
    const room = fakeRoom();
    h.call.room = room;
    const s = await store();
    h.call.participants.bob = offers({ draw: "" });
    const seen: DrawPacket[] = [];
    s.registerConsumer("bob", (p) => seen.push(p));

    room.receive(strokeOn("bob", "carol"), "carol");
    room.receive(strokeOn("bob", "carol"), "dave"); // claims to be carol; is not
    room.receive(strokeOn("eve", "carol"), "carol"); // eve offers nothing
    room.receive(strokeOn("bob", "carol"), "carol", "other-topic");
    room.receive({ v: 1, from: "carol", target: "bob", kind: "nonsense" }, "carol");

    expect(seen).toHaveLength(2);
    expect(bridge.applyStroke).not.toHaveBeenCalled();
  });

  test("publishing stamps the envelope, echoes locally and sends on the draw topic", async () => {
    const room = fakeRoom();
    h.call.room = room;
    const s = await store();
    h.call.participants.bob = offers({ draw: "" });
    const seen: DrawPacket[] = [];
    s.registerConsumer("bob", (p) => seen.push(p));

    s.publish("bob", { kind: "begin", strokeId: "s1", tool: "arrow", color: "#f00", width: 0.004, ttlMs: 6000, p: [[0.1, 0.2]] });
    s.publish("bob", { kind: "append", strokeId: "s1", p: [[0.2, 0.3]] });
    s.clearOwn("bob");

    expect(seen.map((p) => p.kind)).toEqual(["begin", "append", "clear"]);
    expect(seen[0]).toMatchObject({ v: 1, from: "me", target: "bob" });
    expect(seen[2]).toMatchObject({ kind: "clear", who: "me" });

    const sent = room.localParticipant.publishData.mock.calls;
    expect(sent.map((c: any[]) => c[1])).toEqual([
      { reliable: true, topic: DRAW_TOPIC },
      { reliable: false, topic: DRAW_TOPIC },
      { reliable: true, topic: DRAW_TOPIC },
    ]);
    expect(JSON.parse(new TextDecoder().decode(sent[0][0]))).toMatchObject({ from: "me", target: "bob", kind: "begin" });

    // Nothing leaves for a host whose offer does not cover me.
    h.call.participants.bob = offers({ draw: "contacts" });
    s.publish("bob", { kind: "undo", strokeId: "s1" });
    expect(sent).toHaveLength(3);
    expect(seen).toHaveLength(3);
  });
});
