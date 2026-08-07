/**
 * Participants, tracks and the local media controls.
 *
 * CallManager.test.ts covers construction and the host contract; this covers what
 * happens once people and tracks start arriving — the paths that actually run for the
 * whole length of a call.
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
    localParticipant: any = {
      identity: "me",
      isLocal: true,
      on: vi.fn(),
      publishTrack: vi.fn(async () => ({ once: vi.fn(), track: { id: "pub" } })),
      unpublishTrack: vi.fn(async () => {}),
      setAttributes: vi.fn(async () => {}),
      setCameraEnabled: vi.fn(async () => {}),
      setScreenShareEnabled: vi.fn(async () => {}),
      trackPublications: new Map(),
    };
    constructor(public options: any) { rooms.last = this; }
    on(e: string, cb: Function) { this.handlers.set(e, [...(this.handlers.get(e) ?? []), cb]); return this; }
    off() { return this; }
    removeAllListeners() { this.handlers.clear(); return this; }
    async connect() {}
    async prepareConnection() {}
    disconnect() {}
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

import { Track } from "livekit-client";
import { createCallManager, type CallManagerConfig } from "../src";

// ── Fakes ───────────────────────────────────────────────────────────

function fakeTrack(kind: "video" | "audio" = "video"): MediaStreamTrack {
  return {
    id: `${kind}-1`, kind, label: kind, enabled: true, muted: false, readyState: "live",
    getConstraints: () => ({}),
    getSettings: () => ({ width: 1920, height: 1080, deviceId: "screen:1" }),
    getCapabilities: () => ({}),
    applyConstraints: async () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    clone() { return fakeTrack(kind); },
    stop() {},
  } as unknown as MediaStreamTrack;
}

/** A remote participant with the surface addParticipant() touches. */
function remote(identity: string, attributes: Record<string, string> = {}) {
  const listeners = new Map<string, Function>();
  return {
    identity,
    isLocal: false,
    attributes,
    trackPublications: new Map(),
    getTrackPublications: () => [],
    getTrackPublication: () => undefined,
    setAudioContext: vi.fn(),
    on(event: string, cb: Function) { listeners.set(event, cb); return this; },
    /** Drive a listener the manager registered on this participant. */
    fire(event: string, ...args: unknown[]) { listeners.get(event)?.(...args); },
  };
}

const remoteTrack = (kind: Track.Kind, source: Track.Source) => ({
  kind,
  source,
  mediaStreamTrack: fakeTrack(kind === Track.Kind.Audio ? "audio" : "video"),
  detach: vi.fn(),
});

const graphs = vi.hoisted(() => ({ created: [] as any[] }));

function makeConfig(overrides: Partial<CallManagerConfig> = {}): CallManagerConfig {
  return {
    audio: {
      getCurrentAudioContext: () => ({ state: "running", resume: async () => {} }) as any,
      acquireInput: async () => ({ getAudioTracks: () => [{ clone: () => ({}) }] }) as any,
      releaseInput: vi.fn(),
      createRemoteAudioGraph: vi.fn((opts: any) => {
        const graph = { opts, setVolume: vi.fn(), dispose: vi.fn() };
        graphs.created.push(graph);
        return graph;
      }),
      createVirtualVUMeter: async () => ({ dispose() {} }),
      onAudioDeviceError: () => ({ unsubscribe() {} }) as any,
    },
    api: {
      callInteraction: {
        DingDongCreep: async () => ({
          isSuccessDingDong: () => true, callId: "call-1", token: "t",
          rtc: { endpoint: "wss://sfu.test", ices: [] } as any,
        }),
        PickUpCall: async () => ({
          isSuccessPickUp: () => true, callId: "call-1", token: "t",
          rtc: { endpoint: "wss://sfu.test", ices: [] } as any,
        }),
        RejectCall: vi.fn(async () => undefined),
      },
      channelInteraction: {
        Interlink: async () => ({
          isSuccessJoinVoice: () => true, token: "t",
          rtc: { endpoint: "wss://sfu.test", ices: [] } as any,
        }),
      },
      serverInteraction: { PrefetchUser: async () => null },
    },
    pool: {
      selectedServer: "space-1",
      getUser: async () => ({ displayName: "Someone" }),
      trackUser: async () => undefined,
      _realtimeStore: { addUserToChannel: vi.fn(), removeUserFromChannel: vi.fn() },
    },
    tone: {
      playRingSound: vi.fn(), stopPlayRingSound: vi.fn(),
      playSoftEnterSound: vi.fn(), playSoftLeaveSound: vi.fn(),
    },
    me: { me: { userId: "me" } },
    bus: { onServerEvent: () => ({ unsubscribe() {} }) },
    sys: {
      microphoneMuted: false, headphoneMuted: false,
      muteEvent: { subscribe: () => ({ unsubscribe() {} }) as any },
      muteHeadphoneEvent: { subscribe: () => ({ unsubscribe() {} }) as any },
    },
    userVolume: { getUserVolume: () => 80, setUserVolume: vi.fn() },
    realtimeStore: {
      getRealtimeChannel: () => null,
      addUserToChannel: vi.fn(), removeUserFromChannel: vi.fn(), setUserProperty: vi.fn(),
    },
    pex: { has: () => true },
    preference: { adaptiveVideoQuality: true, defaultVideoDevice: "" },
    drawing: { beginStreamerSession: vi.fn(), endStreamerSession: vi.fn() },
    persistedValue: (_k, initial) => ref(initial),
    ensureMediaPermission: async () => undefined,
    consumeCrashRecovery: async () => false,
    selectScreenSource: vi.fn(async () => {}),
    ...overrides,
  };
}

