/**
 * The LiveKit integration in the call store.
 *
 * This is where every regression in the video work lived, and it was the least
 * reachable code: the event wiring only exists after a room is joined. So the real SDK
 * is loaded for its enums and only `Room` (plus the one track type the join path
 * constructs) is swapped for a fake we can drive. That keeps the assertions honest —
 * event names, `Track.StreamState`, `ConnectionQuality` and `VideoQuality` are the
 * library's own values, not strings copied into the test.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { ref } from "vue";

// ── The fake room ───────────────────────────────────────────────────

const rooms = vi.hoisted(() => ({ last: null as any, all: [] as any[] }));

vi.mock("livekit-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-client")>();

  class FakeRoom {
    options: any;
    handlers = new Map<string, Function[]>();
    remoteParticipants = new Map<string, any>();
    canPlaybackAudio = true;
    canPlaybackVideo = true;
    engine = { client: { rtt: 12 } };
    disconnected = false;
    localParticipant: any = {
      identity: "me",
      isLocal: true,
      on: vi.fn(),
      publishTrack: vi.fn(async () => ({ once: vi.fn(), track: {} })),
      setAttributes: vi.fn(async () => {}),
      trackPublications: new Map(),
    };

    constructor(options: any) {
      this.options = options;
      rooms.last = this;
      rooms.all.push(this);
    }

    on(event: string, cb: Function) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }
    off() { return this; }
    removeAllListeners() { this.handlers.clear(); return this; }
    async connect() {}
    async prepareConnection() {}
    disconnect() { this.disconnected = true; }
    async startAudio() {}
    async startVideo() {}

    /** Drive one of the handlers the store registered. */
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.handlers.get(event) ?? []) cb(...args);
    }
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

// ── Everything the store merely collaborates with ───────────────────

const deps = vi.hoisted(() => ({
  micMuted: false,
  headphoneMuted: false,
  interlink: null as any,
  // A real ref, not a plain getter: `adaptiveSettingPending` is a computed, and a
  // computed can only invalidate on something Vue can track.
  adaptive: null as any,
}));

vi.mock("@argon/storage", () => ({ persistedValue: (_k: string, d: unknown) => ref(d) }));
vi.mock("@argon/core", () => ({
  logger: { info() {}, warn() {}, error() {} },
  startTimer: () => () => {},
  DisposableBag: class {
    addSubscription() {}
    dispose() {}
    async asyncDispose() {}
  },
}));
vi.mock("@argon/glue", () => ({
  CallIncoming: class {},
  CallFinished: class {},
  CallAccepted: class {},
  RtcEndpoint: class {},
}));
vi.mock("@/lib/mediaPermissions", () => ({ ensureMediaPermission: async () => {} }));
vi.mock("@/lib/audio/AudioManager", () => ({
  audio: {
    getCurrentAudioContext: () => ({ state: "running", resume: async () => {} }),
    acquireInput: async () => ({ getAudioTracks: () => [{ clone: () => ({}) }] }),
    releaseInput: vi.fn(),
    createVirtualVUMeter: async () => ({ dispose() {} }),
    onAudioDeviceError: () => ({ unsubscribe() {} }),
    createRemoteAudioGraph: () => ({ setVolume() {}, dispose() {} }),
  },
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    channelInteraction: { Interlink: async () => deps.interlink },
    callInteraction: {},
    serverInteraction: {},
  }),
}));
vi.mock("@/store/data/poolStore", () => ({
  usePoolStore: () => ({
    selectedServer: "space-1",
    getUser: async () => ({ displayName: "Someone" }),
    _realtimeStore: { addUserToChannel() {}, removeUserFromChannel() {} },
  }),
}));
vi.mock("@/store/media/toneStore", () => ({
  useTone: () => ({
    playSoftEnterSound() {}, playSoftLeaveSound() {},
    playRingSound() {}, stopPlayRingSound() {},
  }),
}));
vi.mock("@/store/auth/meStore", () => ({ useMe: () => ({ me: { userId: "me" } }) }));
vi.mock("@/store/realtime/busStore", () => ({ useBus: () => ({ onServerEvent: () => ({}) }) }));
vi.mock("@/store/media/userVolumeStore", () => ({
  useUserVolumeStore: () => ({ getUserVolume: () => 100, setUserVolume() {} }),
}));
vi.mock("@/store/realtime/realtimeStore", () => ({
  useRealtimeStore: () => ({
    getRealtimeChannel: () => null,
    addUserToChannel() {}, removeUserFromChannel() {}, setUserProperty() {},
  }),
}));
vi.mock("@/store/system/systemStore", () => ({
  useSystemStore: () => ({
    get microphoneMuted() { return deps.micMuted; },
    get headphoneMuted() { return deps.headphoneMuted; },
    muteEvent: { subscribe: () => ({ unsubscribe() {} }) },
    muteHeadphoneEvent: { subscribe: () => ({ unsubscribe() {} }) },
  }),
}));
vi.mock("@/store/data/permissionStore", () => ({ usePexStore: () => ({ has: () => true }) }));
vi.mock("@/store/ui/preferenceStore", async () => {
  const { ref } = await import("vue");
  deps.adaptive = ref(true);
  return {
    usePreference: () => ({
      get adaptiveVideoQuality() { return deps.adaptive.value; },
      defaultVideoDevice: "",
    }),
  };
});
vi.mock("@/store/features/drawingSessionStore", () => ({
  useDrawingSession: () => ({ beginStreamerSession() {}, endStreamerSession() {} }),
}));

