/**
 * The radio: broadcasting from a broadcast channel, and hearing one in a target.
 *
 * Both LiveKit rooms are fakes handed in through `createRoom`, so the SDK is never connected.
 * The broadcaster's side is driven by the links the server answers and the key; the listener's
 * by a `bc:*` participant arriving in the room with an audio track.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";

vi.mock("livekit-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-client")>();

  class FakeLocalAudioTrack {
    source: unknown;
    isMuted = false;
    constructor(public mediaStreamTrack: unknown) {}
    async mute() { this.isMuted = true; }
    async unmute() { this.isMuted = false; }
  }

  return { ...actual, LocalAudioTrack: FakeLocalAudioTrack };
});

import { DisconnectReason, RoomEvent, Track } from "livekit-client";
import { createCallManager, createMicHold, VoiceStateBits, RADIO_ATTR, type CallManagerConfig } from "../src";

// ── Fakes ───────────────────────────────────────────────────────────

class FakeRoom {
  handlers = new Map<string, Function[]>();
  remoteParticipants = new Map<string, any>();
  canPlaybackAudio = true;
  canPlaybackVideo = true;
  engine = { client: { rtt: 8 } };
  disconnected = false;
  connectOptions: any[] = [];
  published: any[] = [];
  localParticipant: any;

  constructor(public options: any, public purpose: "call" | "radio") {
    const attributes: Record<string, string> = {};
    this.localParticipant = {
      identity: purpose === "radio" ? "bc:me" : "me",
      isLocal: true,
      permissions: undefined,
      attributes,
      on: vi.fn(),
      publishTrack: vi.fn(async (track: any) => {
        this.published.push(track);
        return { once: vi.fn(), track };
      }),
      setAttributes: vi.fn(async (a: Record<string, string>) => { Object.assign(attributes, a); }),
      trackPublications: new Map(),
    };
  }
  on(e: string, cb: Function) { this.handlers.set(e, [...(this.handlers.get(e) ?? []), cb]); return this; }
  off() { return this; }
  removeAllListeners() { this.handlers.clear(); return this; }
  async connect(_url: string, _token: string, opts: unknown) { this.connectOptions.push(opts); }
  async prepareConnection() {}
  disconnect() { this.disconnected = true; }
  async startAudio() {}
  async startVideo() {}
  emit(e: string, ...a: unknown[]) { for (const cb of this.handlers.get(e) ?? []) cb(...a); }
}

const rooms = { call: null as FakeRoom | null, radio: null as FakeRoom | null, radios: [] as FakeRoom[] };

/** A remote participant with the surface the manager touches. */
function remote(identity: string, attributes: Record<string, string> = {}) {
  const listeners = new Map<string, Function>();
  return {
    identity,
    isLocal: false,
    attributes,
    name: undefined,
    metadata: undefined,
    trackPublications: new Map(),
    getTrackPublications: () => [],
    getTrackPublication: () => undefined,
    setAudioContext: vi.fn(),
    on(event: string, cb: Function) { listeners.set(event, cb); return this; },
  };
}

const audioTrack = () => ({
  kind: Track.Kind.Audio,
  source: Track.Source.Microphone,
  mediaStreamTrack: { id: "t", kind: "audio" },
  detach: vi.fn(),
});

const BUS = { kind: "bus" };
const MASTER = { kind: "master" };

const broadcastSettings = (over: Partial<Record<string, unknown>> = {}) => ({
  targets: [],
  overlap: 0,
  duckingDb: -6,
  maxTransmitSeconds: 120,
  chirp: false,
  ...over,
});

const linksOk = (settings = broadcastSettings()) => ({
  isSuccessBroadcastLinks: () => true,
  isFailedBroadcastLinks: () => false,
  rtc: { endpoint: "wss://sfu.test", ices: [] },
  token: "radio-token",
  identity: "bc:me",
  room: "radio/space-1/hq",
  settings,
});
const linksFailed = (error: number) => ({
  isSuccessBroadcastLinks: () => false,
  isFailedBroadcastLinks: () => true,
  error,
});
const confirmOk = () => ({
  isSuccessConfirmBroadcastLinks: () => true,
  isFailedConfirmBroadcastLinks: () => false,
  forwardedTargets: 2,
});
const confirmFailed = (error: number) => ({
  isSuccessConfirmBroadcastLinks: () => false,
  isFailedConfirmBroadcastLinks: () => true,
  error,
});

type Handler = (ev: any) => void;

function makeBus() {
  const handlers = new Map<string, Handler[]>();
  const reconnected: Array<() => void> = [];
  const fullResync: Array<() => void> = [];
  return {
    onServerEvent: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return { unsubscribe() {} };
    },
    onReconnected: (handler: () => void) => {
      reconnected.push(handler);
      return { unsubscribe() {} };
    },
    onFullResync: (handler: () => void) => {
      fullResync.push(handler);
      return { unsubscribe() {} };
    },
    fire: (event: string, payload: unknown) => {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    reconnect: () => { for (const h of reconnected) h(); },
    resync: () => { for (const h of fullResync) h(); },
  };
}