async function joined(config = makeConfig()) {
  const calls = createCallManager(config);
  await calls.joinVoiceChannel("chan-1");
  return { calls, room: rooms.last, config };
}

beforeEach(() => {
  rooms.last = null;
  graphs.created = [];
  (globalThis.navigator as any).mediaDevices = {
    getDisplayMedia: async () => ({
      getVideoTracks: () => [fakeTrack("video")],
      getAudioTracks: () => [fakeTrack("audio")],
    }),
  };
});

// ── Tests ───────────────────────────────────────────────────────────

describe("participants", () => {
  test("someone joining is added with their name and saved volume", async () => {
    const { calls, room } = await joined();

    room.emit("participantConnected", remote("u1"));
    await vi.waitFor(() => expect(calls.participants["u1"]).toBeDefined());

    expect(calls.participants["u1"].displayName).toBe("Someone");
    expect(calls.participants["u1"].volume).toEqual([80]);
  });

  test("their initial attributes are read, not assumed", async () => {
    const { calls, room } = await joined();

    room.emit("participantConnected", remote("u1", { isMutedAll: "true", isScreencast: "true" }));
    await vi.waitFor(() => expect(calls.participants["u1"]).toBeDefined());

    expect(calls.participants["u1"].mutedAll).toBe(true);
    expect(calls.participants["u1"].screencast).toBe(true);
  });

  test("attribute changes are tracked while they stay in the call", async () => {
    const { calls, room } = await joined();
    const p = remote("u1");

    room.emit("participantConnected", p);
    await vi.waitFor(() => expect(calls.participants["u1"]).toBeDefined());

    p.fire("attributesChanged", { isMutedAll: "true", isScreencast: "false" });
    expect(calls.participants["u1"].mutedAll).toBe(true);

    p.fire("attributesChanged", { isMutedAll: "false", isScreencast: "true", pfActivity: "{}" });
    expect(calls.participants["u1"].mutedAll).toBe(false);
    expect(calls.participants["u1"].screencast).toBe(true);
    expect(calls.participants["u1"].pfActivity).toBe("{}");
  });

  test("mute state follows their microphone", async () => {
    const { calls, room } = await joined();
    const p = remote("u1");

    room.emit("participantConnected", p);
    await vi.waitFor(() => expect(calls.participants["u1"]).toBeDefined());

    p.fire("trackMuted", { kind: Track.Kind.Audio });
    expect(calls.participants["u1"].muted).toBe(true);

    p.fire("trackUnmuted", { kind: Track.Kind.Audio });
    expect(calls.participants["u1"].muted).toBe(false);
  });

  test("a muted video track does not mark them as microphone-muted", async () => {
    const { calls, room } = await joined();
    const p = remote("u1");

    room.emit("participantConnected", p);
    await vi.waitFor(() => expect(calls.participants["u1"]).toBeDefined());

    p.fire("trackMuted", { kind: Track.Kind.Video });
    expect(calls.participants["u1"].muted).toBe(false);
  });

  test("leaving removes them and everything keyed to them", async () => {
    const { calls, room } = await joined();
    const p = remote("u1");

    room.emit("participantConnected", p);
    await vi.waitFor(() => expect(calls.participants["u1"]).toBeDefined());
    room.emit("trackSubscribed", remoteTrack(Track.Kind.Video, Track.Source.Camera), { isMuted: false, source: Track.Source.Camera }, p);

    room.emit("participantDisconnected", p);

    expect(calls.participants["u1"]).toBeUndefined();
    expect(calls.hasVideoTrack("u1")).toBe(false);
    expect(calls.participantQuality.has("u1")).toBe(false);
  });
});

