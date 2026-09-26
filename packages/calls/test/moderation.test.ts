/**
 * Voice moderation as the call manager sees it: being moved, being removed, being muted or
 * deafened by a moderator, and reporting our own flags.
 *
 * The SFU half is simulated through the fake room: permissions on the local participant stand in
 * for the token's CanPublishSources, and the events are the ones LiveKit raises when a moderator
 * changes them mid-call.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, type Ref } from "vue";

const rooms = vi.hoisted(() => ({
  last: null as any,
  all: [] as any[],
  permissions: undefined as any,
  /** Thrown by the next publishTrack, then cleared. */
  rejectNextPublish: null as Error | null,
  /** The RTCRtpSender behind every microphone track published from now on. */
  sender: undefined as any,
}));

vi.mock("livekit-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-client")>();

  class FakeRoom {
    handlers = new Map<string, Function[]>();
    remoteParticipants = new Map<string, any>();
    name = "space-1/chan-1";
    canPlaybackAudio = true;
    canPlaybackVideo = true;
    engine = { client: { rtt: 8 } };
    disconnected = false;
    localParticipant: any = {
      identity: "me",
      isLocal: true,
      permissions: rooms.permissions,
      on: vi.fn(),
      publishTrack: vi.fn(async () => {
        const err = rooms.rejectNextPublish;
        rooms.rejectNextPublish = null;
        if (err) throw err;
        return { once: vi.fn(), track: {} };
      }),
      setAttributes: vi.fn(async () => {}),
      trackPublications: new Map(),
    };
    constructor(public options: any) {
      rooms.last = this;
      rooms.all.push(this);
    }
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
    sender = rooms.sender;
    constructor(public mediaStreamTrack: unknown) {}
    async mute() { this.isMuted = true; }
    async unmute() { this.isMuted = false; }
  }

  return { ...actual, Room: FakeRoom, LocalAudioTrack: FakeLocalAudioTrack };
});

import { ConnectionQuality, DisconnectReason, RoomEvent, SubscriptionError, Track } from "livekit-client";
import { ChannelMemberState, JoinToChannelError } from "@argon/glue";
import {
  createCallManager,
  decodeVoiceState,
  encodeSelfVoiceState,
  withServerVoiceState,
  VoiceStateBits,
  SELF_VOICE_STATE_MASK,
  type CallManagerConfig,
} from "../src";

const MIC = Track.sourceToProto(Track.Source.Microphone);
const CAMERA = Track.sourceToProto(Track.Source.Camera);

type Handler = (ev: any) => void;

function makeBus() {
  const handlers = new Map<string, Handler[]>();
  return {
    onServerEvent: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return { unsubscribe() {} };
    },
    fire: (event: string, payload: unknown) => {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
  };
}