import { RoomEvent, Track, ConnectionQuality, SubscriptionError, VideoQuality } from "livekit-client";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";

// ── Helpers ─────────────────────────────────────────────────────────

const remote = (identity: string) => ({ identity, isLocal: false });

/** Join a channel so the store wires up its room handlers, and hand both back. */
async function joined() {
  const store = useUnifiedCall();
  await store.joinVoiceChannel("chan-1");
  return { store, room: rooms.last };
}

beforeEach(() => {
  setActivePinia(createPinia());
  rooms.last = null;
  rooms.all = [];
  deps.micMuted = false;
  deps.headphoneMuted = false;
  deps.adaptive.value = true;
  deps.interlink = {
    isSuccessJoinVoice: () => true,
    token: "t",
    rtc: { endpoint: "wss://sfu.test", ices: [] },
  };
});

// ── Tests ───────────────────────────────────────────────────────────

describe("room construction reflects the bandwidth decisions", () => {
  test("adaptive streaming and dynacast follow the preference", async () => {
    const { room } = await joined();
    expect(room.options.adaptiveStream).toEqual({ pixelDensity: "screen" });
    expect(room.options.dynacast).toBe(true);
  });

  test("turning the preference off disables both", async () => {
    deps.adaptive.value = false;
    const { room } = await joined();
    expect(room.options.adaptiveStream).toBe(false);
    expect(room.options.dynacast).toBe(false);
  });

  test("video publishes as vp9 with no fallback layer", async () => {
    const { room } = await joined();
    expect(room.options.publishDefaults.videoCodec).toBe("vp9");
    expect(room.options.publishDefaults.backupCodec).toBe(false);
  });

  test("a mid-call preference change is reported as pending, not silently ignored", async () => {
    const { store } = await joined();
    expect(store.adaptiveSettingPending).toBe(false);
    deps.adaptive.value = false;
    expect(store.adaptiveSettingPending).toBe(true);
  });
});

describe("adaptive stream pauses are surfaced per tile", () => {
  test("a paused video track marks its tile, and resuming clears it", async () => {
    const { store, room } = await joined();
    const pub = { kind: Track.Kind.Video, source: Track.Source.ScreenShare };

    room.emit(RoomEvent.TrackStreamStateChanged, pub, Track.StreamState.Paused, remote("u1"));
    expect(store.isVideoPaused("u1", Track.Source.ScreenShare)).toBe(true);

    room.emit(RoomEvent.TrackStreamStateChanged, pub, Track.StreamState.Active, remote("u1"));
    expect(store.isVideoPaused("u1", Track.Source.ScreenShare)).toBe(false);
  });

  test("audio stream state never marks a tile paused", async () => {
    const { store, room } = await joined();
    const pub = { kind: Track.Kind.Audio, source: Track.Source.Microphone };

    room.emit(RoomEvent.TrackStreamStateChanged, pub, Track.StreamState.Paused, remote("u1"));
    expect(store.pausedVideoTracks.size).toBe(0);
  });
});