describe("incoming tracks", () => {
  test("a camera track becomes a tile keyed by source", async () => {
    const { calls, room } = await joined();
    const p = remote("u1");

    room.emit("trackSubscribed", remoteTrack(Track.Kind.Video, Track.Source.Camera), { isMuted: false, source: Track.Source.Camera }, p);
    await vi.waitFor(() => expect(calls.hasVideoTrack("u1")).toBe(true));

    expect(calls.videoTracks.has("u1:camera")).toBe(true);
    expect(calls.getVideoTracksForUser("u1")).toHaveLength(1);
  });

  test("camera and screen share coexist instead of overwriting each other", async () => {
    const { calls, room } = await joined();
    const p = remote("u1");
    const pub = { isMuted: false, source: Track.Source.Camera };

    room.emit("trackSubscribed", remoteTrack(Track.Kind.Video, Track.Source.Camera), pub, p);
    room.emit("trackSubscribed", remoteTrack(Track.Kind.Video, Track.Source.ScreenShare), pub, p);
    await vi.waitFor(() => expect(calls.getVideoTracksForUser("u1")).toHaveLength(2));

    expect(calls.videoTracks.has("u1:camera")).toBe(true);
    expect(calls.videoTracks.has("u1:screen_share")).toBe(true);
  });

  test("microphone audio gets a playback graph", async () => {
    const { calls, room, config } = await joined();

    room.emit("trackSubscribed", remoteTrack(Track.Kind.Audio, Track.Source.Microphone), { isMuted: false, source: Track.Source.Microphone }, remote("u1"));
    await vi.waitFor(() => expect(config.audio.createRemoteAudioGraph).toHaveBeenCalled());

    expect(graphs.created).toHaveLength(1);
    expect(typeof graphs.created[0].opts.onSpeakingChange).toBe("function");
    expect(calls.participants["u1"].audioGraph).not.toBeNull();
  });

  test("screen-share audio gets its own graph with no speaking detection", async () => {
    // Desktop audio must never light the speaking ring.
    const { calls, room } = await joined();

    room.emit("trackSubscribed", remoteTrack(Track.Kind.Audio, Track.Source.ScreenShareAudio), { isMuted: false, source: Track.Source.ScreenShareAudio }, remote("u1"));
    await vi.waitFor(() => expect(graphs.created).toHaveLength(1));

    expect(graphs.created[0].opts.onSpeakingChange).toBeUndefined();
    expect(calls.participants["u1"].screenAudioGraph).not.toBeNull();
    expect(calls.participants["u1"].audioGraph).toBeNull();
  });

  test("a second audio track for the same person does not build a second graph", async () => {
    const { room } = await joined();
    const p = remote("u1");
    const pub = { isMuted: false, source: Track.Source.Microphone };

    room.emit("trackSubscribed", remoteTrack(Track.Kind.Audio, Track.Source.Microphone), pub, p);
    await vi.waitFor(() => expect(graphs.created).toHaveLength(1));
    room.emit("trackSubscribed", remoteTrack(Track.Kind.Audio, Track.Source.Microphone), pub, p);

    await new Promise((r) => setTimeout(r, 0));
    expect(graphs.created).toHaveLength(1);
  });

  test("unsubscribing disposes the graph and frees the slot for a re-subscribe", async () => {
    const { calls, room } = await joined();
    const p = remote("u1");
    const track = remoteTrack(Track.Kind.Audio, Track.Source.Microphone);
    const pub = { isMuted: false, source: Track.Source.Microphone };

    room.emit("trackSubscribed", track, pub, p);
    await vi.waitFor(() => expect(graphs.created).toHaveLength(1));

    room.emit("trackUnsubscribed", track, pub, p);

    expect(graphs.created[0].dispose).toHaveBeenCalled();
    expect(calls.participants["u1"].audioGraph).toBeNull();
    expect(track.detach).toHaveBeenCalled();
  });

  test("unsubscribing a video track clears its tile only", async () => {
    const { calls, room } = await joined();
    const p = remote("u1");
    const camera = remoteTrack(Track.Kind.Video, Track.Source.Camera);
    const share = remoteTrack(Track.Kind.Video, Track.Source.ScreenShare);

    room.emit("trackSubscribed", camera, { isMuted: false, source: Track.Source.Camera }, p);
    room.emit("trackSubscribed", share, { isMuted: false, source: Track.Source.ScreenShare }, p);
    await vi.waitFor(() => expect(calls.getVideoTracksForUser("u1")).toHaveLength(2));

    room.emit("trackUnsubscribed", camera, { isMuted: false, source: Track.Source.Camera }, p);

    expect(calls.videoTracks.has("u1:camera")).toBe(false);
    expect(calls.videoTracks.has("u1:screen_share")).toBe(true);
  });
});