function makeSetup(over: {
  broadcast?: ReturnType<typeof broadcastSettings> | null;
  grants?: string[];
  delayMs?: number;
} = {}) {
  const bus = makeBus();
  const grants = new Set(over.grants ?? ["Connect", "Speak", "Broadcast"]);
  const channels: Record<string, any> = {
    hq: { Channel: { spaceId: "space-1", broadcast: over.broadcast === undefined ? broadcastSettings() : over.broadcast }, Users: new Map() },
    party: { Channel: { spaceId: "space-1", broadcast: null }, Users: new Map() },
  };
  const graphs: any[] = [];
  const deafenHandlers: Array<(muted: boolean) => void> = [];
  const sys = {
    microphoneMuted: false,
    headphoneMuted: false,
    muteEvent: { subscribe: () => ({ unsubscribe() {} }) as any },
    muteHeadphoneEvent: {
      subscribe: (fn: (muted: boolean) => void) => { deafenHandlers.push(fn); return { unsubscribe() {} } as any; },
    },
    setServerVoiceRestriction: vi.fn(),
    setMicrophoneMuted: vi.fn(async (muted: boolean) => { sys.microphoneMuted = muted; }),
  };
  const telemetry = { count: vi.fn(), distribution: vi.fn() };
  const config: CallManagerConfig = {
    audio: {
      getCurrentAudioContext: () => ({ state: "running", resume: async () => {} }) as any,
      acquireInput: async () => ({ getAudioTracks: () => [{ clone: () => ({ stop() {} }) }] }) as any,
      releaseInput: vi.fn(),
      createRemoteAudioGraph: vi.fn((opts: any) => {
        const graph = { opts, setVolume: vi.fn(), dispose: vi.fn() };
        graphs.push(graph);
        return graph;
      }),
      createVirtualVUMeter: async () => ({ dispose() {} }),
      onAudioDeviceError: () => ({ unsubscribe() {} }) as any,
      getVoiceBus: () => BUS as any,
      setVoiceBusGain: vi.fn(),
      getOutputDestination: () => MASTER as any,
    },
    api: {
      callInteraction: {
        DingDongCreep: async () => null,
        PickUpCall: async () => null,
        RejectCall: async () => undefined,
      },
      channelInteraction: {
        Interlink: vi.fn(async () => ({
          isSuccessJoinVoice: () => true,
          isFailedJoinVoice: () => false,
          token: "t",
          rtc: { endpoint: "wss://sfu.test", ices: [] },
        })) as any,
        UpdateVoiceState: vi.fn(async () => undefined),
        GetBroadcastLinks: vi.fn(async () => linksOk()) as any,
        ConfirmBroadcastLinks: vi.fn(async () => confirmOk()) as any,
      },
      serverInteraction: { PrefetchUser: async () => null },
    },
    pool: {
      selectedServer: "space-1",
      getUser: async () => ({ displayName: "Someone" }),
      getChannel: async (id: string) => channels[id]?.Channel ?? null,
      trackUser: async () => undefined,
      _realtimeStore: { addUserToChannel() {}, removeUserFromChannel() {} },
    },
    tone: {
      playRingSound: vi.fn(), stopPlayRingSound: vi.fn(),
      playSoftEnterSound: vi.fn(), playSoftLeaveSound: vi.fn(),
      playRadioError: vi.fn(), playRadioChirp: vi.fn(),
    },
    me: { me: { userId: "me" } },
    bus,
    sys,
    userVolume: { getUserVolume: () => 100, setUserVolume() {} },
    realtimeStore: {
      getRealtimeChannel: (id: string) => channels[id] ?? null,
      addUserToChannel: vi.fn(), removeUserFromChannel: vi.fn(), setUserProperty() {},
    },
    pex: { has: (p: string) => grants.has(p), hasIn: (_c: string, p: string) => grants.has(p) },
    preference: { adaptiveVideoQuality: true, defaultVideoDevice: "" },
    drawing: { beginStreamerSession() {}, endStreamerSession() {} },
    persistedValue: (_k, initial) => ref(initial),
    ensureMediaPermission: async () => undefined,
    consumeCrashRecovery: async () => false,
    selectScreenSource: async () => {},
    notify: vi.fn(),
    telemetry,
    createRoom: (options, purpose) => {
      const room = new FakeRoom(options, purpose);
      if (purpose === "radio") {
        rooms.radio = room;
        rooms.radios.push(room);
      } else {
        rooms.call = room;
      }
      return room as any;
    },
    pttReleaseDelayMs: () => over.delayMs ?? 0,
  };
  return { config, bus, grants, channels, graphs, sys, telemetry, deafenHandlers };
}

type Setup = ReturnType<typeof makeSetup>;

const links = (s: Setup) => s.config.api.channelInteraction.GetBroadcastLinks as ReturnType<typeof vi.fn>;
const confirm = (s: Setup) => s.config.api.channelInteraction.ConfirmBroadcastLinks as ReturnType<typeof vi.fn>;
const tone = (s: Setup) => s.config.tone as unknown as Record<string, ReturnType<typeof vi.fn>>;
const audioOf = (s: Setup) => s.config.audio as unknown as { setVoiceBusGain: ReturnType<typeof vi.fn> };
const radioTrack = () => rooms.radio!.published[0];
const settle = () => new Promise((r) => setTimeout(r, 0));
/** `settle` for tests on fake timers, where a real setTimeout never fires. */
const flush = () => vi.advanceTimersByTimeAsync(0);

async function joined(setup = makeSetup(), channelId = "hq") {
  const calls = createCallManager(setup.config);
  await calls.joinVoiceChannel(channelId);
  return { calls, ...setup };
}

/** Join HQ and wait for the radio to come up. */
async function onAir(setup = makeSetup()) {
  const j = await joined(setup);
  await vi.waitFor(() => expect(j.calls.radio.value.available).toBe(true));
  return j;
}

const selfState = (state: number) => ({ spaceId: "space-1", channelId: "hq", userId: "me", state });

