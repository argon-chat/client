/**
 * The shared call stage: one tile layout for voice channels and direct calls.
 *
 * What these guard: the DM view used to lay tiles out on its own — fixed rem boxes, a
 * special case for exactly two people, a main tile that was just "100% wide" — and the
 * two views drifted every time the channel one improved. Now both hand their layout to
 * CallGrid, so the assertions here are the contract for both: the stage picks grid or
 * main+strip from the participants, every tile is sized by the solver from a measured
 * region, and the same participants in the same box come out identical whether they
 * arrived through a channel's member list or a DM's call.
 *
 * The real ParticipantCard is rendered (only its collaborators are stubbed) so a prop the
 * grid passes and the card no longer accepts fails here, not in the app.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";

// ── Fakes ────────────────────────────────────────────────────────────────────

const fakeTrack = () => ({ attach: vi.fn(), detach: vi.fn() });
type FakeTrack = ReturnType<typeof fakeTrack>;

type FakeParticipant = {
  userId: string;
  displayName: string;
  muted: boolean;
  mutedAll: boolean;
  screencast: boolean;
  volume: number[];
};

/**
 * The call store as the layout and the attach composable see it. Reactive, so a track
 * arriving or a participant leaving re-renders the grid the way it does in the app.
 */
const voice = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  const v = reactive({
    room: null as null | { localParticipant: object },
    isConnected: true,
    isSharing: false,
    qualityConnection: "GREEN",
    participants: {} as Record<string, FakeParticipant>,
    speaking: new Set<string>(),
    videoTracks: new Map<string, { attach: (el: unknown) => void; detach: (el: unknown) => void }>(),
    diagnostics: new Map<string, Record<string, unknown>>(),
    participantQuality: new Map<string, string>(),
    subscriptionErrors: new Map<string, string>(),
    activeSpeakerId: null as string | null,
    videoTrackKey: (uid: string, source: string) => `${uid}:${source}`,
    hasVideoTrack: (uid: string) => [...v.videoTracks.keys()].some((k) => k.startsWith(`${uid}:`)),
    isVideoPaused: () => false,
    isVideoHidden: () => false,
    videoQualityOf: () => 2,
    setVideoHidden: () => {},
    setVideoQuality: () => {},
  });
  return v;
});

/** Channel membership, keyed by channel id, as the pool store exposes it. */
const pool = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  return reactive({ realtimeChannelUsers: new Map<string, { Users: Map<string, unknown> }>() });
});

/**
 * Measured region sizes, keyed by the `data-area` attribute CallGrid puts on each region.
 * happy-dom does no layout, so `useElementSize` is replaced by a lookup into this table.
 */
const areas = await vi.hoisted(async () => {
  const { reactive } = await import("vue");
  return reactive<Record<string, { width: number; height: number }>>({});
});

vi.mock("@vueuse/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vueuse/core")>();
  const { computed, toValue } = await import("vue");
  const areaOf = (target: unknown) =>
    (toValue(target) as HTMLElement | null)?.getAttribute?.("data-area") ?? null;
  return {
    ...actual,
    useElementSize: (target: unknown) => ({
      width: computed(() => {
        const a = areaOf(target);
        return a ? (areas[a]?.width ?? 0) : 0;
      }),
      height: computed(() => {
        const a = areaOf(target);
        return a ? (areas[a]?.height ?? 0) : 0;
      }),
    }),
  };
});

vi.mock("@/store/media/unifiedCallStore", () => ({ useUnifiedCall: () => voice }));
vi.mock("@/store/data/poolStore", () => ({ usePoolStore: () => pool }));
vi.mock("@/store/auth/meStore", () => ({
  useMe: () => ({ me: { userId: "me", displayName: "Me" } }),
}));
vi.mock("@/store/system/systemStore", () => ({
  useSystemStore: () => ({ microphoneMuted: false, headphoneMuted: false }),
}));
vi.mock("@/store/features/playframeStore", () => ({
  usePlayFrameActivity: () => ({
    channelActivities: [],
    isActive: false,
    myRole: null,
    sessionLifecycle: null,
    joinActivity: () => {},
  }),
}));

