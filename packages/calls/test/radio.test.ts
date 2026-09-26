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
import { createCallManager, VoiceStateBits, RADIO_ATTR, type CallManagerConfig } from "../src";

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
  return {
    onServerEvent: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return { unsubscribe() {} };
    },
    onReconnected: (handler: () => void) => {
      reconnected.push(handler);
      return { unsubscribe() {} };
    },
    fire: (event: string, payload: unknown) => {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
    reconnect: () => { for (const h of reconnected) h(); },
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

  test("a realtime reconnect only re-confirms a working radio", async () => {
    const s = await onAir();
    s.bus.reconnect();
    await vi.waitFor(() => expect(confirm(s as Setup)).toHaveBeenCalledTimes(2));
    expect(links(s as Setup)).toHaveBeenCalledTimes(1);
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

  test("without HQ's settings the default ducking applies", async () => {
    const setup = makeSetup();
    delete setup.channels.hq;
    const s = await listening(setup);

    s.graphs[0].opts.onSpeakingChange(true);
    expect(audioOf(setup).setVoiceBusGain).toHaveBeenLastCalledWith(Math.pow(10, -8 / 20));
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

    await s.calls.micHold.acquire("ptt");
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

  test("a microphone that was open stays open after the hold", async () => {
    const s = await onAir();
    s.sys.microphoneMuted = false;

    s.calls.radioKeyDown();
    s.calls.radioKeyUp();

    expect(s.sys.microphoneMuted).toBe(false);
    expect(s.sys.setMicrophoneMuted).toHaveBeenLastCalledWith(false, { silent: true });
  });
});