beforeEach(() => {
  rooms.call = null;
  rooms.radio = null;
  rooms.radios = [];
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Links ───────────────────────────────────────────────────────────

describe("the radio links", () => {
  test("are fetched, connected and confirmed after joining a broadcast channel with the right", async () => {
    const { calls, telemetry, ...s } = await onAir();

    expect(links(s as Setup)).toHaveBeenCalledWith("space-1", "hq");
    expect(rooms.radio).not.toBeNull();
    expect(rooms.radio!.connectOptions[0]).toMatchObject({ autoSubscribe: false });
    expect(rooms.radio!.options.webAudioMix).toBeTruthy();
    // The microphone is published muted: nothing reaches the targets until the key.
    expect(radioTrack().source).toBe(Track.Source.Microphone);
    expect(radioTrack().isMuted).toBe(true);
    expect(rooms.radio!.localParticipant.publishTrack.mock.calls[0][1]).toMatchObject({ red: true, forceStereo: false });
    expect(confirm(s as Setup)).toHaveBeenCalledWith("space-1", "hq");
    expect(calls.radio.value).toMatchObject({ available: true, connecting: false, unavailableReason: null });
    expect(calls.radio.value.settings).toEqual(broadcastSettings());
    expect(telemetry.count).toHaveBeenCalledWith("call.radio.links", { result: "ok" });
  });

  test("are not asked for without the Broadcast right", async () => {
    const setup = makeSetup({ grants: ["Connect", "Speak"] });
    const { calls } = await joined(setup);
    await settle();
    await settle();

    expect(links(setup)).not.toHaveBeenCalled();
    expect(rooms.radio).toBeNull();
    expect(calls.radio.value.unavailableReason).toBe("insufficient_permissions");
  });

  test("are not asked for in an ordinary voice channel", async () => {
    const setup = makeSetup({ broadcast: null });
    const { calls } = await joined(setup);
    await settle();
    await settle();

    expect(links(setup)).not.toHaveBeenCalled();
    expect(calls.radio.value).toMatchObject({ available: false, connecting: false, unavailableReason: null });
  });

  test("a refusal sets the reason and opens no room", async () => {
    const setup = makeSetup();
    links(setup).mockResolvedValueOnce(linksFailed(4));
    const { calls, telemetry } = await joined(setup);

    await vi.waitFor(() => expect(calls.radio.value.unavailableReason).toBe("server_restricted"));
    expect(calls.radio.value.available).toBe(false);
    expect(calls.radio.value.connecting).toBe(false);
    expect(rooms.radio).toBeNull();
    expect(telemetry.count).toHaveBeenCalledWith("call.radio.links", { result: "failed", error: "server_restricted" });
  });

  test("a confirm that finds us not in the channel is retried once after a second", async () => {
    vi.useFakeTimers();
    const setup = makeSetup();
    confirm(setup).mockResolvedValueOnce(confirmFailed(1));
    const { calls } = await joined(setup);

    await vi.waitFor(() => expect(confirm(setup)).toHaveBeenCalledTimes(1));
    expect(calls.radio.value.available).toBe(false);
    expect(calls.radio.value.connecting).toBe(true);
    expect(rooms.radios[0].disconnected).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(calls.radio.value.available).toBe(true));
    expect(links(setup)).toHaveBeenCalledTimes(2);
    expect(rooms.radios).toHaveLength(2);
  });

  test("every reconnect of the radio room confirms the forward again", async () => {
    const s = await onAir();
    rooms.radio!.emit(RoomEvent.Reconnected);
    await vi.waitFor(() => expect(confirm(s as Setup)).toHaveBeenCalledTimes(2));
    expect(rooms.radios).toHaveLength(1);
  });

  test("a radio room that drops while we stay in HQ is fetched again with backoff", async () => {
    vi.useFakeTimers();
    const s = await onAir();

    rooms.radio!.emit(RoomEvent.Disconnected, DisconnectReason.SIGNAL_CLOSE);
    expect(s.calls.radio.value.available).toBe(false);
    expect(s.calls.radio.value.connecting).toBe(true);
    expect(links(s as Setup)).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(links(s as Setup)).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(s.calls.radio.value.available).toBe(true));
  });

  test("a realtime reconnect only re-confirms a working radio, once for both signals", async () => {
    vi.useFakeTimers();
    const s = await onAir();
    s.bus.reconnect();
    s.bus.resync();
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() => expect(confirm(s as Setup)).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(300);
    expect(confirm(s as Setup)).toHaveBeenCalledTimes(2);
    expect(links(s as Setup)).toHaveBeenCalledTimes(1);
  });

  test("a resync while the links are being fetched does not restart the connect", async () => {
    vi.useFakeTimers();
    const setup = makeSetup();
    let finish: (v: unknown) => void = () => {};
    confirm(setup).mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const { calls, bus } = await joined(setup);
    await vi.waitFor(() => expect(confirm(setup)).toHaveBeenCalledTimes(1));

    bus.resync();
    await vi.advanceTimersByTimeAsync(300);
    expect(links(setup)).toHaveBeenCalledTimes(1);

    finish(confirmOk());
    await vi.waitFor(() => expect(calls.radio.value.available).toBe(true));
    expect(rooms.radios).toHaveLength(1);
  });

  test("a change to another channel is not ours", async () => {
    const s = await onAir();
    s.bus.fire("ChannelModifiedV2", { spaceId: "space-1", channelId: "party", patch: { broadcast: null } });
    expect(s.calls.radio.value.available).toBe(true);
    expect(rooms.radio!.disconnected).toBe(false);
  });

  test("the channel's broadcast settings changing under us", async () => {
    const s = await onAir();
    const updated = broadcastSettings({ overlap: 1, maxTransmitSeconds: null });

    s.bus.fire("ChannelModifiedV2", { spaceId: "space-1", channelId: "hq", patch: { broadcast: updated } });
    expect(s.calls.radio.value.settings).toEqual(updated);
    expect(links(s as Setup)).toHaveBeenCalledTimes(1);

    s.bus.fire("ChannelModifiedV2", { spaceId: "space-1", channelId: "hq", patch: { name: "renamed" } });
    expect(s.calls.radio.value.available).toBe(true);

    s.bus.fire("ChannelModifiedV2", { spaceId: "space-1", channelId: "hq", patch: { broadcast: null } });
    expect(s.calls.radio.value.available).toBe(false);
    expect(rooms.radio!.disconnected).toBe(true);
  });

  test("mode switched on while we are in the channel", async () => {
    const setup = makeSetup({ broadcast: null });
    const { calls, bus } = await joined(setup);
    await settle();
    expect(links(setup)).not.toHaveBeenCalled();

    bus.fire("ChannelModifiedV2", { spaceId: "space-1", channelId: "hq", patch: { broadcast: broadcastSettings() } });
    await vi.waitFor(() => expect(calls.radio.value.available).toBe(true));
  });
});

