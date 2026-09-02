/**
 * @argon/calls standing on its own.
 *
 * The point of moving the call logic into a package: it can be built from a plain
 * object, with no pinia, no app stores and no module mocking beyond the SDK itself.
 * Compare with test/store/unifiedCallStore.test.ts, which reaches the same code through
 * fifteen mocked modules — that file now covers the wiring, this one covers behaviour.
 *
 * Note the `.value` accesses: createCallManager returns plain Vue refs. Components see
 * them unwrapped only because the pinia store in the app wraps this factory.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";

const rooms = vi.hoisted(() => ({ last: null as any }));

vi.mock("livekit-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-client")>();

  class FakeRoom {
    handlers = new Map<string, Function[]>();
    remoteParticipants = new Map<string, any>();
    canPlaybackAudio = true;
    canPlaybackVideo = true;
    engine = { client: { rtt: 8 } };
    disconnected = false;
    localParticipant: any = {
      identity: "me",
      isLocal: true,
      on: vi.fn(),
      publishTrack: vi.fn(async () => ({ once: vi.fn(), track: {} })),
      setAttributes: vi.fn(async () => {}),
      trackPublications: new Map(),
    };
    constructor(public options: any) { rooms.last = this; }
    on(e: string, cb: Function) { this.handlers.set(e, [...(this.handlers.get(e) ?? []), cb]); return this; }
    off() { return this; }
    removeAllListeners() { this.handlers.clear(); return this; }
    async connect() {}
    async prepareConnection() {}
    disconnect() { this.disconnected = true; }
    async startAudio() {}
    async startVideo() {}
    emit(e: string, ...a: unknown[]) { for (const cb of this.handlers.get(e) ?? []) cb(...a); }
  }

  class FakeLocalAudioTrack {
    source: unknown;
    isMuted = false;
    constructor(public mediaStreamTrack: unknown) {}
    async mute() { this.isMuted = true; }
    async unmute() { this.isMuted = false; }
  }

  return { ...actual, Room: FakeRoom, LocalAudioTrack: FakeLocalAudioTrack };
});

import { RoomEvent, Track, ConnectionQuality } from "livekit-client";
import { createCallManager, type CallManagerConfig } from "../src";

/** Enough of a MediaStreamTrack for LiveKit's real LocalVideoTrack to wrap it. */
function fakeTrack(kind: "video" | "audio" = "video"): MediaStreamTrack {
  return {
    id: `${kind}-1`,
    kind,
    label: kind,
    enabled: true,
    muted: false,
    readyState: "live",
    getConstraints: () => ({}),
    getSettings: () => ({ width: 1920, height: 1080, deviceId: "screen:1" }),
    getCapabilities: () => ({}),
    applyConstraints: async () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    clone() { return fakeTrack(kind); },
    stop() {},
  } as unknown as MediaStreamTrack;
}

/** A complete, honest config — every field the package declares it needs. */
function makeConfig(overrides: Partial<CallManagerConfig> = {}): CallManagerConfig {
  return {
    audio: {
      getCurrentAudioContext: () => ({ state: "running", resume: async () => {} }) as any,
      acquireInput: async () => ({ getAudioTracks: () => [{ clone: () => ({}) }] }) as any,
      releaseInput: vi.fn(),
      createRemoteAudioGraph: () => ({ setVolume() {}, dispose() {} }),
      createVirtualVUMeter: async () => ({ dispose() {} }),
      onAudioDeviceError: () => ({ unsubscribe() {} }) as any,
    },
    api: {
      callInteraction: {
        DingDongCreep: async () => null,
        PickUpCall: async () => null,
        RejectCall: async () => undefined,
      },
      channelInteraction: {
        Interlink: async () => ({
          isSuccessJoinVoice: () => true,
          token: "t",
          rtc: { endpoint: "wss://sfu.test", ices: [] } as any,
        }),
      },
      serverInteraction: { PrefetchUser: async () => null },
    },
    pool: {
      selectedServer: "space-1",
      getUser: async () => ({ displayName: "Someone" }),
      trackUser: async () => undefined,
      _realtimeStore: { addUserToChannel() {}, removeUserFromChannel() {} },
    },
    tone: {
      playRingSound() {}, stopPlayRingSound() {},
      playSoftEnterSound() {}, playSoftLeaveSound() {},
    },
    me: { me: { userId: "me" } },
    bus: { onServerEvent: () => ({ unsubscribe() {} }) },
    sys: {
      microphoneMuted: false,
      headphoneMuted: false,
      muteEvent: { subscribe: () => ({ unsubscribe() {} }) as any },
      muteHeadphoneEvent: { subscribe: () => ({ unsubscribe() {} }) as any },
    },
    userVolume: { getUserVolume: () => 100, setUserVolume() {} },
    realtimeStore: {
      getRealtimeChannel: () => null,
      addUserToChannel() {}, removeUserFromChannel() {}, setUserProperty() {},
    },
    pex: { has: () => true },
    preference: { adaptiveVideoQuality: true, defaultVideoDevice: "" },
    drawing: { beginStreamerSession() {}, endStreamerSession() {} },
    persistedValue: (_k, initial) => ref(initial),
    ensureMediaPermission: async () => undefined,
    consumeCrashRecovery: async () => false,
    selectScreenSource: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  rooms.last = null;
});