describe("connection quality", () => {
  test("is recorded for every participant, not only ourselves", async () => {
    const { store, room } = await joined();

    room.emit(RoomEvent.ConnectionQualityChanged, ConnectionQuality.Poor, remote("u1"));
    room.emit(RoomEvent.ConnectionQualityChanged, ConnectionQuality.Excellent, room.localParticipant);

    expect(store.participantQuality.get("u1")).toBe(ConnectionQuality.Poor);
    expect(store.participantQuality.get("me")).toBe(ConnectionQuality.Excellent);
  });

  test("the indicator follows the server's report, not round-trip time", async () => {
    const { store, room } = await joined();

    for (const [reported, shown] of [
      [ConnectionQuality.Excellent, "GREEN"],
      [ConnectionQuality.Good, "ORANGE"],
      [ConnectionQuality.Poor, "RED"],
      [ConnectionQuality.Lost, "RED"],
    ] as const) {
      room.emit(RoomEvent.ConnectionQualityChanged, reported, room.localParticipant);
      expect(store.qualityConnection).toBe(shown);
    }
  });

  test("a remote participant's quality does not move our own indicator", async () => {
    const { store, room } = await joined();
    room.emit(RoomEvent.ConnectionQualityChanged, ConnectionQuality.Excellent, room.localParticipant);
    room.emit(RoomEvent.ConnectionQualityChanged, ConnectionQuality.Lost, remote("u1"));
    expect(store.qualityConnection).toBe("GREEN");
  });
});

describe("subscription failures are explained", () => {
  test("a refused track is recorded against the participant with a reason", async () => {
    const { store, room } = await joined();

    room.emit(RoomEvent.TrackSubscriptionFailed, "TR_1", remote("u1"), SubscriptionError.SE_CODEC_UNSUPPORTED);
    expect(store.subscriptionErrors.get("u1")).toContain("codec");
  });

  test("an unknown reason still says something", async () => {
    const { store, room } = await joined();
    room.emit(RoomEvent.TrackSubscriptionFailed, "TR_1", remote("u1"), undefined);
    expect(store.subscriptionErrors.get("u1")).toBeTruthy();
  });

  test("a later successful subscription clears the notice", async () => {
    const { store, room } = await joined();

    room.emit(RoomEvent.TrackSubscriptionFailed, "TR_1", remote("u1"), SubscriptionError.SE_CODEC_UNSUPPORTED);
    room.emit(RoomEvent.TrackSubscribed, {}, {}, remote("u1"));

    expect(store.subscriptionErrors.has("u1")).toBe(false);
  });
});

describe("blocked playback", () => {
  test("blocked audio raises the prompt", async () => {
    const { store, room } = await joined();
    room.canPlaybackAudio = false;
    room.emit(RoomEvent.AudioPlaybackStatusChanged, false);

    expect(store.audioPlaybackBlocked).toBe(true);
    expect(store.playbackBlocked).toBe(true);
  });

  test("blocked video raises the same prompt", async () => {
    const { store, room } = await joined();
    room.canPlaybackVideo = false;
    room.emit(RoomEvent.VideoPlaybackStatusChanged, false);

    expect(store.videoPlaybackBlocked).toBe(true);
    expect(store.playbackBlocked).toBe(true);
  });

  test("unblocking asks the room to start both and re-reads the result", async () => {
    const { store, room } = await joined();
    room.canPlaybackAudio = false;
    room.canPlaybackVideo = false;
    room.emit(RoomEvent.AudioPlaybackStatusChanged, false);
    room.emit(RoomEvent.VideoPlaybackStatusChanged, false);

    room.canPlaybackAudio = true;
    room.canPlaybackVideo = true;
    await store.unblockPlayback();

    expect(store.playbackBlocked).toBe(false);
  });
});