// ── The key ─────────────────────────────────────────────────────────

describe("the radio key", () => {
  test("key down unmutes the radio track, flags the HQ participant and opens the mic once", async () => {
    const s = await onAir();
    s.sys.microphoneMuted = true;

    s.calls.radioKeyDown();

    expect(s.calls.radio.value.transmitting).toBe(true);
    expect(radioTrack().isMuted).toBe(false);
    await vi.waitFor(() => expect(rooms.call!.localParticipant.attributes[RADIO_ATTR.onAir]).toBe("on"));
    expect(s.sys.setMicrophoneMuted).toHaveBeenCalledTimes(1);
    expect(s.sys.setMicrophoneMuted).toHaveBeenCalledWith(false, { silent: true });
    expect(s.telemetry.count).toHaveBeenCalledWith("call.radio.transmit");

    // Held: a second key-down changes nothing.
    s.calls.radioKeyDown();
    expect(s.sys.setMicrophoneMuted).toHaveBeenCalledTimes(1);
  });

  test("key up waits out the release delay, then puts everything back", async () => {
    const setup = makeSetup({ delayMs: 300 });
    const s = await onAir(setup);
    vi.useFakeTimers();
    s.sys.microphoneMuted = true;

    s.calls.radioKeyDown();
    s.calls.radioKeyUp();
    expect(s.calls.radio.value.transmitting).toBe(true);
    expect(radioTrack().isMuted).toBe(false);

    await vi.advanceTimersByTimeAsync(300);
    expect(s.calls.radio.value.transmitting).toBe(false);
    expect(radioTrack().isMuted).toBe(true);
    expect(s.sys.setMicrophoneMuted).toHaveBeenLastCalledWith(true, { silent: true });
    await vi.waitFor(() => expect(rooms.call!.localParticipant.attributes[RADIO_ATTR.onAir]).toBe("off"));
    expect(s.telemetry.distribution).toHaveBeenCalledWith("call.radio.transmit_ms", expect.any(Number), "millisecond");
  });

  test("a press inside the release delay keeps the transmission going", async () => {
    const setup = makeSetup({ delayMs: 500 });
    const s = await onAir(setup);
    vi.useFakeTimers();

    s.calls.radioKeyDown();
    s.calls.radioKeyUp();
    await vi.advanceTimersByTimeAsync(300);
    s.calls.radioKeyDown();
    await vi.advanceTimersByTimeAsync(400);

    expect(s.calls.radio.value.transmitting).toBe(true);
    expect(s.telemetry.count.mock.calls.filter(([n]) => n === "call.radio.transmit")).toHaveLength(1);
  });

  test("a key-down right after a key-up is a bounce", async () => {
    const s = await onAir();
    vi.useFakeTimers();

    s.calls.radioKeyDown();
    s.calls.radioKeyUp();
    expect(s.calls.radio.value.transmitting).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    s.calls.radioKeyDown();
    expect(s.calls.radio.value.transmitting).toBe(false);

    await vi.advanceTimersByTimeAsync(200);
    s.calls.radioKeyDown();
    expect(s.calls.radio.value.transmitting).toBe(true);
  });

  test("a press inside the release delay is never a bounce, and the later key-up still counts", async () => {
    const setup = makeSetup({ delayMs: 500 });
    const s = await onAir(setup);
    vi.useFakeTimers();

    s.calls.radioKeyDown();
    s.calls.radioKeyUp();
    await vi.advanceTimersByTimeAsync(100);
    s.calls.radioKeyDown();
    await vi.advanceTimersByTimeAsync(600);
    expect(s.calls.radio.value.transmitting).toBe(true);
    expect(radioTrack().isMuted).toBe(false);

    s.calls.radioKeyUp();
    await vi.advanceTimersByTimeAsync(500);
    expect(s.calls.radio.value.transmitting).toBe(false);
    expect(radioTrack().isMuted).toBe(true);
  });

  test("the stuck-key guard releases at the channel's limit", async () => {
    const setup = makeSetup();
    links(setup).mockResolvedValue(linksOk(broadcastSettings({ maxTransmitSeconds: 2 })));
    const s = await onAir(setup);
    vi.useFakeTimers();

    s.calls.radioKeyDown();
    await vi.advanceTimersByTimeAsync(1999);
    expect(s.calls.radio.value.transmitting).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.calls.radio.value.transmitting).toBe(false);
    expect(radioTrack().isMuted).toBe(true);
    expect(s.config.notify).toHaveBeenCalledWith({ kind: "radio_max_transmit" });

    // The physical key is still down: releasing it is not a second release.
    s.calls.radioKeyUp();
    expect(s.telemetry.distribution.mock.calls.filter(([n]) => n === "call.radio.transmit_ms")).toHaveLength(1);
  });

  test("pressed before the radio connected: a beep and a notice, not queued", async () => {
    const setup = makeSetup();
    let finish: (v: unknown) => void = () => {};
    confirm(setup).mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const { calls, config } = await joined(setup);
    await vi.waitFor(() => expect(confirm(setup)).toHaveBeenCalled());
    expect(calls.radio.value.connecting).toBe(true);

    calls.radioKeyDown();

    expect(tone(setup).playRadioError).toHaveBeenCalledTimes(1);
    expect(config.notify).toHaveBeenCalledWith({ kind: "radio_connecting" });
    expect(calls.radio.value.transmitting).toBe(false);

    finish(confirmOk());
    await vi.waitFor(() => expect(calls.radio.value.available).toBe(true));
    expect(calls.radio.value.transmitting).toBe(false);
  });

  test("without the right the key only beeps", async () => {
    const setup = makeSetup({ grants: ["Connect", "Speak"] });
    const { calls, config } = await joined(setup);
    await settle();
    await settle();

    calls.radioKeyDown();

    expect(tone(setup).playRadioError).toHaveBeenCalledTimes(1);
    expect(config.notify).not.toHaveBeenCalled();
  });

  test("in an ordinary voice channel the key only beeps", async () => {
    const setup = makeSetup({ broadcast: null });
    const { calls, config } = await joined(setup);
    await settle();

    calls.radioKeyDown();

    expect(tone(setup).playRadioError).toHaveBeenCalledTimes(1);
    expect(config.notify).not.toHaveBeenCalled();
    expect(links(setup)).not.toHaveBeenCalled();
  });

  test("on a radio that gave up, the press asks for the links again", async () => {
    vi.useFakeTimers();
    const setup = makeSetup();
    links(setup).mockRejectedValue(new Error("offline"));
    const { calls, config } = await joined(setup);
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000 + 100);
    await vi.waitFor(() => expect(calls.radio.value.unavailableReason).toBe("error"));
    expect(links(setup)).toHaveBeenCalledTimes(4);
    links(setup).mockResolvedValue(linksOk());

    calls.radioKeyDown();

    expect(tone(setup).playRadioError).toHaveBeenCalledTimes(1);
    expect(config.notify).toHaveBeenCalledWith({ kind: "radio_connecting" });
    await vi.waitFor(() => expect(calls.radio.value.available).toBe(true));
    expect(links(setup)).toHaveBeenCalledTimes(5);
    expect(calls.radio.value.transmitting).toBe(false);
  });

  test("a single-talker channel refuses the key while someone else is on air", async () => {
    const setup = makeSetup();
    links(setup).mockResolvedValue(linksOk(broadcastSettings({ overlap: 1 })));
    const s = await onAir(setup);
    const bob = remote("bob", { [RADIO_ATTR.onAir]: "on" });
    rooms.call!.remoteParticipants.set("bob", bob);
    rooms.call!.emit(RoomEvent.ParticipantAttributesChanged, { [RADIO_ATTR.onAir]: "on" }, bob);
    expect(s.calls.radio.value.busyBy).toBe("bob");

    s.calls.radioKeyDown();

    expect(s.calls.radio.value.transmitting).toBe(false);
    expect(tone(setup).playRadioError).toHaveBeenCalled();
    expect(s.config.notify).toHaveBeenCalledWith({ kind: "radio_busy", userId: "bob" });

    bob.attributes[RADIO_ATTR.onAir] = "off";
    rooms.call!.emit(RoomEvent.ParticipantAttributesChanged, { [RADIO_ATTR.onAir]: "off" }, bob);
    expect(s.calls.radio.value.busyBy).toBeNull();
    s.calls.radioKeyDown();
    expect(s.calls.radio.value.transmitting).toBe(true);
  });

  test("a mixing channel transmits over someone else", async () => {
    const s = await onAir();
    const bob = remote("bob", { [RADIO_ATTR.onAir]: "on" });
    rooms.call!.remoteParticipants.set("bob", bob);
    rooms.call!.emit(RoomEvent.ParticipantAttributesChanged, { [RADIO_ATTR.onAir]: "on" }, bob);

    s.calls.radioKeyDown();

    expect(s.calls.radio.value.busyBy).toBe("bob");
    expect(s.calls.radio.value.transmitting).toBe(true);
    expect(s.config.notify).not.toHaveBeenCalled();
  });

  test("busy is read off the participants already in the room at join", async () => {
    const setup = makeSetup();
    const original = setup.config.createRoom!;
    setup.config.createRoom = (options, purpose) => {
      const room = original(options, purpose) as unknown as FakeRoom;
      if (purpose === "call") room.remoteParticipants.set("bob", remote("bob", { [RADIO_ATTR.onAir]: "on" }));
      return room as any;
    };
    const { calls } = await joined(setup);
    expect(calls.radio.value.busyBy).toBe("bob");
  });
});