async function joined(config = makeConfig()) {
  const calls = createCallManager(config);
  await calls.joinVoiceChannel("chan-1");
  return { calls, room: rooms.last, config };
}

describe("the package builds from a plain config", () => {
  test("no pinia, no app stores, no module mocks beyond the SDK", async () => {
    const calls = createCallManager(makeConfig());
    expect(calls.isConnected.value).toBe(false);
    expect(calls.mode.value).toBe("none");
  });

  test("joining wires a room with the configured bandwidth settings", async () => {
    const { room } = await joined();
    expect(room.options.adaptiveStream).toEqual({ pixelDensity: "screen" });
    expect(room.options.publishDefaults.videoCodec).toBe("vp9");
  });

  test("a host that disables adaptive quality gets a plain room", async () => {
    const config = makeConfig({
      preference: { adaptiveVideoQuality: false, defaultVideoDevice: "" },
    });
    const { room } = await joined(config);
    expect(room.options.adaptiveStream).toBe(false);
    expect(room.options.dynacast).toBe(false);
  });
});

describe("host integration points are honoured", () => {
  test("permission to connect is asked of the host, and refusal is respected", async () => {
    const config = makeConfig({ pex: { has: () => false } });
    const calls = createCallManager(config);

    await calls.joinVoiceChannel("chan-1");

    expect(rooms.last).toBeNull();
    expect(calls.mode.value).toBe("none");
  });

  test("screen source selection goes through the host bridge, not window", async () => {
    // The package used to reach for window.argonIpc directly, which tied it to Electron.
    const { calls, config } = await joined();
    (globalThis.navigator as any).mediaDevices = {
      getDisplayMedia: async () => ({
        getVideoTracks: () => [fakeTrack()],
        getAudioTracks: () => [],
      }),
    };

    await calls.startScreenShare({ deviceId: "screen:1", systemAudio: "exclude" });

    expect(config.selectScreenSource).toHaveBeenCalledWith("screen:1", false);
  });

  test("the microphone hold is released back to the host on leave", async () => {
    const { calls, config } = await joined();
    await calls.leave();
    expect(config.audio.releaseInput).toHaveBeenCalled();
  });
});