describe("volume", () => {
  test("setting a volume drives the graph and is remembered", async () => {
    const { calls, room, config } = await joined();

    room.emit("trackSubscribed", remoteTrack(Track.Kind.Audio, Track.Source.Microphone), { isMuted: false, source: Track.Source.Microphone }, remote("u1"));
    await vi.waitFor(() => expect(graphs.created).toHaveLength(1));

    calls.setVolume("u1", 45);

    expect(graphs.created[0].setVolume).toHaveBeenCalledWith(45);
    expect(calls.participants["u1"].volume).toEqual([45]);
    expect(config.userVolume.setUserVolume).toHaveBeenCalledWith("u1", 45);
  });

  test("a deafen-driven change is applied but not persisted", async () => {
    const { calls, room, config } = await joined();

    room.emit("trackSubscribed", remoteTrack(Track.Kind.Audio, Track.Source.Microphone), { isMuted: false, source: Track.Source.Microphone }, remote("u1"));
    await vi.waitFor(() => expect(graphs.created).toHaveLength(1));

    calls.setVolume("u1", 0, true);

    expect(graphs.created[0].setVolume).toHaveBeenCalledWith(0);
    expect(config.userVolume.setUserVolume).not.toHaveBeenCalled();
  });

  test("screen-share audio follows the same slider as the voice", async () => {
    const { calls, room } = await joined();
    const p = remote("u1");

    room.emit("trackSubscribed", remoteTrack(Track.Kind.Audio, Track.Source.Microphone), { isMuted: false, source: Track.Source.Microphone }, p);
    room.emit("trackSubscribed", remoteTrack(Track.Kind.Audio, Track.Source.ScreenShareAudio), { isMuted: false, source: Track.Source.ScreenShareAudio }, p);
    await vi.waitFor(() => expect(graphs.created).toHaveLength(2));

    calls.setVolume("u1", 30);

    expect(graphs.created[0].setVolume).toHaveBeenCalledWith(30);
    expect(graphs.created[1].setVolume).toHaveBeenCalledWith(30);
  });

  test("an unknown participant is a no-op", async () => {
    const { calls } = await joined();
    expect(() => calls.setVolume("ghost", 50)).not.toThrow();
  });
});