// ── Closing ─────────────────────────────────────────────────────────

describe("the radio closes", () => {
  test("when a moderator mutes us, mid-callout included", async () => {
    const s = await onAir();
    s.sys.microphoneMuted = true;
    s.calls.radioKeyDown();
    const radio = rooms.radio!;

    s.bus.fire("VoiceMemberStateChanged", selfState(VoiceStateBits.MUTED_BY_SERVER));

    expect(s.calls.radio.value).toMatchObject({ available: false, transmitting: false, unavailableReason: "server_restricted", settings: null });
    expect(radio.disconnected).toBe(true);
    expect(radioTrack().isMuted).toBe(true);
    expect(s.sys.setMicrophoneMuted).toHaveBeenLastCalledWith(true, { silent: true });

    // Lifted: the links are asked for again.
    s.bus.fire("VoiceMemberStateChanged", selfState(0));
    await vi.waitFor(() => expect(links(s as Setup)).toHaveBeenCalledTimes(2));
  });

  test("a close mid-transmission takes the on-air flag off the HQ participant", async () => {
    const s = await onAir();
    s.calls.radioKeyDown();
    await vi.waitFor(() => expect(rooms.call!.localParticipant.attributes[RADIO_ATTR.onAir]).toBe("on"));

    s.bus.fire("VoiceMemberStateChanged", selfState(VoiceStateBits.MUTED_BY_SERVER));

    await vi.waitFor(() => expect(rooms.call!.localParticipant.attributes[RADIO_ATTR.onAir]).toBe("off"));
    expect(s.telemetry.distribution).toHaveBeenCalledWith("call.radio.transmit_ms", expect.any(Number), "millisecond");
  });

  test("a leave mid-transmission ends it without writing to a room that is going", async () => {
    const s = await onAir();
    s.sys.microphoneMuted = true;
    s.calls.radioKeyDown();
    const setAttributes = rooms.call!.localParticipant.setAttributes as ReturnType<typeof vi.fn>;
    await vi.waitFor(() => expect(setAttributes).toHaveBeenCalledWith({ [RADIO_ATTR.onAir]: "on" }));

    await s.calls.leave();

    expect(radioTrack().isMuted).toBe(true);
    expect(s.sys.setMicrophoneMuted).toHaveBeenLastCalledWith(true, { silent: true });
    expect(setAttributes).not.toHaveBeenCalledWith({ [RADIO_ATTR.onAir]: "off" });
  });

  test("on leave, together with the listener side", async () => {
    const s = await onAir();
    s.calls.radioKeyDown();
    const radio = rooms.radio!;

    await s.calls.leave();

    expect(radio.disconnected).toBe(true);
    expect(s.calls.radio.value).toEqual({
      available: false, connecting: false, transmitting: false, busyBy: null, unavailableReason: null, settings: null, onAir: [],
    });
    expect(audioOf(s as Setup).setVoiceBusGain).toHaveBeenLastCalledWith(1);
  });

  test("a later refetch replaces the room instead of stacking a second one", async () => {
    const s = await onAir();
    const first = rooms.radio!;

    await s.calls.refetchRadioLinks();

    expect(first.disconnected).toBe(true);
    expect(rooms.radios).toHaveLength(2);
    expect(s.calls.radio.value.available).toBe(true);
  });
});