describe("call behaviour survived the move", () => {
  test("per-participant quality is recorded", async () => {
    const { calls, room } = await joined();
    room.emit(RoomEvent.ConnectionQualityChanged, ConnectionQuality.Poor, { identity: "u1", isLocal: false });
    expect(calls.participantQuality.get("u1")).toBe(ConnectionQuality.Poor);
  });

  test("paused tiles are tracked by user and source", async () => {
    const { calls, room } = await joined();
    room.emit(
      RoomEvent.TrackStreamStateChanged,
      { kind: Track.Kind.Video, source: Track.Source.ScreenShare },
      Track.StreamState.Paused,
      { identity: "u1", isLocal: false },
    );

    // The old package keyed video state by user id alone, so a camera and a screen
    // share overwrote each other.
    expect(calls.isVideoPaused("u1", Track.Source.ScreenShare)).toBe(true);
    expect(calls.isVideoPaused("u1", Track.Source.Camera)).toBe(false);
  });

  test("leaving clears per-user state and disconnects the room", async () => {
    const { calls, room } = await joined();
    room.emit(RoomEvent.ConnectionQualityChanged, ConnectionQuality.Poor, { identity: "u1", isLocal: false });

    await calls.leave();

    expect(calls.participantQuality.size).toBe(0);
    expect(room.disconnected).toBe(true);
    expect(calls.room.value).toBeNull();
  });

  test("dispose releases the bus, and only dispose does", async () => {
    const unsubscribe = vi.fn();
    const config = makeConfig({
      bus: { onServerEvent: () => ({ unsubscribe }) },
    });

    const { calls } = await joined(config);
    await calls.leave();
    expect(unsubscribe).not.toHaveBeenCalled();

    await calls.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });

  test("incoming-call subscriptions outlive a completed call", async () => {
    // The old package put its server-event subscriptions in the same bag leave()
    // disposed, so the second call could never ring.
    const events = new Map<string, Function>();
    const config = makeConfig({
      bus: { onServerEvent: (e: string, h: any) => { events.set(e, h); return { unsubscribe() {} }; } },
    });

    const { calls } = await joined(config);
    await calls.leave();

    expect(events.has("CallIncoming")).toBe(true);
    events.get("CallIncoming")!({ callId: "c2", fromId: "u9" });
    expect(calls.incoming.value).toEqual({ callId: "c2", fromId: "u9" });
  });
});

describe("product metrics go through the host's telemetry sink", () => {
  const telemetry = () => ({ count: vi.fn(), distribution: vi.fn() });
  const named = (fn: ReturnType<typeof vi.fn>, name: string) =>
    fn.mock.calls.filter(([n]) => n === name);

  test("a successful join reports the join, how long it took and the room size", async () => {
    const t = telemetry();
    const { calls } = await joined(makeConfig({ telemetry: t }));

    expect(t.count).toHaveBeenCalledWith("call.join", { mode: "channel", result: "ok" });
    expect(t.distribution).toHaveBeenCalledWith("call.join.duration", expect.any(Number), "millisecond", { mode: "channel" });
    expect(t.distribution).toHaveBeenCalledWith("call.room.size", 1, "none", { mode: "channel" });

    await calls.leave();
  });

  test("leaving reports the call's duration exactly once, however often leave() runs", async () => {
    const t = telemetry();
    const { calls } = await joined(makeConfig({ telemetry: t }));

    await calls.leave();
    await calls.leave();

    const durations = named(t.distribution, "call.duration");
    expect(durations).toHaveLength(1);
    expect(durations[0][3]).toEqual({ mode: "channel", reason: "leave" });
    expect(t.count).toHaveBeenCalledWith("call.ended", expect.objectContaining({ mode: "channel", reason: "leave" }));
  });

  test("a drop the user did not ask for keeps its reason, and the leave() that follows does not count it again", async () => {
    const t = telemetry();
    const { calls, room } = await joined(makeConfig({ telemetry: t }));

    room.emit("disconnected", undefined);
    await calls.leave();

    expect(t.count).toHaveBeenCalledWith("call.disconnected", expect.objectContaining({ mode: "channel", reason: "unknown" }));
    expect(named(t.distribution, "call.duration")).toHaveLength(1);
    expect(named(t.count, "call.ended")).toHaveLength(1);
  });

  test("a refused join is reported with why, and a host without a sink is simply not reported to", async () => {
    const t = telemetry();
    const refused = createCallManager(makeConfig({ telemetry: t, pex: { has: () => false } }));
    await refused.joinVoiceChannel("chan-1");
    expect(t.count).toHaveBeenCalledWith("call.join", { mode: "channel", result: "refused", reason: "no_permission" });
    expect(named(t.distribution, "call.join.duration")).toHaveLength(0);

    // The config in makeConfig() carries no telemetry at all: nothing to assert on, only that
    // joining and leaving do not mind.
    const silent = createCallManager(makeConfig());
    await silent.joinVoiceChannel("chan-1");
    await silent.leave();
  });
});