describe("screen sharing", () => {
  test("starting a share publishes video and opens a drawing session", async () => {
    const { calls, room, config } = await joined();

    await calls.startScreenShare({ deviceId: "screen:1", systemAudio: "exclude" });

    expect(calls.isSharing.value).toBe(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
    expect(config.drawing.beginStreamerSession).toHaveBeenCalledWith("screen:1");
    expect(calls.videoTracks.has("me:screen_share")).toBe(true);
  });

  test("system audio is published as a second track when asked for", async () => {
    const { calls, room } = await joined();

    await calls.startScreenShare({ deviceId: "screen:1", systemAudio: "include" });

    expect(calls.systemAudioEnabled.value).toBe(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(3); // mic + video + system audio
  });

  test("stopping a share tears down the tile and the drawing session", async () => {
    const { calls, config } = await joined();
    await calls.startScreenShare({ deviceId: "screen:1", systemAudio: "include" });

    await calls.stopScreenShare();

    expect(calls.isSharing.value).toBe(false);
    expect(calls.videoTracks.has("me:screen_share")).toBe(false);
    expect(config.drawing.endStreamerSession).toHaveBeenCalled();
  });

  test("turning system audio off mid-share unpublishes it without touching the video", async () => {
    const { calls, room } = await joined();
    await calls.startScreenShare({ deviceId: "screen:1", systemAudio: "include" });

    await calls.toggleSystemAudio();

    expect(calls.systemAudioEnabled.value).toBe(false);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalled();
    expect(calls.isSharing.value).toBe(true);
  });

  test("outside a share the toggle only records the preference", async () => {
    const { calls, room } = await joined();

    await calls.toggleSystemAudio();

    expect(calls.systemAudioEnabled.value).toBe(true);
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
  });
});

describe("camera", () => {
  beforeEach(() => {
    (globalThis.navigator as any).mediaDevices.getUserMedia = async () => ({
      getVideoTracks: () => [fakeTrack("video")],
      getAudioTracks: () => [],
      getTracks: () => [fakeTrack("video")],
    });
  });

  test("toggling on publishes a camera tile for ourselves", async () => {
    const { calls } = await joined();

    await calls.startCamera("cam-1");

    expect(calls.isCameraOn.value).toBe(true);
    expect(calls.videoTracks.has("me:camera")).toBe(true);
  });

  test("toggling off removes it", async () => {
    const { calls } = await joined();
    await calls.startCamera("cam-1");

    await calls.stopCamera();

    expect(calls.isCameraOn.value).toBe(false);
    expect(calls.videoTracks.has("me:camera")).toBe(false);
  });

  test("starting twice does not publish twice", async () => {
    const { calls, room } = await joined();
    await calls.startCamera("cam-1");
    const after = room.localParticipant.publishTrack.mock.calls.length;

    await calls.startCamera("cam-1");

    expect(room.localParticipant.publishTrack.mock.calls.length).toBe(after);
  });

  test("switching devices remembers the choice for next time", async () => {
    const { calls, config } = await joined();

    await calls.switchCamera("cam-2");

    expect(config.preference.defaultVideoDevice).toBe("cam-2");
  });
});

describe("direct calls", () => {
  test("starting one joins a room and remembers who it is with", async () => {
    const calls = createCallManager(makeConfig());

    await calls.startDirectCall("peer-1");

    expect(calls.mode.value).toBe("dm");
    expect(calls.targetId.value).toBe("peer-1");
    expect(rooms.last).not.toBeNull();
  });

  test("an incoming call rings and can be accepted", async () => {
    const config = makeConfig();
    const calls = createCallManager(config);
    calls.incoming.value = { callId: "call-9", fromId: "peer-9" } as any;

    await calls.acceptIncomingCall();

    expect(config.tone.stopPlayRingSound).toHaveBeenCalled();
    expect(calls.incoming.value).toBeNull();
    expect(calls.mode.value).toBe("dm");
    expect(calls.targetId.value).toBe("peer-9");
  });

  test("rejecting tells the server and stops the ring", async () => {
    const config = makeConfig();
    const calls = createCallManager(config);
    calls.incoming.value = { callId: "call-9", fromId: "peer-9" } as any;

    await calls.rejectIncomingCall();

    expect(config.api.callInteraction.RejectCall).toHaveBeenCalledWith("call-9");
    expect(config.tone.stopPlayRingSound).toHaveBeenCalled();
    expect(calls.incoming.value).toBeNull();
  });

  test("rejecting with nothing ringing is harmless", async () => {
    const config = makeConfig();
    const calls = createCallManager(config);

    await calls.rejectIncomingCall();

    expect(config.api.callInteraction.RejectCall).not.toHaveBeenCalled();
  });
});