// ── Transient failures ──────────────────────────────────────────────

describe("transient failures", () => {
  test("a failed connect is retried with backoff, not left for dead", async () => {
    vi.useFakeTimers();
    const setup = makeSetup();
    const original = setup.config.createRoom!;
    let failFirst = true;
    setup.config.createRoom = (options, purpose) => {
      const room = original(options, purpose) as unknown as FakeRoom;
      if (purpose === "radio" && failFirst) {
        failFirst = false;
        room.connect = async () => { throw new Error("ConnectionError"); };
      }
      return room as any;
    };
    const { calls, telemetry } = await joined(setup);

    await vi.waitFor(() => expect(rooms.radios).toHaveLength(1));
    await flush();
    expect(calls.radio.value).toMatchObject({ available: false, connecting: true, unavailableReason: "connecting" });
    expect(telemetry.count).toHaveBeenCalledWith("call.radio.links", { result: "failed", error: "Error" });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(calls.radio.value.available).toBe(true));
    expect(rooms.radios).toHaveLength(2);
  });

  test("an unavailable SFU is asked again", async () => {
    vi.useFakeTimers();
    const setup = makeSetup();
    links(setup).mockResolvedValueOnce(linksFailed(5));
    const { calls } = await joined(setup);

    await vi.waitFor(() => expect(links(setup)).toHaveBeenCalledTimes(1));
    expect(calls.radio.value.connecting).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(calls.radio.value.available).toBe(true));
  });

  test("after 1, 2 and 5 seconds the radio gives up with an error", async () => {
    vi.useFakeTimers();
    const setup = makeSetup();
    links(setup).mockRejectedValue(new Error("offline"));
    const { calls } = await joined(setup);

    await vi.waitFor(() => expect(links(setup)).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(links(setup)).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(links(setup)).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(5000);
    await vi.waitFor(() => expect(links(setup)).toHaveBeenCalledTimes(4));
    await flush();

    expect(calls.radio.value).toMatchObject({ available: false, connecting: false, unavailableReason: "error" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(links(setup)).toHaveBeenCalledTimes(4);
  });

  test("a removal by the server is final until the next trigger", async () => {
    vi.useFakeTimers();
    const s = await onAir();

    rooms.radio!.emit(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED);
    expect(s.calls.radio.value).toMatchObject({ available: false, connecting: false, unavailableReason: "error" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(links(s as Setup)).toHaveBeenCalledTimes(1);

    s.calls.radioKeyDown();
    await vi.waitFor(() => expect(links(s as Setup)).toHaveBeenCalledTimes(2));
  });

  test("not in the channel twice: HQ is joined again, once", async () => {
    vi.useFakeTimers();
    const setup = makeSetup();
    const interlink = setup.config.api.channelInteraction.Interlink as ReturnType<typeof vi.fn>;
    confirm(setup).mockResolvedValueOnce(confirmFailed(1)).mockResolvedValueOnce(confirmFailed(1));
    const { calls, config } = await joined(setup);
    const firstRoom = rooms.call!;

    await vi.waitFor(() => expect(confirm(setup)).toHaveBeenCalledTimes(1));
    expect(interlink).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);

    // The second refusal: HQ is left and joined again, and the join brings the radio up.
    await vi.waitFor(() => expect(interlink).toHaveBeenCalledTimes(2));
    expect(firstRoom.disconnected).toBe(true);
    await vi.waitFor(() => expect(calls.radio.value.available).toBe(true));
    expect(confirm(setup)).toHaveBeenCalledTimes(3);
    expect(calls.connectedVoiceChannelId.value).toBe("hq");
    expect(rooms.call).not.toBe(firstRoom);

    // The same again after the rejoin: no second rejoin, the key beeps without a toast.
    confirm(setup).mockResolvedValueOnce(confirmFailed(1)).mockResolvedValueOnce(confirmFailed(1));
    await calls.refetchRadioLinks();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(calls.radio.value.unavailableReason).toBe("not_in_channel"));
    expect(interlink).toHaveBeenCalledTimes(2);
    expect(calls.radio.value.connecting).toBe(false);

    calls.radioKeyDown();
    expect(tone(setup).playRadioError).toHaveBeenCalledTimes(1);
    expect(config.notify).not.toHaveBeenCalledWith({ kind: "radio_connecting" });

    // A fresh join of our own starts the count over.
    await calls.leave();
    confirm(setup).mockResolvedValueOnce(confirmFailed(1)).mockResolvedValueOnce(confirmFailed(1));
    await calls.joinVoiceChannel("hq");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(interlink).toHaveBeenCalledTimes(4));
  });
});

// ── Entitlements ────────────────────────────────────────────────────