describe("per-tile receive controls", () => {
  const publication = () => ({ setEnabled: vi.fn(), setVideoQuality: vi.fn() });

  async function withPublication(source: Track.Source) {
    const { store, room } = await joined();
    const pub = publication();
    room.remoteParticipants.set("u1", { getTrackPublication: () => pub });
    return { store, pub };
  }

  test("hiding a tile tells the SFU to stop sending it", async () => {
    const { store, pub } = await withPublication(Track.Source.Camera);

    store.setVideoHidden("u1", Track.Source.Camera, true);
    expect(pub.setEnabled).toHaveBeenCalledWith(false);
    expect(store.isVideoHidden("u1", Track.Source.Camera)).toBe(true);

    store.setVideoHidden("u1", Track.Source.Camera, false);
    expect(pub.setEnabled).toHaveBeenLastCalledWith(true);
    expect(store.isVideoHidden("u1", Track.Source.Camera)).toBe(false);
  });

  test("a quality cap is passed through and remembered", async () => {
    const { store, pub } = await withPublication(Track.Source.Camera);

    store.setVideoQuality("u1", Track.Source.Camera, VideoQuality.LOW);
    expect(pub.setVideoQuality).toHaveBeenCalledWith(VideoQuality.LOW);
    expect(store.videoQualityOf("u1", Track.Source.Camera)).toBe(VideoQuality.LOW);
  });

  test("tiles default to full quality", async () => {
    const { store } = await joined();
    expect(store.videoQualityOf("u1", Track.Source.Camera)).toBe(VideoQuality.HIGH);
  });

  test("a participant who already left is a no-op, not a crash", async () => {
    const { store } = await joined();
    expect(() => store.setVideoHidden("ghost", Track.Source.Camera, true)).not.toThrow();
    expect(store.isVideoHidden("ghost", Track.Source.Camera)).toBe(false);
  });
});

describe("leaving a call lets go of everything", () => {
  /** Every per-user collection the store exposes. Adding one here is the point. */
  const collections = (s: any) => ({
    videoTracks: s.videoTracks,
    pausedVideoTracks: s.pausedVideoTracks,
    participantQuality: s.participantQuality,
    subscriptionErrors: s.subscriptionErrors,
    diagnostics: s.diagnostics,
    speaking: s.speaking,
  });

  test("no per-user state survives, and none is missed", async () => {
    const { store, room } = await joined();

    // Fill everything the store hands out, plus the two keyed differently.
    for (const [name, c] of Object.entries(collections(store))) {
      if (c instanceof Set) c.add("u1");
      else c.set("u1", { name });
    }
    store.participants["u1"] = { userId: "u1" } as never;
    room.remoteParticipants.set("u1", { getTrackPublication: () => ({ setEnabled: vi.fn(), setVideoQuality: vi.fn() }) });
    store.setVideoHidden("u1", Track.Source.Camera, true);

    // Guard against a vacuous pass — if the setup above stops filling things, say so.
    for (const [name, c] of Object.entries(collections(store))) {
      expect(c.size, `${name} was not populated, the test proves nothing`).toBeGreaterThan(0);
    }

    await store.leave();

    for (const [name, c] of Object.entries(collections(store))) {
      expect(c.size, `${name} still holds state after leave()`).toBe(0);
    }
    expect(Object.keys(store.participants)).toHaveLength(0);
    expect(store.isVideoHidden("u1", Track.Source.Camera)).toBe(false);
  });

  test("the room is disconnected and the microphone released", async () => {
    const { audio } = await import("@/lib/audio/AudioManager");
    const { store, room } = await joined();

    await store.leave();

    expect(room.disconnected).toBe(true);
    expect(audio.releaseInput).toHaveBeenCalled();
    expect(store.isConnected).toBe(false);
    expect(store.room).toBeNull();
  });

  test("quality and playback flags reset, so a new call starts clean", async () => {
    const { store, room } = await joined();
    room.emit(RoomEvent.ConnectionQualityChanged, ConnectionQuality.Lost, room.localParticipant);
    room.canPlaybackAudio = false;
    room.emit(RoomEvent.AudioPlaybackStatusChanged, false);

    await store.leave();

    expect(store.qualityConnection).toBe("NONE");
    expect(store.playbackBlocked).toBe(false);
  });
});
