/**
 * Voice moderation as the call manager sees it: being moved, being removed, being muted or
 * deafened by a moderator, and reporting our own flags.
 *
 * The SFU half is simulated through the fake room: permissions on the local participant stand in
 * for the token's CanPublishSources, and the events are the ones LiveKit raises when a moderator
 * changes them mid-call.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";

const rooms = vi.hoisted(() => ({
  last: null as any,
  all: [] as any[],
  permissions: undefined as any,
  /** Thrown by the next publishTrack, then cleared. */
  rejectNextPublish: null as Error | null,
}));

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
    constructor(public mediaStreamTrack: unknown) {}
    async mute() { this.isMuted = true; }
    async unmute() { this.isMuted = false; }
  }

  return { ...actual, Room: FakeRoom, LocalAudioTrack: FakeLocalAudioTrack };
});

import { DisconnectReason, RoomEvent, Track } from "livekit-client";
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
      playSoftEnterSound() {}, playSoftLeaveSound() {},
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

beforeEach(() => {
  rooms.last = null;
  rooms.all = [];
  rooms.permissions = undefined;
  rooms.rejectNextPublish = null;
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
  test("leaves the source room and joins the target in the event's space", async () => {
    const { calls, room, bus, interlink, config } = await joined();

    bus.fire("VoiceMoveRequested", { spaceId: "space-1", fromChannelId: "chan-1", toChannelId: "chan-2", byUserId: "mod" });
    await vi.waitFor(() => expect(calls.connectedVoiceChannelId.value).toBe("chan-2"));

    expect(room.disconnected).toBe(true);
    expect(rooms.last).not.toBe(room);
    expect(interlink).toHaveBeenLastCalledWith("space-1", "chan-2");
    expect(calls.mode.value).toBe("channel");
    expect(config.notify).toHaveBeenCalledWith({ kind: "moved", spaceId: "space-1", channelId: "chan-2" });
  });

  test("follows the move even while another space is on screen", async () => {
    const has = vi.fn(() => true);
    const setup = makeConfig({ pex: { has } });
    const pool = setup.config.pool as { selectedServer: string | null };
    const calls = createCallManager(setup.config);
    await calls.joinVoiceChannel("chan-1");
    // The user wandered off to another space; Connect there says nothing about this one.
    pool.selectedServer = "space-other";
    has.mockReturnValue(false);

    setup.bus.fire("VoiceMoveRequested", { spaceId: "space-1", fromChannelId: "chan-1", toChannelId: "chan-2", byUserId: "mod" });
    await vi.waitFor(() => expect(calls.connectedVoiceChannelId.value).toBe("chan-2"));

    expect(setup.interlink).toHaveBeenLastCalledWith("space-1", "chan-2");
    expect(calls.connectedVoiceSpaceId.value).toBe("space-1");
  });

  test("is ignored for a room we are not in", async () => {
    const { calls, room, bus, interlink, config } = await joined();

    bus.fire("VoiceMoveRequested", { spaceId: "space-1", fromChannelId: "chan-9", toChannelId: "chan-2", byUserId: "mod" });
    bus.fire("VoiceMoveRequested", { spaceId: "space-2", fromChannelId: "chan-1", toChannelId: "chan-2", byUserId: "mod" });
    await Promise.resolve();

    expect(room.disconnected).toBe(false);
    expect(calls.connectedVoiceChannelId.value).toBe("chan-1");
    expect(interlink).toHaveBeenCalledTimes(1);
    expect(config.notify).not.toHaveBeenCalled();
  });

  test("is ignored outside a call", async () => {
    const setup = makeConfig();
    const calls = createCallManager(setup.config);

    setup.bus.fire("VoiceMoveRequested", { spaceId: "space-1", fromChannelId: "chan-1", toChannelId: "chan-2", byUserId: "mod" });
    await Promise.resolve();

    expect(setup.interlink).not.toHaveBeenCalled();
    expect(calls.mode.value).toBe("none");
  });

  test("no 'moved' notice when the target cannot be joined", async () => {
    const { calls, bus, interlink, config } = await joined();
    interlink.mockResolvedValueOnce({ isSuccessJoinVoice: () => false, isFailedJoinVoice: () => true, error: 0 });

    bus.fire("VoiceMoveRequested", { spaceId: "space-1", fromChannelId: "chan-1", toChannelId: "chan-2", byUserId: "mod" });
    await vi.waitFor(() => expect(interlink).toHaveBeenCalledTimes(2));
    await Promise.resolve();

    expect(calls.mode.value).toBe("none");
    expect(config.notify).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "moved" }));
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
    const { calls, room, bus } = await joined();
    // leave() drops the old room's listeners; keep its handler to deliver a late event anyway.
    const [lateDisconnect] = room.handlers.get("disconnected");
    bus.fire("VoiceMoveRequested", { spaceId: "space-1", fromChannelId: "chan-1", toChannelId: "chan-2", byUserId: "mod" });
    await vi.waitFor(() => expect(calls.connectedVoiceChannelId.value).toBe("chan-2"));

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