describe("entitlement changes", () => {
  const mine = { spaceId: "space-1", userId: "me" };

  test("a revoke closes the radio with the server's reason", async () => {
    vi.useFakeTimers();
    const s = await onAir();
    links(s as Setup).mockResolvedValueOnce(linksFailed(3));

    s.bus.fire("EntitlementsChanged", mine);
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => expect(s.calls.radio.value.unavailableReason).toBe("insufficient_permissions"));
    expect(s.calls.radio.value.available).toBe(false);
    expect(rooms.radios[0].disconnected).toBe(true);
  });

  test("a grant asks the server even while the local copy still says no", async () => {
    vi.useFakeTimers();
    const setup = makeSetup({ grants: ["Connect", "Speak"] });
    const { calls, bus } = await joined(setup);
    await flush();
    expect(links(setup)).not.toHaveBeenCalled();

    bus.fire("EntitlementsChanged", { spaceId: "space-1", userId: null });
    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => expect(calls.radio.value.available).toBe(true));
    expect(links(setup)).toHaveBeenCalledTimes(1);
  });

  test("someone else's roles and other spaces are not about us", async () => {
    vi.useFakeTimers();
    const s = await onAir();

    s.bus.fire("EntitlementsChanged", { spaceId: "space-1", userId: "someone" });
    s.bus.fire("EntitlementsChanged", { spaceId: "space-2", userId: "me" });
    await vi.advanceTimersByTimeAsync(2000);

    expect(links(s as Setup)).toHaveBeenCalledTimes(1);
    expect(rooms.radios).toHaveLength(1);
  });
});

// ── Listening ───────────────────────────────────────────────────────

describe("hearing the radio in a target", () => {
  const alice = () => remote("bc:alice", { [RADIO_ATTR.kind]: "radio", [RADIO_ATTR.user]: "alice", [RADIO_ATTR.broadcast]: "hq" });

  async function listening(setup = makeSetup()) {
    const j = await joined(setup, "party");
    const p = alice();
    rooms.call!.remoteParticipants.set("bc:alice", p);
    await rooms.call!.emit("participantConnected", p);
    rooms.call!.emit("participantActive", p);
    await rooms.call!.emit("trackSubscribed", audioTrack(), { isMuted: false }, p);
    return { ...j, p };
  }

  test("a bc: participant is no tile, no roster entry and no tone; its graph sits on the master", async () => {
    const s = await listening();

    expect(s.calls.participants["bc:alice"]).toBeUndefined();
    expect(tone(s as Setup).playSoftEnterSound).toHaveBeenCalledTimes(1); // our own join only
    expect(s.graphs).toHaveLength(1);
    expect(s.graphs[0].opts.destination).toBe(MASTER);
    expect(s.graphs[0].opts.initialVolume).toBe(100);
  });

  test("on air follows the level with a hangover; the bus is ducked by HQ's setting and restored", async () => {
    vi.useFakeTimers();
    const s = await listening();
    const speak = s.graphs[0].opts.onSpeakingChange as (on: boolean) => void;
    const bus = audioOf(s as Setup).setVoiceBusGain;

    speak(true);
    expect(s.calls.radio.value.onAir).toEqual([{ userId: "alice", hqChannelId: "hq" }]);
    expect(bus).toHaveBeenLastCalledWith(Math.pow(10, -6 / 20));

    speak(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.calls.radio.value.onAir).toHaveLength(1);
    speak(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.calls.radio.value.onAir).toHaveLength(1);

    speak(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(s.calls.radio.value.onAir).toEqual([]);
    expect(bus).toHaveBeenLastCalledWith(1);
  });

  test("the chirp plays when HQ asks for it", async () => {
    const setup = makeSetup();
    setup.channels.hq.Channel.broadcast = broadcastSettings({ chirp: true });
    const s = await listening(setup);

    s.graphs[0].opts.onSpeakingChange(true);
    expect(tone(setup).playRadioChirp).toHaveBeenCalledTimes(1);
    s.graphs[0].opts.onSpeakingChange(true);
    expect(tone(setup).playRadioChirp).toHaveBeenCalledTimes(1);
  });

  test("without HQ anywhere the default ducking applies", async () => {
    const setup = makeSetup();
    delete setup.channels.hq;
    const s = await listening(setup);
    await settle();

    s.graphs[0].opts.onSpeakingChange(true);
    expect(audioOf(setup).setVoiceBusGain).toHaveBeenLastCalledWith(Math.pow(10, -8 / 20));
  });

  test("HQ's settings are fetched from the pool when the broadcaster appears, and follow its changes", async () => {
    const setup = makeSetup();
    const hq = setup.channels.hq;
    delete setup.channels.hq;
    (setup.config.pool as any).getChannel = vi.fn(async (id: string) =>
      id === "hq" ? { ...hq.Channel, broadcast: broadcastSettings({ duckingDb: -12, chirp: false }) } : null);
    const s = await listening(setup);
    await settle();
    expect((setup.config.pool as any).getChannel).toHaveBeenCalledWith("hq");

    const speak = s.graphs[0].opts.onSpeakingChange as (on: boolean) => void;
    speak(true);
    expect(audioOf(setup).setVoiceBusGain).toHaveBeenLastCalledWith(Math.pow(10, -12 / 20));
    expect(tone(setup).playRadioChirp).not.toHaveBeenCalled();
    speak(false);
    await new Promise((r) => setTimeout(r, 450));

    s.bus.fire("ChannelModifiedV2", { spaceId: "space-1", channelId: "hq", patch: { broadcast: broadcastSettings({ duckingDb: -3, chirp: true }) } });
    speak(true);
    expect(tone(setup).playRadioChirp).toHaveBeenCalledTimes(1);
    expect(audioOf(setup).setVoiceBusGain).toHaveBeenLastCalledWith(Math.pow(10, -3 / 20));
  });

  test("an unsubscribed radio track takes its graph and its speaker away", async () => {
    const s = await listening();
    s.graphs[0].opts.onSpeakingChange(true);
    expect(s.calls.radio.value.onAir).toHaveLength(1);

    rooms.call!.emit("trackUnsubscribed", audioTrack(), { isMuted: false }, s.p);

    expect(s.graphs[0].dispose).toHaveBeenCalledTimes(1);
    expect(s.calls.radio.value.onAir).toEqual([]);
    expect(audioOf(s as Setup).setVoiceBusGain).toHaveBeenLastCalledWith(1);
  });

  test("deafening silences the radio graph too, and undeafening brings it back", async () => {
    const s = await listening();
    const graph = s.graphs[0];

    s.sys.headphoneMuted = true;
    for (const h of s.deafenHandlers) h(true);
    expect(graph.setVolume).toHaveBeenLastCalledWith(0);

    s.sys.headphoneMuted = false;
    for (const h of s.deafenHandlers) h(false);
    expect(graph.setVolume).toHaveBeenLastCalledWith(100);
  });

  test("a listener already deafened hears nothing from a broadcaster who arrives", async () => {
    const setup = makeSetup();
    setup.sys.headphoneMuted = true;
    const s = await listening(setup);
    expect(s.graphs[0].opts.initialVolume).toBe(0);
    expect(s.graphs[0].opts.isMutedAll).toBe(true);
  });

  test("the graph goes with the track, and the speaker with it", async () => {
    vi.useFakeTimers();
    const s = await listening();
    s.graphs[0].opts.onSpeakingChange(true);
    expect(s.calls.radio.value.onAir).toHaveLength(1);

    rooms.call!.emit("participantDisconnected", s.p);

    expect(s.graphs[0].dispose).toHaveBeenCalledTimes(1);
    expect(s.calls.radio.value.onAir).toEqual([]);
    expect(audioOf(s as Setup).setVoiceBusGain).toHaveBeenLastCalledWith(1);
    expect(tone(s as Setup).playSoftLeaveSound).not.toHaveBeenCalled();
  });

  test("the roster reconcile and the active speaker ignore bc:", async () => {
    const s = await listening();
    rooms.call!.remoteParticipants.set("u1", remote("u1"));

    await s.calls.reconcileVoiceMembersFromLiveKit();
    const added = (s.config.realtimeStore.addUserToChannel as ReturnType<typeof vi.fn>).mock.calls.map(([, uid]) => uid);
    expect(added).toContain("u1");
    expect(added).not.toContain("bc:alice");

    rooms.call!.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: "bc:alice" }, { identity: "u1" }]);
    expect(s.calls.activeSpeakerId.value).toBe("u1");
    rooms.call!.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: "bc:alice" }]);
    expect(s.calls.activeSpeakerId.value).toBeNull();
  });
});