// ParticipantCard's own collaborators, replaced the same way its own test does.
const { stubModule, passthrough, empty } = vi.hoisted(() => ({
  stubModule: (name: string, cls: string) => async () => {
    const { h } = await import("vue");
    return { default: { name, setup: () => () => h("div", { class: cls }) } };
  },
  passthrough: (name: string) => ({
    name,
    setup: (_p: unknown, { slots }: { slots: Record<string, undefined | (() => unknown)> }) =>
      () => slots.default?.() ?? null,
  }),
  empty: (name: string) => ({ name, setup: () => () => null }),
}));
vi.mock("@/components/ArgonAvatar.vue", stubModule("ArgonAvatar", "stub-avatar"));
vi.mock("@/components/DrawOverlay.vue", stubModule("DrawOverlay", "stub-draw-overlay"));
vi.mock("@/store/features/drawingSessionStore", () => ({
  useDrawingSession: () => ({ isSessionActive: () => false }),
}));
vi.mock("@/store/system/localeStore", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("livekit-client", () => ({ VideoQuality: { LOW: 0, MEDIUM: 1, HIGH: 2 } }));
vi.mock("@argon/ui/context-menu", () => ({
  ContextMenu: passthrough("ContextMenu"),
  ContextMenuTrigger: passthrough("ContextMenuTrigger"),
  ContextMenuContent: empty("ContextMenuContent"),
  ContextMenuItem: passthrough("ContextMenuItem"),
  ContextMenuSeparator: passthrough("ContextMenuSeparator"),
  ContextMenuSub: passthrough("ContextMenuSub"),
  ContextMenuSubContent: passthrough("ContextMenuSubContent"),
  ContextMenuSubTrigger: passthrough("ContextMenuSubTrigger"),
}));
// An activity tile is a sibling of the participant tiles; only its sizing matters here.
vi.mock("@/components/playframe/ActivityCard.vue", async () => {
  const { h } = await import("vue");
  return {
    default: {
      name: "ActivityCard",
      props: ["presence", "className", "customStyle"],
      setup: (p: { customStyle?: Record<string, string> }) => () =>
        h("div", { class: "stub-activity", style: p.customStyle }),
    },
  };
});

import CallGrid, { GRID_GAP, STRIP_GAP, MAX_TILE_WIDTH, MIN_TILE_WIDTH } from "@/components/calls/CallGrid.vue";
import { useMediaLayout } from "@/composables/useMediaLayout";
import { solveGrid } from "@/composables/useResponsiveGrid";
import type { ActivityPresence } from "@/store/features/playframeStore";

// ── Helpers ──────────────────────────────────────────────────────────────────

const CHANNEL = "ch1";
const RATIO = 16 / 9;

/** A wide desktop window. */
const DESKTOP = {
  grid: { width: 1200, height: 700 },
  main: { width: 1200, height: 560 },
  strip: { width: 1200, height: 128 },
};

function measure(sizes: Partial<typeof DESKTOP>) {
  for (const k of Object.keys(areas)) delete areas[k];
  Object.assign(areas, sizes);
}

/** Put `names` into the channel, keyed by a lowercase id ("Alice" -> "alice"). */
function channelUsers(...names: string[]) {
  const users = new Map<string, unknown>();
  for (const n of names) {
    const id = n.toLowerCase();
    users.set(id, {
      User: { userId: id, displayName: n },
      isSpeaking: false,
      isMuted: false,
      isScreenShare: false,
      volume: [100],
      isRecording: false,
    });
  }
  pool.realtimeChannelUsers.set(CHANNEL, { Users: users });
}

/** Put `names` into a direct call: us plus these remote peers. */
function dmUsers(...names: string[]) {
  voice.room = { localParticipant: {} };
  for (const k of Object.keys(voice.participants)) delete voice.participants[k];
  for (const n of names) {
    const id = n.toLowerCase();
    voice.participants[id] = { userId: id, displayName: n, muted: false, mutedAll: false, screencast: false, volume: [100] };
  }
}

function publish(uid: string, source: "camera" | "screen_share", dims?: { width: number; height: number }): FakeTrack {
  const t = fakeTrack();
  voice.videoTracks.set(`${uid}:${source}`, t);
  if (dims) voice.diagnostics.set(uid, dims);
  return t;
}

const activity = (sessionId: string): ActivityPresence =>
  ({
    sessionId,
    hostId: "bob",
    hostName: "Bob",
    gameId: "pong",
    gameTitle: "Pong",
    state: "waiting",
    mode: "multiplayer",
    joinable: true,
    playerCount: 1,
    maxPlayers: 2,
    players: ["bob"],
  });

let mounted: VueWrapper[] = [];

async function render(mode: "channel" | "dm" = "channel", activities: ActivityPresence[] = []) {
  const layout = useMediaLayout(() => (mode === "channel" ? CHANNEL : null), mode);
  const w = mount(CallGrid, { props: { layout, activities } });
  mounted.push(w);
  // The regions are measured once their elements exist, one tick after mount.
  await nextTick();
  return w;
}

const tiles = (w: VueWrapper) => w.findAll(".participant-card");
const names = (w: VueWrapper) => tiles(w).map((t) => t.find(".participant-name").text());
const px = (el: { element: Element }, prop: "width" | "height") =>
  Number.parseFloat((el.element as HTMLElement).style[prop] || "0");
const styleOf = (el: { element: Element }) => {
  const s = (el.element as HTMLElement).style;
  return { width: s.width, height: s.height, aspectRatio: s.aspectRatio };
};

const gridOpts = { maxTileWidth: MAX_TILE_WIDTH, minTileWidth: MIN_TILE_WIDTH };
const expectedGrid = (count: number, area = DESKTOP.grid) =>
  solveGrid(area.width, area.height, count, RATIO, GRID_GAP, gridOpts);
const expectedStrip = (count: number, area = DESKTOP.strip) =>
  solveGrid(area.width, area.height, count, RATIO, STRIP_GAP, { singleRow: true });

beforeEach(() => {
  measure(DESKTOP);
  pool.realtimeChannelUsers.clear();
  voice.room = null;
  for (const k of Object.keys(voice.participants)) delete voice.participants[k];
  voice.videoTracks.clear();
  voice.diagnostics.clear();
  voice.speaking.clear();
  voice.isSharing = false;
});

afterEach(() => {
  for (const w of mounted) w.unmount();
  mounted = [];
});

// ── Grid mode ────────────────────────────────────────────────────────────────

describe("grid mode: tiles are solved from the measured area", () => {
  test("one tile per participant, all the same size, all inside the box", async () => {
    for (const count of [1, 2, 3, 4, 5, 7, 9, 12]) {
      channelUsers(...Array.from({ length: count }, (_, i) => `U${i}`));
      const w = await render();

      const all = tiles(w);
      expect(all, `count=${count}`).toHaveLength(count);

      const g = expectedGrid(count);
      for (const t of all) {
        expect(px(t, "width"), `count=${count}`).toBeCloseTo(g.tileWidth, 3);
        expect(px(t, "height"), `count=${count}`).toBeCloseTo(g.tileHeight, 3);
      }
      expect(g.cols * g.tileWidth + GRID_GAP * (g.cols - 1)).toBeLessThanOrEqual(DESKTOP.grid.width + 0.001);
      expect(g.rows * g.tileHeight + GRID_GAP * (g.rows - 1)).toBeLessThanOrEqual(DESKTOP.grid.height + 0.001);
      w.unmount();
    }
  });

  test("two people are laid out by the same solver as any other count", async () => {
    // The DM view used to special-case exactly two tiles as `flex-1` halves with a rem
    // cap. Now they are solved: in a wide box that is two columns, in a tall one it is
    // two rows, and either way the tile is what the solver says, not what a class does.
    channelUsers("Alice", "Bob");

    measure({ grid: { width: 1600, height: 500 } });
    let w = await render();
    let g = expectedGrid(2, { width: 1600, height: 500 });
    expect(g.cols).toBe(2);
    for (const t of tiles(w)) expect(px(t, "width")).toBeCloseTo(g.tileWidth, 3);
    expect(w.find(".call-grid--tiles").classes()).not.toContain("grid-cols-2");
    w.unmount();

    measure({ grid: { width: 500, height: 1200 } });
    w = await render();
    g = expectedGrid(2, { width: 500, height: 1200 });
    expect(g.rows).toBe(2);
    for (const t of tiles(w)) expect(px(t, "width")).toBeCloseTo(g.tileWidth, 3);
  });

  test("a lone tile on a huge screen stops at the width cap", async () => {
    channelUsers("Alice");
    measure({ grid: { width: 4000, height: 2200 } });
    const w = await render();
    const t = tiles(w)[0];
    expect(px(t, "width")).toBe(MAX_TILE_WIDTH);
    expect(px(t, "height")).toBeCloseTo(MAX_TILE_WIDTH / RATIO, 3);
  });

  test("a crowd in a tiny box keeps the floor width and scrolls instead of vanishing", async () => {
    channelUsers(...Array.from({ length: 20 }, (_, i) => `U${i}`));
    measure({ grid: { width: 320, height: 200 } });
    const w = await render();
    expect(tiles(w)).toHaveLength(20);
    for (const t of tiles(w)) expect(px(t, "width")).toBe(MIN_TILE_WIDTH);
  });

  test("before the area is measured, tiles carry no size and no ratio", async () => {
    // The zero-size window: a layout switch or a fullscreen transition. A lone
    // aspect-ratio here would let a tile grow without bound.
    channelUsers("Alice", "Bob", "Carol");
    measure({});
    const w = await render();
    for (const t of tiles(w)) {
      expect(styleOf(t)).toEqual({ width: "", height: "", aspectRatio: "" });
    }
  });

  test("resizing the area re-solves every tile", async () => {
    channelUsers("Alice", "Bob", "Carol");
    const w = await render();
    const before = px(tiles(w)[0], "width");

    areas.grid = { width: 600, height: 400 };
    await nextTick();

    const after = px(tiles(w)[0], "width");
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(expectedGrid(3, { width: 600, height: 400 }).tileWidth, 3);
  });

  test("the container gap is the gap the solver was told about", async () => {
    channelUsers("Alice", "Bob");
    const w = await render();
    expect((w.find(".call-grid--tiles").element as HTMLElement).style.gap).toBe(`${GRID_GAP}px`);
  });

  test("nobody in the call is an empty grid, not an error", async () => {
    channelUsers();
    const w = await render();
    expect(tiles(w)).toHaveLength(0);
    expect(w.find(".call-grid--tiles").exists()).toBe(true);
  });

  test("a participant leaving takes their tile with them", async () => {
    channelUsers("Alice", "Bob", "Carol");
    const w = await render();
    expect(names(w)).toEqual(["Alice", "Bob", "Carol"]);

    channelUsers("Alice", "Carol");
    await nextTick();
    expect(names(w)).toEqual(["Alice", "Carol"]);
    for (const t of tiles(w)) expect(px(t, "width")).toBeCloseTo(expectedGrid(2).tileWidth, 3);
  });
});

// ── Stream mode ──────────────────────────────────────────────────────────────

describe("stream mode: a share takes the main slot and the rest form a strip", () => {
  test("the sharer is main with their screen, everyone else sits in the strip with a camera", async () => {
    channelUsers("Alice", "Bob", "Carol");
    const share = publish("bob", "screen_share", { width: 1920, height: 1080 });
    const bobCam = publish("bob", "camera");
    const aliceCam = publish("alice", "camera");
    const w = await render();

    expect(w.find(".call-grid--stream").exists()).toBe(true);
    const main = w.find(".call-grid__main");
    expect(main.find(".participant-name").text()).toBe("Bob");
    expect(main.find("video").exists()).toBe(true);
    // Main shows the screen, not the face...
    expect(share.attach).toHaveBeenCalledWith(main.find("video").element);
    expect(bobCam.attach).not.toHaveBeenCalled();
    // ...at its own shape rather than cropped.
    expect((main.find("video").element as HTMLElement).style.objectFit).toBe("contain");

    const strip = w.find(".call-grid__strip");
    expect(strip.findAll(".participant-name").map((n) => n.text())).toEqual(["Alice", "Carol"]);
    expect(aliceCam.attach).toHaveBeenCalledWith(strip.find("video").element);
  });

  test("the main slot never repeats in the strip", async () => {
    channelUsers("Alice", "Bob");
    publish("alice", "screen_share");
    const w = await render();
    expect(names(w)).toEqual(["Alice", "Bob"]);
    expect(w.find(".call-grid__strip").findAll(".participant-name").map((n) => n.text())).toEqual(["Bob"]);
  });

  test("a sharer alone gets no strip at all", async () => {
    channelUsers("Alice");
    publish("alice", "screen_share");
    const w = await render();
    expect(w.find(".call-grid__main").exists()).toBe(true);
    expect(w.find(".call-grid__strip").exists()).toBe(false);
  });

  test("the main tile takes the shape of the picture and still fits the area", async () => {
    channelUsers("Alice", "Bob");
    publish("alice", "screen_share", { width: 2560, height: 1080 });
    const w = await render();

    const main = w.find(".call-grid__main .participant-card");
    expect(px(main, "width") / px(main, "height")).toBeCloseTo(2560 / 1080, 2);
    expect(px(main, "width")).toBeLessThanOrEqual(DESKTOP.main.width + 0.001);
    expect(px(main, "height")).toBeLessThanOrEqual(DESKTOP.main.height + 0.001);
  });

  test("a portrait share stays portrait", async () => {
    channelUsers("Alice", "Bob");
    publish("alice", "screen_share", { width: 1080, height: 1920 });
    const w = await render();
    const main = w.find(".call-grid__main .participant-card");
    expect(px(main, "width") / px(main, "height")).toBeCloseTo(1080 / 1920, 2);
    expect(px(main, "height")).toBeLessThanOrEqual(DESKTOP.main.height + 0.001);
  });

  test("the main tile is unsized until its area is measured, never a bare ratio", async () => {
    channelUsers("Alice", "Bob");
    publish("alice", "screen_share", { width: 3440, height: 1440 });
    measure({ strip: DESKTOP.strip });
    const w = await render();
    expect(styleOf(w.find(".call-grid__main .participant-card"))).toEqual({ width: "", height: "", aspectRatio: "" });
  });

  test("strip tiles are one row, solved from the strip's own box, with its own gap", async () => {
    channelUsers("Alice", "Bob", "Carol", "Dave");
    publish("alice", "screen_share");
    const w = await render();

    const strip = w.find(".call-grid__strip");
    expect((strip.element as HTMLElement).style.gap).toBe(`${STRIP_GAP}px`);
    const g = expectedStrip(3);
    expect(g.rows).toBe(1);
    for (const t of strip.findAll(".participant-card")) {
      expect(px(t, "width")).toBeCloseTo(g.tileWidth, 3);
      expect(px(t, "height")).toBeCloseTo(g.tileHeight, 3);
    }
  });

  test("a second sharer in the strip shows their screen, since that is the only picture they have", async () => {
    channelUsers("Alice", "Bob");
    publish("alice", "screen_share");
    const bobShare = publish("bob", "screen_share");
    const w = await render();
    const strip = w.find(".call-grid__strip");
    expect(bobShare.attach).toHaveBeenCalledWith(strip.find("video").element);
  });

  test("ending the share returns everyone to the grid", async () => {
    channelUsers("Alice", "Bob", "Carol");
    publish("alice", "screen_share", { width: 1920, height: 1080 });
    const w = await render();
    expect(w.find(".call-grid--stream").exists()).toBe(true);

    voice.videoTracks.delete("alice:screen_share");
    await nextTick();

    expect(w.find(".call-grid--stream").exists()).toBe(false);
    expect(tiles(w)).toHaveLength(3);
    for (const t of tiles(w)) expect(px(t, "width")).toBeCloseTo(expectedGrid(3).tileWidth, 3);
  });
});

// ── Pinning ──────────────────────────────────────────────────────────────────

describe("pinning", () => {
  test("clicking a grid tile makes it main, clicking another moves the pin, unpinning restores the grid", async () => {
    channelUsers("Alice", "Bob", "Carol");
    const w = await render();

    await tiles(w)[1].trigger("click");
    await nextTick();
    expect(w.find(".call-grid__main .participant-name").text()).toBe("Bob");
    expect(w.find(".call-grid__main .participant-card").classes()).toContain("participant-card--pinned");
    expect(w.find(".call-grid__strip").findAll(".participant-name").map((n) => n.text())).toEqual(["Alice", "Carol"]);

    // Strip tiles are clickable too: the pin follows.
    await w.find(".call-grid__strip .participant-card").trigger("click");
    await nextTick();
    expect(w.find(".call-grid__main .participant-name").text()).toBe("Alice");

    // Toggling the pinned person off (the card's own pin menu) restores the grid.
    const alice = w.findAllComponents({ name: "ParticipantCard" }).find((c) => c.props("userId") === "alice");
    alice?.vm.$emit("toggle-pin", "alice");
    await nextTick();
    expect(w.find(".call-grid--stream").exists()).toBe(false);
    expect(tiles(w)).toHaveLength(3);
  });

  test("a pin beats the automatic share-as-main", async () => {
    channelUsers("Alice", "Bob");
    publish("alice", "screen_share");
    const w = await render();
    expect(w.find(".call-grid__main .participant-name").text()).toBe("Alice");

    await w.find(".call-grid__strip .participant-card").trigger("click");
    await nextTick();
    expect(w.find(".call-grid__main .participant-name").text()).toBe("Bob");
    expect(w.find(".call-grid__strip .participant-name").text()).toBe("Alice");
  });
});

// ── Activities ───────────────────────────────────────────────────────────────

describe("activity tiles", () => {
  test("in the grid they are counted and sized like participant tiles", async () => {
    channelUsers("Alice", "Bob");
    const w = await render("channel", [activity("s1"), activity("s2")]);

    const acts = w.findAll(".stub-activity");
    expect(acts).toHaveLength(2);
    const g = expectedGrid(4);
    for (const el of [...tiles(w), ...acts]) {
      expect(px(el, "width")).toBeCloseTo(g.tileWidth, 3);
      expect(px(el, "height")).toBeCloseTo(g.tileHeight, 3);
    }
  });

  test("with a share up they move to the strip and are sized with it", async () => {
    channelUsers("Alice", "Bob");
    publish("alice", "screen_share");
    const w = await render("channel", [activity("s1")]);

    const strip = w.find(".call-grid__strip");
    expect(strip.findAll(".stub-activity")).toHaveLength(1);
    const g = expectedStrip(2);
    expect(px(strip.find(".stub-activity"), "width")).toBeCloseTo(g.tileWidth, 3);
    expect(px(strip.find(".participant-card"), "width")).toBeCloseTo(g.tileWidth, 3);
  });

  test("an activity alone with a solo sharer still produces a strip", async () => {
    channelUsers("Alice");
    publish("alice", "screen_share");
    const w = await render("channel", [activity("s1")]);
    const strip = w.find(".call-grid__strip");
    expect(strip.exists()).toBe(true);
    expect(strip.findAll(".participant-card")).toHaveLength(0);
    expect(strip.findAll(".stub-activity")).toHaveLength(1);
  });
});

// ── Direct calls ─────────────────────────────────────────────────────────────

describe("direct calls use the very same layout", () => {
  test("us and the peer come out exactly like two channel members in the same box", async () => {
    dmUsers("Peer");
    const dm = await render("dm");
    expect(names(dm)).toEqual(["Me", "Peer"]);
    const dmStyles = tiles(dm).map(styleOf);

    channelUsers("Me", "Peer");
    const ch = await render("channel");
    expect(tiles(ch).map(styleOf)).toEqual(dmStyles);
    expect(dmStyles[0].width).not.toBe("");
  });

  test("a group call goes through the solver like a channel would", async () => {
    dmUsers("Peer", "Other", "Third");
    const w = await render("dm");
    expect(tiles(w)).toHaveLength(4);
    for (const t of tiles(w)) expect(px(t, "width")).toBeCloseTo(expectedGrid(4).tileWidth, 3);
  });

  test("alone in the room before the peer joins: one solved tile, not a stretched box", async () => {
    dmUsers();
    measure({ grid: { width: 3000, height: 1600 } });
    const w = await render("dm");
    expect(names(w)).toEqual(["Me"]);
    expect(px(tiles(w)[0], "width")).toBe(MAX_TILE_WIDTH);
  });

  test("the peer joining adds their tile and re-solves ours", async () => {
    dmUsers();
    const w = await render("dm");
    expect(names(w)).toEqual(["Me"]);
    const alone = px(tiles(w)[0], "width");

    voice.participants.peer = { userId: "peer", displayName: "Peer", muted: false, mutedAll: false, screencast: false, volume: [100] };
    await nextTick();

    expect(names(w)).toEqual(["Me", "Peer"]);
    for (const t of tiles(w)) {
      expect(px(t, "width")).toBeCloseTo(expectedGrid(2).tileWidth, 3);
      expect(px(t, "width")).toBeLessThan(alone);
    }
  });

  test("the peer's share goes main, at its own shape, with us in the strip", async () => {
    dmUsers("Peer");
    publish("peer", "screen_share", { width: 3440, height: 1440 });
    const w = await render("dm");

    const main = w.find(".call-grid__main .participant-card");
    expect(main.find(".participant-name").text()).toBe("Peer");
    expect(px(main, "width") / px(main, "height")).toBeCloseTo(3440 / 1440, 2);
    expect(px(main, "width")).toBeLessThanOrEqual(DESKTOP.main.width + 0.001);
    expect(w.find(".call-grid__strip .participant-name").text()).toBe("Me");
  });

  test("our own share is main too", async () => {
    dmUsers("Peer");
    voice.isSharing = true;
    publish("me", "screen_share");
    const w = await render("dm");
    expect(w.find(".call-grid__main .participant-name").text()).toBe("Me");
    expect(w.find(".call-grid__main .streaming-badge").exists()).toBe(true);
  });
});

// ── Video attach / detach ────────────────────────────────────────────────────

describe("video elements are bound to their tracks for exactly as long as they exist", () => {
  test("a camera tile attaches its track to the element inside that tile", async () => {
    channelUsers("Alice", "Bob");
    const cam = publish("alice", "camera");
    const w = await render();

    const video = w.find("video");
    expect(cam.attach).toHaveBeenCalledTimes(1);
    expect(cam.attach).toHaveBeenCalledWith(video.element);
    const owner = video.element.closest(".participant-card")?.querySelector(".participant-name");
    expect(owner?.textContent?.trim()).toBe("Alice");
  });

  test("when the track leaves the store, the element is still detached from it", async () => {
    // The element unmounts *because* the track went away, so a lookup by key at that
    // point finds nothing and the element would stay in the track's attached list.
    channelUsers("Alice");
    const cam = publish("alice", "camera");
    const w = await render();
    const el = w.find("video").element;

    voice.videoTracks.delete("alice:camera");
    await nextTick();

    expect(w.find("video").exists()).toBe(false);
    expect(cam.detach).toHaveBeenCalledWith(el);
  });

  test("unmounting the grid detaches everything it attached", async () => {
    channelUsers("Alice", "Bob");
    const a = publish("alice", "camera");
    const b = publish("bob", "camera");
    const w = await render();
    const els = w.findAll("video").map((v) => v.element);
    expect(els).toHaveLength(2);

    w.unmount();

    expect(a.detach).toHaveBeenCalledTimes(1);
    expect(b.detach).toHaveBeenCalledTimes(1);
    const detached = [a.detach.mock.calls[0][0], b.detach.mock.calls[0][0]];
    expect(detached).toContain(els[0]);
    expect(detached).toContain(els[1]);
  });

  test("switching layouts re-binds the picture to the new element, and only once", async () => {
    channelUsers("Alice", "Bob");
    const cam = publish("alice", "camera");
    const w = await render();
    const gridEl = w.find("video").element;
    expect(cam.attach).toHaveBeenCalledTimes(1);

    // Pin Alice: her tile moves from the grid to the main slot, a different element.
    await tiles(w)[0].trigger("click");
    await nextTick();
    const mainEl = w.find(".call-grid__main video").element;

    expect(mainEl).not.toBe(gridEl);
    expect(cam.detach).toHaveBeenCalledWith(gridEl);
    expect(cam.attach).toHaveBeenLastCalledWith(mainEl);
    expect(cam.attach).toHaveBeenCalledTimes(2);
  });
});