function makeConfig(overrides: Partial<CallManagerConfig> = {}) {
  const bus = makeBus();
  const interlink = vi.fn(async (_space: string, _channel: string): Promise<any> => ({
    isSuccessJoinVoice: () => true,
    isFailedJoinVoice: () => false,
    token: "t",
    rtc: { endpoint: "wss://sfu.test", ices: [] },
  }));
  const config: CallManagerConfig = {
    audio: {
      getCurrentAudioContext: () => ({ state: "running", resume: async () => {} }) as any,
      acquireInput: async () => ({ getAudioTracks: () => [{ clone: () => ({ stop() {} }) }] }) as any,
      releaseInput: vi.fn(),
      createRemoteAudioGraph: () => ({ setVolume() {}, dispose() {} }),
      createVirtualVUMeter: async () => ({ dispose() {} }),
      onAudioDeviceError: () => ({ unsubscribe() {} }) as any,
      getVoiceBus: () => ({}) as any,
      setVoiceBusGain() {},
      getOutputDestination: () => ({}) as any,
    },
    api: {
      callInteraction: {
        DingDongCreep: async () => null,
        PickUpCall: async () => null,
        RejectCall: async () => undefined,
      },
      channelInteraction: {
        Interlink: interlink,
        UpdateVoiceState: vi.fn(async () => undefined),
        GetBroadcastLinks: vi.fn(async () => ({ isSuccessBroadcastLinks: () => false, isFailedBroadcastLinks: () => true, error: 2 }) as any),
        ConfirmBroadcastLinks: vi.fn(async () => ({ isSuccessConfirmBroadcastLinks: () => false, isFailedConfirmBroadcastLinks: () => true, error: 2 }) as any),
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
      playSoftEnterSound() {}, playSoftLeaveSound() {}, playMovedSound() {},
      playRadioError() {}, playRadioChirp() {},
    },
    me: { me: { userId: "me" } },
    bus,
    sys: {
      microphoneMuted: false,
      headphoneMuted: false,
      muteEvent: { subscribe: () => ({ unsubscribe() {} }) as any },
      muteHeadphoneEvent: { subscribe: () => ({ unsubscribe() {} }) as any },
      setServerVoiceRestriction: vi.fn(),
      setMicrophoneMuted: vi.fn(),
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
    selectScreenSource: async () => {},
    notify: vi.fn(),
    ...overrides,
  };
  return { config, bus, interlink };
}

async function joined(setup = makeConfig()) {
  const calls = createCallManager(setup.config);
  await calls.joinVoiceChannel("chan-1");
  return { calls, room: rooms.last, ...setup };
}

/** Microphone publishes the fake room saw (the camera and screen go through the same method). */
const micPublishes = (room: any) =>
  room.localParticipant.publishTrack.mock.calls.filter(([t]: any[]) => t.source === Track.Source.Microphone);

const selfState = (state: number, spaceId = "space-1", channelId = "chan-1") =>
  ({ spaceId, channelId, userId: "me", state });

function fakeParticipant(identity: string) {
  return {
    identity,
    isLocal: false,
    name: identity,
    metadata: "",
    attributes: {} as Record<string, string>,
    trackPublications: new Map(),
    getTrackPublications: () => [],
    on: vi.fn(),
    setAudioContext: vi.fn(),
  };
}

const audioTrack = () => ({
  kind: Track.Kind.Audio,
  source: Track.Source.Microphone,
  mediaStreamTrack: {},
  attach: vi.fn(),
  detach: vi.fn(),
});

const spiedTone = () => ({
  playRingSound() {}, stopPlayRingSound() {},
  playSoftEnterSound: vi.fn(), playSoftLeaveSound: vi.fn(), playMovedSound: vi.fn(),
  playRadioError() {}, playRadioChirp() {},
});

async function withParticipant(calls: ReturnType<typeof createCallManager>, room: any, identity: string) {
  const p = fakeParticipant(identity);
  room.remoteParticipants.set(identity, p);
  room.emit("participantConnected", p);
  await vi.waitFor(() => expect(calls.participants[identity]).toBeDefined());
  return p;
}

/**
 * What livekit-client does on a RoomMovedResponse (Room.ts, EngineEvent.RoomMoved): renames the
 * room, disconnects the old room's participants, emits Moved with the new name, then announces
 * the new room's participants. Our own tracks stay published.
 */
function moveRoom(room: any, name: string, newcomers: ReturnType<typeof fakeParticipant>[] = []) {
  room.name = name;
  for (const [identity, p] of [...room.remoteParticipants]) {
    room.remoteParticipants.delete(identity);
    room.emit("participantDisconnected", p);
  }
  room.emit(RoomEvent.Moved, name);
  for (const p of newcomers) {
    room.remoteParticipants.set(p.identity, p);
    room.emit("participantConnected", p);
  }
}

beforeEach(() => {
  rooms.last = null;
  rooms.all = [];
  rooms.permissions = undefined;
  rooms.rejectNextPublish = null;
  rooms.sender = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("voice state bits", () => {
  test("mirror the contract's ChannelMemberState", () => {
    expect(VoiceStateBits.MUTED).toBe(ChannelMemberState.MUTED);
    expect(VoiceStateBits.MUTED_BY_SERVER).toBe(ChannelMemberState.MUTED_BY_SERVER);
    expect(VoiceStateBits.MUTED_HEADPHONES).toBe(ChannelMemberState.MUTED_HEADPHONES);
    expect(VoiceStateBits.MUTED_HEADPHONES_BY_SERVER).toBe(ChannelMemberState.MUTED_HEADPHONES_BY_SERVER);
    expect(VoiceStateBits.STREAMING).toBe(ChannelMemberState.STREAMING);
  });

  test("a self report never carries a moderator's bits", () => {
    const all = encodeSelfVoiceState({ muted: true, deafened: true, streaming: true });
    expect(all & ~SELF_VOICE_STATE_MASK).toBe(0);
    expect(decodeVoiceState(all)).toEqual({
      muted: true, deafened: true, streaming: true, serverMuted: false, serverDeafened: false,
    });
  });

  test("moderation replaces only its own bits", () => {
    const own = VoiceStateBits.MUTED | VoiceStateBits.STREAMING;
    const restricted = withServerVoiceState(own, true, true);
    expect(decodeVoiceState(restricted)).toEqual({
      muted: true, deafened: false, streaming: true, serverMuted: true, serverDeafened: true,
    });
    expect(withServerVoiceState(restricted, false, false)).toBe(own);
  });
});

describe("being moved by a moderator", () => {
  test("switches to the new channel on the same connection", async () => {
    const persisted = new Map<string, Ref<string>>();
    const telemetry = { count: vi.fn(), distribution: vi.fn() };
    const setup = makeConfig({
      telemetry,
      persistedValue: (key, initial) => {
        const value = ref(initial);
        persisted.set(key, value);
        return value;
      },
    });
    const { calls, room, interlink, config } = await joined(setup);

    moveRoom(room, "space-1/chan-2");

    expect(calls.connectedVoiceChannelId.value).toBe("chan-2");
    expect(calls.connectedVoiceSpaceId.value).toBe("space-1");
    expect(calls.callId.value).toBe("channel-chan-2");
    expect(calls.targetId.value).toBe("chan-2");
    expect(calls.mode.value).toBe("channel");
    expect(calls.isConnected.value).toBe(true);
    expect(room.disconnected).toBe(false);
    expect(rooms.all).toHaveLength(1);
    expect(interlink).toHaveBeenCalledTimes(1);
    expect(persisted.get("argon:lastVoiceServerId")!.value).toBe("space-1");
    expect(persisted.get("argon:lastVoiceChannelId")!.value).toBe("chan-2");
    expect(config.notify).toHaveBeenCalledWith({ kind: "moved", spaceId: "space-1", channelId: "chan-2" });
    expect(telemetry.count).toHaveBeenCalledWith("call.moved", { result: "ok" });
  });

  test("the old room's participants go, the new room's come, and the move has its own sound", async () => {
    const graph = { setVolume: vi.fn(), dispose: vi.fn() };
    const tone = spiedTone();
    const setup = makeConfig({ tone });
    setup.config.audio.createRemoteAudioGraph = () => graph;
    const { calls, room } = await joined(setup);
    // A join is still a join.
    expect(tone.playSoftEnterSound).toHaveBeenCalledTimes(1);
    expect(tone.playMovedSound).not.toHaveBeenCalled();
    const u1 = await withParticipant(calls, room, "u1");
    room.emit("trackSubscribed", audioTrack(), { isMuted: false, source: Track.Source.Microphone }, u1);
    await vi.waitFor(() => expect(calls.participants.u1.audioGraph).not.toBeNull());
    room.emit(RoomEvent.ConnectionQualityChanged, ConnectionQuality.Poor, u1);
    room.emit(RoomEvent.TrackSubscriptionFailed, "TR_1", u1, SubscriptionError.PermissionDenied);
    room.emit(RoomEvent.ActiveSpeakersChanged, [u1]);
    expect(calls.activeSpeakerId.value).toBe("u1");
    tone.playSoftEnterSound.mockClear();

    moveRoom(room, "space-1/chan-2", [fakeParticipant("u2")]);

    expect(calls.participants.u1).toBeUndefined();
    expect(graph.dispose).toHaveBeenCalledTimes(1);
    expect(calls.participantQuality.has("u1")).toBe(false);
    expect(calls.subscriptionErrors.has("u1")).toBe(false);
    expect(calls.activeSpeakerId.value).toBeNull();
    await vi.waitFor(() => expect(calls.participants.u2).toBeDefined());
    expect(tone.playSoftLeaveSound).not.toHaveBeenCalled();
    expect(tone.playSoftEnterSound).not.toHaveBeenCalled();
    expect(tone.playMovedSound).toHaveBeenCalledTimes(1);
  });

  test("outside a move, someone leaving still plays the leave tone", async () => {
    const tone = spiedTone();
    const { calls, room } = await joined(makeConfig({ tone }));
    const u1 = await withParticipant(calls, room, "u1");

    room.remoteParticipants.delete("u1");
    room.emit("participantDisconnected", u1);

    expect(calls.participants.u1).toBeUndefined();
    expect(tone.playSoftLeaveSound).toHaveBeenCalledTimes(1);
  });

  test("closes the radio and asks for the new channel's links", async () => {
    const setup = makeConfig();
    setup.config.pool.getChannel = async (id) => ({ broadcast: id === "chan-2" ? ({} as any) : null });
    const setVoiceBusGain = vi.fn();
    setup.config.audio.setVoiceBusGain = setVoiceBusGain;
    const links = setup.config.api.channelInteraction.GetBroadcastLinks as ReturnType<typeof vi.fn>;
    const { room } = await joined(setup);
    expect(links).not.toHaveBeenCalled();

    moveRoom(room, "space-1/chan-2");

    expect(setVoiceBusGain).toHaveBeenLastCalledWith(1);
    await vi.waitFor(() => expect(links).toHaveBeenCalledWith("space-1", "chan-2"));
  });

  test("re-tunes the microphone to the new channel's bitrate", async () => {
    rooms.sender = { getParameters: () => ({ encodings: [{}] }), setParameters: vi.fn(async () => {}) };
    const setup = makeConfig();
    setup.config.pool.getChannel = async (id) => ({ bitrate: id === "chan-2" ? 32 : null });
    const { room } = await joined(setup);

    moveRoom(room, "space-1/chan-2");

    await vi.waitFor(() =>
      expect(rooms.sender.setParameters).toHaveBeenCalledWith({ encodings: [{ maxBitrate: 32_000 }] }));
  });

  test("reports our flags to the new channel", async () => {
    vi.useFakeTimers();
    const setup = makeConfig();
    const { room } = await joined(setup);
    await vi.advanceTimersByTimeAsync(200);
    const update = setup.config.api.channelInteraction.UpdateVoiceState as ReturnType<typeof vi.fn>;
    update.mockClear();

    moveRoom(room, "space-1/chan-2");
    await vi.advanceTimersByTimeAsync(200);

    expect(update).toHaveBeenCalledWith("space-1", "chan-2", 0);
  });

  test("a room we cannot place ends the call", async () => {
    const telemetry = { count: vi.fn(), distribution: vi.fn() };
    const { calls, room } = await joined(makeConfig({ telemetry }));

    moveRoom(room, "radio/space-1/chan-2");
    await vi.waitFor(() => expect(calls.room.value).toBeNull());

    expect(calls.mode.value).toBe("none");
    expect(room.disconnected).toBe(true);
    expect(telemetry.count).toHaveBeenCalledWith("call.moved", { result: "failed", error: "bad_room_name" });
  });
});

describe("the server ending the call", () => {
  test.each([
    DisconnectReason.PARTICIPANT_REMOVED,
    DisconnectReason.ROOM_DELETED,
    DisconnectReason.ROOM_CLOSED,
    DisconnectReason.DUPLICATE_IDENTITY,
  ])("a removal (%s) cleans up like a leave", async (reason) => {
    const { calls, room, config } = await joined();

    room.emit("disconnected", reason);
    await vi.waitFor(() => expect(calls.room.value).toBeNull());

    expect(calls.mode.value).toBe("none");
    expect(calls.connectedVoiceChannelId.value).toBeNull();
    expect(calls.connectedVoiceSpaceId.value).toBeNull();
    expect(config.audio.releaseInput).toHaveBeenCalled();
  });

  test("a transient or unexplained drop leaves the state for the reconnect UI", async () => {
    const { calls, room } = await joined();

    room.emit("disconnected", DisconnectReason.SIGNAL_CLOSE);
    room.emit("disconnected", undefined);
    await Promise.resolve();

    expect(calls.room.value).not.toBeNull();
    expect(calls.connectedVoiceChannelId.value).toBe("chan-1");
  });

  test("a disconnect from a room we already replaced does not end the new call", async () => {
    const { calls, room } = await joined();
    // leave() drops the old room's listeners; keep its handler to deliver a late event anyway.
    const [lateDisconnect] = room.handlers.get("disconnected");
    await calls.leave();
    await calls.joinVoiceChannel("chan-2");
    expect(calls.connectedVoiceChannelId.value).toBe("chan-2");

    lateDisconnect(DisconnectReason.PARTICIPANT_REMOVED);
    await Promise.resolve();

    expect(calls.connectedVoiceChannelId.value).toBe("chan-2");
  });
});

describe("a moderator's mute and deafen on us", () => {
  test("is taken from our own state event, announced, and handed to the host's lock", async () => {
    const { calls, bus, config } = await joined();

    bus.fire("VoiceMemberStateChanged", selfState(VoiceStateBits.MUTED_BY_SERVER | VoiceStateBits.MUTED));

    expect(calls.serverMuted.value).toBe(true);
    expect(calls.serverDeafened.value).toBe(false);
    expect(config.sys.setServerVoiceRestriction).toHaveBeenLastCalledWith({ muted: true, deafened: false });
    expect(config.notify).toHaveBeenCalledWith({ kind: "server-muted" });

    bus.fire("VoiceMemberStateChanged", selfState(VoiceStateBits.MUTED_HEADPHONES_BY_SERVER));
    expect(config.notify).toHaveBeenCalledWith({ kind: "server-unmuted" });
    expect(config.notify).toHaveBeenCalledWith({ kind: "server-deafened" });
    expect(config.sys.setServerVoiceRestriction).toHaveBeenLastCalledWith({ muted: false, deafened: true });
  });

  test("an echo of our own flags is not a transition", async () => {
    const { bus, config } = await joined();
    bus.fire("VoiceMemberStateChanged", selfState(VoiceStateBits.MUTED | VoiceStateBits.STREAMING));
    expect(config.notify).not.toHaveBeenCalled();
  });

  test("other members and other spaces are not about us", async () => {
    const { calls, bus } = await joined();
    bus.fire("VoiceMemberStateChanged", { ...selfState(VoiceStateBits.MUTED_BY_SERVER), userId: "someone" });
    bus.fire("VoiceMemberStateChanged", selfState(VoiceStateBits.MUTED_BY_SERVER, "space-2"));
    expect(calls.serverMuted.value).toBe(false);
  });

  test("leaving lifts the lock, quietly", async () => {
    const { calls, bus, config } = await joined();
    bus.fire("VoiceMemberStateChanged", selfState(VoiceStateBits.MUTED_BY_SERVER));
    (config.notify as ReturnType<typeof vi.fn>).mockClear();

    await calls.leave();

    expect(calls.serverMuted.value).toBe(false);
    expect(config.sys.setServerVoiceRestriction).toHaveBeenLastCalledWith({ muted: false, deafened: false });
    expect(config.notify).not.toHaveBeenCalled();
  });

  test("a restriction reported before Interlink answers still applies", async () => {
    const setup = makeConfig();
    const calls = createCallManager(setup.config);
    setup.interlink.mockImplementationOnce(async () => {
      setup.bus.fire("VoiceMemberStateChanged", selfState(VoiceStateBits.MUTED_BY_SERVER));
      return { isSuccessJoinVoice: () => true, token: "t", rtc: { endpoint: "wss://sfu.test", ices: [] } };
    });

    await calls.joinVoiceChannel("chan-1");

    expect(calls.serverMuted.value).toBe(true);
  });
});

describe("the microphone follows the SFU's permissions", () => {
  test("joining without the microphone source still connects, with no mic published", async () => {
    rooms.permissions = { canPublish: true, canPublishSources: [CAMERA] };
    const { calls, room } = await joined();

    expect(calls.isConnected.value).toBe(true);
    expect(calls.connectError.value).toBeNull();
    expect(micPublishes(room)).toHaveLength(0);
  });

  test("it is published once the permissions allow it again", async () => {
    rooms.permissions = { canPublish: true, canPublishSources: [CAMERA] };
    const { room } = await joined();

    room.localParticipant.permissions = { canPublish: true, canPublishSources: [CAMERA, MIC] };
    room.emit(RoomEvent.ParticipantPermissionsChanged, undefined, room.localParticipant);

    await vi.waitFor(() => expect(micPublishes(room)).toHaveLength(1));
  });

  test("an SFU refusal at publish time is not a failed join", async () => {
    const { PublishTrackError } = await import("livekit-client");
    rooms.rejectNextPublish = new PublishTrackError("insufficient permissions", 403);
    const setup = makeConfig();
    const calls = createCallManager(setup.config);
    await calls.joinVoiceChannel("chan-1");

    expect(calls.isConnected.value).toBe(true);
    expect(calls.connectError.value).toBeNull();
  });

  test("after the server unpublished it, it comes back when allowed, and only once", async () => {
    const { room } = await joined();
    expect(micPublishes(room)).toHaveLength(1);

    // The moderator mutes: the SFU revokes the source and unpublishes the track.
    room.localParticipant.permissions = { canPublish: true, canPublishSources: [CAMERA] };
    room.emit(RoomEvent.ParticipantPermissionsChanged, undefined, room.localParticipant);
    room.emit(RoomEvent.LocalTrackUnpublished, { source: Track.Source.Microphone, track: undefined }, room.localParticipant);

    // …and lifts it.
    room.localParticipant.permissions = { canPublish: true, canPublishSources: [] };
    room.emit(RoomEvent.ParticipantPermissionsChanged, undefined, room.localParticipant);
    room.emit(RoomEvent.ParticipantPermissionsChanged, undefined, room.localParticipant);

    await vi.waitFor(() => expect(micPublishes(room)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(micPublishes(room)).toHaveLength(2);
  });

  test("a republished mic starts muted when the user is muted", async () => {
    const setup = makeConfig();
    (setup.config.sys as { microphoneMuted: boolean }).microphoneMuted = true;
    rooms.permissions = { canPublish: true, canPublishSources: [CAMERA] };
    const { room } = await joined(setup);

    room.localParticipant.permissions = { canPublish: true, canPublishSources: [] };
    room.emit(RoomEvent.ParticipantPermissionsChanged, undefined, room.localParticipant);

    await vi.waitFor(() => expect(micPublishes(room)).toHaveLength(1));
    await vi.waitFor(() => expect(micPublishes(room)[0][0].isMuted).toBe(true));
  });
});

describe("reporting our own flags", () => {
  test("after joining, once, with only our own bits", async () => {
    vi.useFakeTimers();
    const setup = makeConfig();
    (setup.config.sys as { microphoneMuted: boolean }).microphoneMuted = true;
    await joined(setup);

    await vi.advanceTimersByTimeAsync(200);

    const update = setup.config.api.channelInteraction.UpdateVoiceState as ReturnType<typeof vi.fn>;
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("space-1", "chan-1", VoiceStateBits.MUTED);
  });

  test("a burst of changes is sent as one report", async () => {
    vi.useFakeTimers();
    let emitMute: (m: boolean) => void = () => {};
    let emitDeafen: (m: boolean) => void = () => {};
    const setup = makeConfig();
    const sys = setup.config.sys as any;
    sys.muteEvent = { subscribe: (fn: (m: boolean) => void) => { emitMute = fn; return { unsubscribe() {} }; } };
    sys.muteHeadphoneEvent = { subscribe: (fn: (m: boolean) => void) => { emitDeafen = fn; return { unsubscribe() {} }; } };
    await joined(setup);
    await vi.advanceTimersByTimeAsync(200);
    const update = setup.config.api.channelInteraction.UpdateVoiceState as ReturnType<typeof vi.fn>;
    update.mockClear();

    // Deafening flips both, and each fires its own event.
    sys.microphoneMuted = true;
    sys.headphoneMuted = true;
    emitDeafen(true);
    emitMute(true);
    await vi.advanceTimersByTimeAsync(200);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("space-1", "chan-1", VoiceStateBits.MUTED | VoiceStateBits.MUTED_HEADPHONES);
  });

  test("a failed report is swallowed", async () => {
    vi.useFakeTimers();
    const setup = makeConfig();
    (setup.config.api.channelInteraction.UpdateVoiceState as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error("offline"));
    const { calls } = await joined(setup);

    await vi.advanceTimersByTimeAsync(200);

    expect(calls.isConnected.value).toBe(true);
  });
});

describe("a join the server refuses", () => {
  test("for missing Connect on the channel, the user is told", async () => {
    const setup = makeConfig();
    setup.interlink.mockResolvedValueOnce({
      isSuccessJoinVoice: () => false,
      isFailedJoinVoice: () => true,
      error: JoinToChannelError.INSUFFICIENT_PERMISSIONS,
    });
    const calls = createCallManager(setup.config);

    await calls.joinVoiceChannel("chan-1");

    expect(calls.mode.value).toBe("none");
    expect(calls.connectedVoiceSpaceId.value).toBeNull();
    expect(setup.config.notify).toHaveBeenCalledWith({ kind: "join-refused", reason: "insufficient_permissions" });
  });

  test("for other reasons, nothing new is shown", async () => {
    const setup = makeConfig();
    setup.interlink.mockResolvedValueOnce({
      isSuccessJoinVoice: () => false,
      isFailedJoinVoice: () => true,
      error: JoinToChannelError.CHANNEL_IS_NOT_VOICE,
    });
    const calls = createCallManager(setup.config);

    await calls.joinVoiceChannel("chan-1");

    expect(setup.config.notify).not.toHaveBeenCalled();
  });
});