// ── The shared microphone hold ──────────────────────────────────────

describe("the microphone hold", () => {
  test("push-to-talk and the radio held together give the mic back only after both let go", async () => {
    const s = await onAir();
    s.sys.microphoneMuted = true;

    await s.calls.micHold.acquire("ptt", { restoreTo: "muted" });
    expect(s.sys.setMicrophoneMuted).toHaveBeenCalledTimes(1);
    expect(s.sys.microphoneMuted).toBe(false);

    s.calls.radioKeyDown();
    expect(s.sys.setMicrophoneMuted).toHaveBeenCalledTimes(1);

    await s.calls.micHold.release("ptt");
    expect(s.sys.microphoneMuted).toBe(false);

    s.calls.radioKeyUp();
    expect(s.sys.microphoneMuted).toBe(true);
    expect(s.sys.setMicrophoneMuted).toHaveBeenLastCalledWith(true, { silent: true });
  });

  test("a microphone that was open stays open after the radio", async () => {
    const s = await onAir();
    s.sys.microphoneMuted = false;

    s.calls.radioKeyDown();
    s.calls.radioKeyUp();

    expect(s.sys.microphoneMuted).toBe(false);
    expect(s.sys.setMicrophoneMuted).toHaveBeenLastCalledWith(false, { silent: true });
  });

  /** A stand-in for the app's system store: `locked` is a moderator's mute. */
  function fakeSys(muted: boolean, locked = false) {
    const sys = {
      microphoneMuted: muted,
      setMicrophoneMuted: vi.fn(async (m: boolean) => {
        if (!m && locked) return;
        sys.microphoneMuted = m;
      }),
    };
    return sys;
  }

  test("a push-to-talk tap in voice-activity mode ends muted, as it always did", async () => {
    const sys = fakeSys(false);
    const hold = createMicHold(sys);

    await hold.acquire("ptt", { restoreTo: "muted" });
    await hold.release("ptt");

    expect(sys.microphoneMuted).toBe(true);
  });

  test("the radio puts back what it found", async () => {
    const sys = fakeSys(false);
    const hold = createMicHold(sys);
    await hold.acquire("radio");
    await hold.release("radio");
    expect(sys.microphoneMuted).toBe(false);

    sys.microphoneMuted = true;
    await hold.acquire("radio");
    expect(sys.microphoneMuted).toBe(false);
    await hold.release("radio");
    expect(sys.microphoneMuted).toBe(true);
  });

  test("one push-to-talk anywhere in the overlap means muted afterwards", async () => {
    const sys = fakeSys(false);
    const hold = createMicHold(sys);

    await hold.acquire("radio");
    await hold.acquire("ptt", { restoreTo: "muted" });
    await hold.release("ptt");
    expect(sys.microphoneMuted).toBe(false);
    await hold.release("radio");
    expect(sys.microphoneMuted).toBe(true);
  });

  test("a mic the user closed during the hold stays closed", async () => {
    const sys = fakeSys(true);
    const hold = createMicHold(sys);

    await hold.acquire("radio");
    expect(sys.microphoneMuted).toBe(false);
    sys.microphoneMuted = true;
    sys.setMicrophoneMuted.mockClear();

    await hold.release("radio");
    expect(sys.setMicrophoneMuted).not.toHaveBeenCalled();
    expect(sys.microphoneMuted).toBe(true);
  });

  test("under a moderator's lock the hold opens nothing and releases nothing", async () => {
    const sys = fakeSys(true, true);
    const hold = createMicHold(sys);

    await hold.acquire("ptt", { restoreTo: "muted" });
    expect(sys.microphoneMuted).toBe(true);
    sys.setMicrophoneMuted.mockClear();
    await hold.release("ptt");

    expect(sys.setMicrophoneMuted).not.toHaveBeenCalled();
    expect(hold.held).toBe(false);
  });
});
