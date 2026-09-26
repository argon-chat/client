// @argon/calls - Call manager
//
// The single implementation of Argon's calling. Everything it touches from the host
// application arrives through CallManagerConfig, so the package owns the LiveKit
// integration and the app owns wiring; `useUnifiedCall` is a thin pinia wrapper over
// createCallManager().

import {
  Room,
  RoomEvent,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  LocalVideoTrack,
  Track,
  LocalAudioTrack,
  AudioPresets,
  ConnectionQuality,
  DisconnectReason,
  SubscriptionError,
  VideoQuality,
  RemoteVideoTrack,
  createLocalVideoTrack,
  isLocalParticipant,
  isRemoteTrack,
  VideoPresets,
  PublishTrackError,
} from "livekit-client";
import { ref, reactive, computed, watch, toRaw } from "vue";
import { Subscription } from "rxjs";
import { logger, startTimer, DisposableBag } from "@argon/core";
import type {
  BroadcastSettings,
  CallIncoming,
  CallFinished,
  CallAccepted,
  ChannelModifiedV2,
  EntitlementsChanged,
  RtcEndpoint,
  VoiceMemberStateChanged,
} from "@argon/glue";

import { parseRtcStats } from "./rtcStats";
import { decodeVoiceState, encodeSelfVoiceState } from "./voiceState";
import { connectRoom } from "./connectRoom";
import { createMicHold } from "./micHold";
import type { CallManagerConfig, CallNotice, RemoteAudioGraph, ScreenShareOpts } from "./types";
import { initialRadioState, type RadioState, type RadioUnavailableReason } from "./radio/types";
import { isRadioIdentity, radioUserId, RADIO_ATTR, RADIO_ON_AIR } from "./radio/identity";
import { RadioSession } from "./radio/RadioSession";
import { parseVoiceRoomName } from "./roomName";

export type { ScreenShareOpts } from "./types";

/** JoinToChannelError.INSUFFICIENT_PERMISSIONS in the contract. */
const JOIN_ERROR_INSUFFICIENT_PERMISSIONS = 2;

/** BroadcastLinksError in the contract, by value, and what each means to the user. */
const RADIO_LINKS_ERROR_NOT_IN_CHANNEL = 1;
const RADIO_LINKS_ERROR_SFU_UNAVAILABLE = 5;
const RADIO_LINKS_ERRORS: Record<number, RadioUnavailableReason> = {
  1: "not_in_channel",
  2: "not_a_broadcast_channel",
  3: "insufficient_permissions",
  4: "server_restricted",
  5: "sfu_unavailable",
};
/** Reasons a key press cannot change: it just beeps, no "connecting" toast, no refetch. */
const RADIO_TERMINAL_REASONS: ReadonlySet<RadioUnavailableReason> = new Set<RadioUnavailableReason>([
  "not_a_broadcast_channel",
  "insufficient_permissions",
  "server_restricted",
  "not_in_channel",
]);
/** `reconnected` and `needFullResync` can both fire for one outage: one resync covers them. */
const RADIO_RESYNC_COALESCE_MS = 250;
/** BroadcastOverlap.LOCK in the contract. */
const RADIO_OVERLAP_LOCK = 1;
/** A key-down this soon after a key-up is a bounce, not a new press. */
const RADIO_KEY_DEBOUNCE_MS = 200;
/** A speaker stays "on air" this long after their level drops, so pauses do not flicker. */
const RADIO_ON_AIR_HANGOVER_MS = 400;
/** Ducking applied to the voice bus when the HQ channel's settings cannot be read. */
const RADIO_DEFAULT_DUCKING_DB = -8;
/** The radio room dropped while we are still in HQ: refetch after these, then give up. */
const RADIO_RECONNECT_BACKOFF_MS = [1000, 2000, 5000];
/** A confirm that finds us not in the channel: one refetch after this. */
const RADIO_CONFIRM_RETRY_MS = 1000;
/** Entitlement changes are refetched by the host with a debounce; wait for that before asking. */
const RADIO_ENTITLEMENT_SETTLE_MS = 1000;

/** Own voice flags are reported at most this often; a mute toggle fires two events. */
const VOICE_STATE_DEBOUNCE_MS = 150;

/**
 * Disconnects after which the room is gone for good because the server said so: a moderator's
 * kick, the room closing, or the same identity joining from elsewhere.
 */
const SERVER_SIDE_REMOVALS: ReadonlySet<DisconnectReason> = new Set([
  DisconnectReason.PARTICIPANT_REMOVED,
  DisconnectReason.ROOM_DELETED,
  DisconnectReason.ROOM_CLOSED,
  DisconnectReason.DUPLICATE_IDENTITY,
]);

export function createCallManager(config: CallManagerConfig) {
  const {
    audio,
    api,
    pool,
    tone,
    me,
    bus,
    sys,
    userVolume,
    realtimeStore,
    pex,
    preference,
    drawing,
    persistedValue,
    ensureMediaPermission,
    consumeCrashRecovery,
  } = config;

  const mode = ref<"none" | "dm" | "channel">("none");

  const room = ref<Room | null>(null);
  const createRoom = config.createRoom ?? ((options) => new Room(options));

  // One registry for every key that opens the microphone (push-to-talk, the radio).
  const micHold = createMicHold(sys);

  // Product metrics. Every timestamp below is null while the thing it times is not happening,
  // and is cleared by whoever records the duration, so a call that ends by any route reports once.
  const telemetry = config.telemetry ?? { count() {}, distribution() {} };
  const notify = (notice: CallNotice) => {
    try { config.notify?.(notice); }
    catch (e) { logger.warn("[CALL] notice failed", e); }
  };
  let joinStartedAt: number | null = null;
  let connectedAt: number | null = null;
  let reconnectStartedAt: number | null = null;
  let shareStartedAt: number | null = null;
  let cameraStartedAt: number | null = null;

  /** A DOMException/Error name is a fixed vocabulary; its message is not. */
  function errorName(err: unknown): string {
    const name = (err as { name?: unknown } | null)?.name;
    return typeof name === "string" && name ? name : "unknown";
  }

  /** Report the end of the connected part of a call exactly once, whichever path ended it. */
  function recordCallEnded(reason: string) {
    if (connectedAt === null) return;
    const seconds = (performance.now() - connectedAt) / 1000;
    connectedAt = null;
    telemetry.distribution("call.duration", seconds, "second", { mode: mode.value, reason });
    telemetry.count("call.ended", {
      mode: mode.value,
      reason,
      screenshare: isSharing.value,
      camera: isCameraOn.value,
    });
    if (shareStartedAt !== null) {
      telemetry.distribution("call.screenshare.duration", (performance.now() - shareStartedAt) / 1000, "second");
      shareStartedAt = null;
    }
    if (cameraStartedAt !== null) {
      telemetry.distribution("call.camera.duration", (performance.now() - cameraStartedAt) / 1000, "second");
      cameraStartedAt = null;
    }
  }

  const callId = ref<string | null>(null);
  const targetId = ref<string | null>(null);
  const connectedVoiceChannelId = ref<string | null>(null);
  // Set from the start of a channel join, so moderation events that race the join still match.
  const connectedVoiceSpaceId = ref<string | null>(null);

  // A moderator's mute/deafen on us in that space. Space-wide on the server, so it is kept per
  // connection rather than per channel.
  const serverMuted = ref(false);
  const serverDeafened = ref(false);

  // The virtual input track for this call, and the LiveKit track currently published from it.
  // They differ in lifetime: the SFU unpublishes the mic while we are server-muted, and a new
  // LocalAudioTrack is published from a fresh clone once we may speak again.
  let micSource: MediaStreamTrack | null = null;
  let localMic: LocalAudioTrack | null = null;
  let micPublishing = false;
  let micBitrateKbps: number | null = null;
  // The room's name as the SDK reports it (`{spaceId}/{channelId}`); a move changes it in place.
  let joinedRoomName: string | null = null;

  let voiceStateTimer: ReturnType<typeof setTimeout> | null = null;

  // Persisted across renderer reloads (localStorage) so we can auto-rejoin the
  // channel after a renderer crash. Empty string = not in a voice channel;
  // cleared on an explicit leave(). See maybeRecoverVoiceAfterCrash().
  const lastVoiceServerId = persistedValue("argon:lastVoiceServerId", "");
  const lastVoiceChannelId = persistedValue("argon:lastVoiceChannelId", "");

  const isConnecting = ref(false);
  const isConnected = ref(false);
  const isReconnecting = ref(false);

  const diagnostics = reactive(new Map<string, any>());
  let rtcTimer: ReturnType<typeof setInterval> | null = null;

  function startRtcDiagnostics() {
    if (rtcTimer) clearInterval(rtcTimer);
    rtcTimer = setInterval(updateRtcStats, 1000);
  }

  function stopRtcDiagnostics() {
    if (rtcTimer) clearInterval(rtcTimer);
    rtcTimer = null;
  }

  const participants = reactive<
    Record<
      string,
      {
        userId: string;
        displayName: string;
        muted: boolean;
        mutedAll: boolean;
        screencast: boolean;
        volume: number[];
        audioGraph: RemoteAudioGraph | null;
        /** Separate graph for the user's screen-share (desktop) audio track */
        screenAudioGraph: RemoteAudioGraph | null;
        /** Raw PlayFrame activity presence attribute (JSON string) if running a game */
        pfActivity?: string;
      }
    >
  >({});

  // key = "userId:source" e.g. "abc:camera", "abc:screen_share"
  const videoTracks = reactive(new Map<string, RemoteTrack | LocalVideoTrack>());

  // Same keys as videoTracks. Under adaptive streaming the SFU stops sending a track
  // whose tile is off-screen or hidden, which freezes the last frame — the UI marks
  // those tiles instead of leaving them looking broken.
  const pausedVideoTracks = reactive(new Set<string>());

  // Videos the local user chose not to receive at all (per tile), and per-tile caps on
  // the quality we ask the SFU for. Both are viewer-side only — nothing is signalled to
  // the publisher, and neither survives a reconnect.
  const hiddenVideoTracks = reactive(new Set<string>());
  const videoQualityOverrides = reactive(new Map<string, VideoQuality>());

  /** Server-reported connection quality per participant, including ourselves. */
  const participantQuality = reactive(new Map<string, ConnectionQuality>());

  /** Tracks the SFU refused to give us, keyed by user id, with a readable reason. */
  const subscriptionErrors = reactive(new Map<string, string>());

  /** Loudest participant per the server's own detection (not our local VU meter). */
  const activeSpeakerId = ref<string | null>(null);

  function videoTrackKey(uid: string, source: string) {
    return `${uid}:${source}`;
  }

  /** All track entries for a given user (camera + screen_share, etc.) */
  function getVideoTracksForUser(uid: string) {
    const result: { source: string; track: RemoteTrack | LocalVideoTrack }[] = [];
    for (const [key, track] of videoTracks) {
      if (key.startsWith(uid + ":")) {
        result.push({ source: key.split(":")[1], track: track as RemoteTrack | LocalVideoTrack });
      }
    }
    return result;
  }

  /** Check if user has any video track */
  function hasVideoTrack(uid: string) {
    for (const key of videoTracks.keys()) {
      if (key.startsWith(uid + ":")) return true;
    }
    return false;
  }

  /** Delete all video tracks for a user */
  function deleteVideoTracksForUser(uid: string) {
    for (const key of [...videoTracks.keys()]) {
      if (!key.startsWith(uid + ":")) continue;
      try { videoTracks.get(key)?.detach(); } catch { /* already detached */ }
      videoTracks.delete(key);
    }
    for (const key of [...pausedVideoTracks]) {
      if (key.startsWith(uid + ":")) pausedVideoTracks.delete(key);
    }
    for (const key of [...hiddenVideoTracks]) {
      if (key.startsWith(uid + ":")) hiddenVideoTracks.delete(key);
    }
    for (const key of [...videoQualityOverrides.keys()]) {
      if (key.startsWith(uid + ":")) videoQualityOverrides.delete(key);
    }
  }

  /** Whether the SFU has paused delivery of this user's video (adaptive streaming). */
  function isVideoPaused(uid: string, source: string) {
    return pausedVideoTracks.has(videoTrackKey(uid, source));
  }

  /** Whether the local user has switched this tile's video off. */
  function isVideoHidden(uid: string, source: string) {
    return hiddenVideoTracks.has(videoTrackKey(uid, source));
  }

  function videoQualityOf(uid: string, source: string) {
    return videoQualityOverrides.get(videoTrackKey(uid, source)) ?? VideoQuality.HIGH;
  }

  /** The remote publication behind a tile, if that participant is still in the room. */
  function publicationFor(uid: string, source: string) {
    const p = room.value?.remoteParticipants.get(uid);
    return p?.getTrackPublication(source as Track.Source);
  }

  /**
   * Stop (or resume) receiving a specific tile's video. Unlike the adaptive pause this
   * is deliberate and sticky: the SFU sends nothing at all until it's switched back on.
   */
  function setVideoHidden(uid: string, source: string, hidden: boolean) {
    const pub = publicationFor(uid, source);
    if (!pub) return;
    pub.setEnabled(!hidden);
    const key = videoTrackKey(uid, source);
    if (hidden) hiddenVideoTracks.add(key);
    else hiddenVideoTracks.delete(key);
  }

  /**
   * Cap the quality we ask for on one tile. Adaptive streaming still applies on top —
   * LiveKit takes whichever of the two is smaller — so this can only ask for less.
   */
  function setVideoQuality(uid: string, source: string, quality: VideoQuality) {
    const pub = publicationFor(uid, source);
    if (!pub) return;
    pub.setVideoQuality(quality);
    videoQualityOverrides.set(videoTrackKey(uid, source), quality);
  }

  const speaking = reactive(new Set<string>());

  const incoming = ref<CallIncoming | null>(null);

  const isSharing = ref(false);
  let screenTrackPub: any = null;
  let screenAudioTrackPub: any = null;
  // Last options used to start the active share — lets us restart the capture
  // (e.g. to add system audio mid-share) against the same source without a re-prompt.
  const lastShareOpts = ref<ScreenShareOpts | null>(null);
  // Reflects whether the active (or next) share forwards system/desktop audio.
  const systemAudioEnabled = ref(false);

  const isCameraOn = ref(false);
  let cameraTrackPub: any = null;

  const isCpuConstrained = ref(false);
  // Whether the live room was created with adaptive streaming on. LiveKit fixes both
  // adaptiveStream and dynacast at construction, so flipping the preference mid-call
  // can't take effect until we build the next Room — adaptiveSettingPending says so.
  const adaptiveStreamActive = ref(false);
  const adaptiveSettingPending = computed(
    () =>
      isConnected.value &&
      adaptiveStreamActive.value !== preference.adaptiveVideoQuality,
  );
  // Server-reported quality for our own participant: derived from real packet loss and
  // jitter, unlike a bare RTT reading. Falls back to ping until the first report lands.
  const networkQuality = ref<ConnectionQuality>(ConnectionQuality.Unknown);
  // Browsers block audio (and video) until the page has been interacted with. Under
  // webAudioMix that shows up as a silent call rather than an error, so surface it and
  // let the user unblock it with a click.
  const audioPlaybackBlocked = ref(false);
  const videoPlaybackBlocked = ref(false);
  const playbackBlocked = computed(
    () => audioPlaybackBlocked.value || videoPlaybackBlocked.value,
  );
  const audioDeviceError = ref<{ type: 'not-found' | 'not-readable'; message: string } | null>(null);
  // Set when joining voice fails at the system level (LiveKit connect or mic publish).
  // Surfaced as a "system failure" popup; cleared on leave() and on a new attempt.
  const connectError = ref<{ message: string } | null>(null);
  let cpuConstrainedResetTimer: ReturnType<typeof setTimeout> | null = null;

  const ping = ref(-1);

  // Ping history for graph (last 10 minutes, 1 sample per second)
  const pingHistory = reactive<Array<{ timestamp: number; value: number }>>([]);
  const maxPingHistorySize = 600; // 10 minutes * 60 seconds

  const averagePing = computed(() => {
    if (pingHistory.length === 0) return -1;
    const sum = pingHistory.reduce((acc, item) => acc + item.value, 0);
    return Math.round(sum / pingHistory.length);
  });

  const interval = reactive({
    sec: 0,
    min: 0,
    hor: 0,
    day: 0,
  });
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let intervalTimer: ReturnType<typeof startTimer> | null = null;

  let disposables = new DisposableBag();

  // Teardown handles for the remote playback graphs, by user id. They are enrolled in
  // `disposables` too, for leave(); but a graph that goes away mid-call (track unsubscribed,
  // participant gone) has to be released through its handle: unsubscribing takes it out of the
  // bag and leaves it inert, which is what stops the bag growing with every join and leave and
  // stops leave() disposing the same graph a second time. Kept out of the reactive
  // `participants` record on purpose — Vue would hand back a proxy, and rxjs detaches a child
  // from its parent by identity, so a proxied handle would never leave the bag.
  const audioGraphSubs = new Map<string, Subscription>();
  const screenAudioGraphSubs = new Map<string, Subscription>();

  /** Dispose one participant's playback graph exactly once, whichever path gets there first. */
  function releaseAudioGraph(uid: string, kind: "mic" | "screen") {
    const subs = kind === "mic" ? audioGraphSubs : screenAudioGraphSubs;
    const sub = subs.get(uid);
    if (!sub) return;
    subs.delete(uid);
    sub.unsubscribe();
  }

  const qualityConnection = computed(() => {
    if (!isConnected.value) return "NONE";

    switch (networkQuality.value) {
      case ConnectionQuality.Excellent:
        return "GREEN";
      case ConnectionQuality.Good:
        return "ORANGE";
      case ConnectionQuality.Poor:
      case ConnectionQuality.Lost:
        return "RED";
    }

    // Nothing reported yet (first seconds of a call) — fall back to signalling RTT.
    if (ping.value < 0) return "NONE";
    if (ping.value < 50) return "GREEN";
    if (ping.value < 100) return "ORANGE";
    return "RED";
  });

  /**
   * Retry output after the browser blocked it. Resumes our own AudioContext (the remote
   * graphs hang off it) and then lets LiveKit unblock its own elements. Must be called
   * from a user gesture.
   */
  async function unblockPlayback() {
    const r = room.value;
    try {
      const ctx = audio.getCurrentAudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      if (r) {
        await r.startAudio();
        await r.startVideo();
      }
      audioPlaybackBlocked.value = r ? !r.canPlaybackAudio : false;
      videoPlaybackBlocked.value = r ? !r.canPlaybackVideo : false;
    } catch (err) {
      logger.error("[CALL] failed to unblock playback", err);
    }
  }

  /** Human-readable reason for a refused track subscription. */
  function describeSubscriptionError(reason?: SubscriptionError) {
    switch (reason) {
      case SubscriptionError.SE_CODEC_UNSUPPORTED:
        return "codec not supported by this device";
      case SubscriptionError.SE_TRACK_NOTFOUND:
        return "track no longer exists";
      default:
        return "subscription refused";
    }
  }

  async function leave() {
    logger.info("[CALL] leave()");
    recordCallEnded("leave");
    // The room's listeners go with it below, so its "disconnected" handler will not run: clear the
    // reconnect clock here, or a leave mid-reconnect would time the next call's reconnect from now.
    reconnectStartedAt = null;

    // A share's drawing session is a native overlay window that nothing below tears down:
    // stopScreenShare() ends it, but a leave() mid-share never went through there and the
    // window outlived the call. The share's tracks need no round trip of their own —
    // disconnect() unpublishes and stops every local track (stopLocalTrackOnUnpublish is on
    // by default).
    if (isSharing.value) {
      try { drawing.endStreamerSession(); }
      catch (e) { logger.warn("[CALL] endStreamerSession failed", e); }
    }

    // The radio goes with the room: its token is bound to our voice slot in HQ.
    resetRadio();

    try {
      if (room.value) {
        room.value.removeAllListeners();
        room.value.disconnect();
      }
    } catch (err) {
      logger.error("[CALL] leave error", err);
    }

    room.value = null;

    mode.value = "none";
    callId.value = null;
    targetId.value = null;
    connectedVoiceChannelId.value = null;
    connectedVoiceSpaceId.value = null;
    if (voiceStateTimer) {
      clearTimeout(voiceStateTimer);
      voiceStateTimer = null;
    }
    micSource = null;
    localMic = null;
    micPublishing = false;
    micBitrateKbps = null;
    joinedRoomName = null;
    // The restriction belongs to the space we were talking in; outside a call nothing is locked.
    applyServerRestriction(0, false);
    // Explicit leave → don't auto-rejoin if the renderer later crashes/reloads.
    lastVoiceServerId.value = "";
    lastVoiceChannelId.value = "";

    isConnecting.value = false;
    isConnected.value = false;
    isReconnecting.value = false;

    Object.keys(participants).forEach((key) => delete participants[key]);
    for (const track of videoTracks.values()) {
      try { track.detach(); } catch { /* already detached */ }
    }
    videoTracks.clear();
    pausedVideoTracks.clear();
    hiddenVideoTracks.clear();
    videoQualityOverrides.clear();
    diagnostics.clear();
    participantQuality.clear();
    subscriptionErrors.clear();
    activeSpeakerId.value = null;
    speaking.clear();
    incoming.value = null;
    networkQuality.value = ConnectionQuality.Unknown;
    audioPlaybackBlocked.value = false;
    videoPlaybackBlocked.value = false;

    stopTimerRTT();
    ping.value = -1;
    disposables.dispose();
    // Every graph handle still open sat in the bag and is closed now; drop the dead ones.
    audioGraphSubs.clear();
    screenAudioGraphSubs.clear();

    // Release the mic held for this call (detaches the device on macOS when idle).
    audio.releaseInput();

    isSharing.value = false;
    screenTrackPub = null;
    // Otherwise stopScreenShare() in the next call would unpublish a publication from a room
    // that no longer exists, and toggleSystemAudio() would restart a share that isn't there.
    screenAudioTrackPub = null;
    lastShareOpts.value = null;
    systemAudioEnabled.value = false;

    isCameraOn.value = false;
    cameraTrackPub = null;

    isCpuConstrained.value = false;
    audioDeviceError.value = null;
    connectError.value = null;
    if (cpuConstrainedResetTimer) {
      clearTimeout(cpuConstrainedResetTimer);
      cpuConstrainedResetTimer = null;
    }

    tone.playSoftLeaveSound();
  }

  async function startDirectCall(peerUserId: string) {
    logger.info("[CALL] startDirectCall", peerUserId);

    if (isConnected.value) await leave();

    mode.value = "dm";

    const res = await api.callInteraction.DingDongCreep(peerUserId);

    if (!res || !res.isSuccessDingDong()) {
      logger.error("DingDongCreep failed", res);
      telemetry.count("call.join", { mode: "dm", result: "failed", stage: "signal" });
      mode.value = "none";
      return;
    }
    telemetry.count("call.dm.outgoing");

    callId.value = res.callId;
    targetId.value = peerUserId;

    await joinLiveKit({
      token: res.token,
      callId: res.callId,
      selfId: me.me!.userId,
      rts: res.rtc,
    });

    startTimersRTT();
  }

  function handleIncoming(ev: CallIncoming) {
    logger.info("[CALL] incoming call", ev);

    if (mode.value === "channel") {
      telemetry.count("call.dm.incoming", { busy: true });
      api.callInteraction.RejectCall(ev.callId);
      return;
    }
    telemetry.count("call.dm.incoming", { busy: false });
    tone.playRingSound();
    incoming.value = ev;
  }

  async function acceptIncomingCall() {
    if (!incoming.value) return;
    tone.stopPlayRingSound();

    const ev = incoming.value;

    const res = await api.callInteraction.PickUpCall(ev.callId);

    if (!res || !res.isSuccessPickUp()) {
      logger.error("PickUpCall failed", res);
      telemetry.count("call.join", { mode: "dm", result: "failed", stage: "pickup" });
      return;
    }
    telemetry.count("call.dm.accepted");

    incoming.value = null;
    mode.value = "dm";
    callId.value = res.callId;
    targetId.value = ev.fromId;

    await joinLiveKit({
      token: res.token,
      callId: res.callId,
      selfId: me.me!.userId,
      rts: res.rtc,
    });

    startTimersRTT();
  }

  async function rejectIncomingCall() {
    if (incoming.value) {
      telemetry.count("call.dm.rejected");
      tone.stopPlayRingSound();
      await api.callInteraction.RejectCall(incoming.value.callId);
    }
    incoming.value = null;
  }

  /**
   * Join a voice channel. `spaceId` defaults to the space on screen; a rejoin names its own, since
   * the user may be looking at a different space by then.
   */
  async function joinVoiceChannel(channelId: string, spaceId?: string) {
    await joinChannel(channelId, spaceId);
  }

  /** Whether we may do `permission` in a channel; space-level when the host cannot tell per channel. */
  function canInChannel(channelId: string, permission: string, spaceId?: string | null) {
    return pex.hasIn ? pex.hasIn(channelId, permission, spaceId) : pex.has(permission);
  }

  /** Whether the channel call we are in allows `permission` (always true outside one). */
  function canInCurrentChannel(permission: string) {
    const channelId = connectedVoiceChannelId.value;
    if (mode.value !== "channel" || !channelId) return true;
    return canInChannel(channelId, permission, connectedVoiceSpaceId.value);
  }

  async function joinChannel(channelId: string, spaceId: string | undefined) {
    logger.info("[CALL] joinVoiceChannel", channelId);

    const selected = spaceId ?? pool.selectedServer;

    if (!canInChannel(channelId, "Connect", selected)) {
      logger.warn("[CALL] No Connect permission");
      telemetry.count("call.join", { mode: "channel", result: "refused", reason: "no_permission" });
      return;
    }

    if (mode.value === "dm") await leave();

    mode.value = "channel";

    if (!selected) {
      logger.error("selectedServer = null");
      telemetry.count("call.join", { mode: "channel", result: "refused", reason: "no_space" });
      mode.value = "none";
      return;
    }

    // Before Interlink: the server reports an existing restriction right after the join, and that
    // event can beat the Interlink reply. Starting from "none" drops one from a previous visit.
    connectedVoiceSpaceId.value = String(selected);
    applyServerRestriction(0, false);

    const join = await api.channelInteraction.Interlink(selected, channelId);

    if (!join || !join.isSuccessJoinVoice()) {
      logger.error("Interlink failed", join);
      telemetry.count("call.join", { mode: "channel", result: "failed", stage: "interlink" });
      mode.value = "none";
      connectedVoiceSpaceId.value = null;
      if (join?.isFailedJoinVoice?.() && join.error === JOIN_ERROR_INSUFFICIENT_PERMISSIONS) {
        notify({ kind: "join-refused", reason: "insufficient_permissions" });
      }
      return;
    }

    callId.value = `channel-${channelId}`;
    targetId.value = channelId;
    connectedVoiceChannelId.value = channelId;
    // Remember where we are so a crash-triggered reload can rejoin (see below).
    lastVoiceServerId.value = String(selected);
    lastVoiceChannelId.value = channelId;

    // Read here, at join, because that is when the microphone track is published with it.
    const audioBitrateKbps = await channelBitrate(channelId);

    await joinLiveKit({
      token: join.token,
      callId: callId.value!,
      selfId: me.me!.userId,
      rts: join.rtc,
      audioBitrateKbps,
    });

    startTimersRTT();

    if (isConnected.value && connectedVoiceChannelId.value === channelId) {
      scheduleVoiceStateReport();
      void refetchRadioLinks();
    }
  }

  /** Report our own flags to the server, collapsed over a short window. */
  function scheduleVoiceStateReport() {
    if (mode.value !== "channel" || !connectedVoiceChannelId.value) return;
    if (voiceStateTimer) clearTimeout(voiceStateTimer);
    voiceStateTimer = setTimeout(() => {
      voiceStateTimer = null;
      void reportVoiceState();
    }, VOICE_STATE_DEBOUNCE_MS);
  }

  async function reportVoiceState() {
    const spaceId = connectedVoiceSpaceId.value;
    const channelId = connectedVoiceChannelId.value;
    if (mode.value !== "channel" || !spaceId || !channelId) return;
    const state = encodeSelfVoiceState({
      muted: sys.microphoneMuted,
      deafened: sys.headphoneMuted,
      streaming: isSharing.value,
    });
    try {
      await api.channelInteraction.UpdateVoiceState(spaceId, channelId, state);
    } catch (e) {
      logger.warn("[CALL] UpdateVoiceState failed", e);
    }
  }

  /**
   * Take the moderation bits of our own state. `announce` is false for resets (join, leave),
   * which the user did not experience as a moderator acting on them.
   */
  function applyServerRestriction(state: number, announce: boolean) {
    const flags = decodeVoiceState(state);
    const wasMuted = serverMuted.value;
    const wasDeafened = serverDeafened.value;
    serverMuted.value = flags.serverMuted;
    serverDeafened.value = flags.serverDeafened;
    sys.setServerVoiceRestriction({ muted: flags.serverMuted, deafened: flags.serverDeafened });

    if (announce) {
      if (wasDeafened !== flags.serverDeafened) notify({ kind: flags.serverDeafened ? "server-deafened" : "server-undeafened" });
      if (wasMuted !== flags.serverMuted) notify({ kind: flags.serverMuted ? "server-muted" : "server-unmuted" });
    }

    const restricted = flags.serverMuted || flags.serverDeafened;
    if (!restricted) void ensureMicrophonePublished();
    // The server revokes the radio with the restriction and refuses links while it holds; once it
    // is lifted the links have to be asked for again.
    if (restricted) closeRadio("server_restricted");
    else if (announce && (wasMuted || wasDeafened)) void refetchRadioLinks();
  }

  function onVoiceMemberStateChanged(ev: VoiceMemberStateChanged) {
    if (ev.userId !== me.me?.userId) return;
    if (mode.value !== "channel" || String(ev.spaceId) !== connectedVoiceSpaceId.value) return;
    applyServerRestriction(Number(ev.state), true);
  }

  /**
   * The SFU moved us to another room: a moderator's move, done server-side. The connection and
   * our published tracks carry over; the SDK has already disconnected the old room's participants
   * and announces the new ones right after this. Ours to move: which channel we are in, and
   * everything that hangs off it.
   */
  function onRoomMoved(name: string) {
    const target = parseVoiceRoomName(name);
    if (mode.value !== "channel" || !target) {
      logger.error("[CALL] moved to a room we cannot place", { name, mode: mode.value });
      telemetry.count("call.moved", { result: "failed", error: target ? "not_a_channel_call" : "bad_room_name" });
      void leave();
      return;
    }

    logger.info("[CALL] moved by the server", { from: connectedVoiceChannelId.value, to: target.channelId });
    joinedRoomName = name;
    connectedVoiceSpaceId.value = target.spaceId;
    connectedVoiceChannelId.value = target.channelId;
    callId.value = `channel-${target.channelId}`;
    targetId.value = target.channelId;
    lastVoiceServerId.value = target.spaceId;
    lastVoiceChannelId.value = target.channelId;

    // Already gone through participantDisconnected; whatever is still here missed its event.
    for (const uid of Object.keys(participants)) forgetParticipant(uid);
    activeSpeakerId.value = null;

    // The radio was the old channel's: its graphs, ducking and links go, and the new channel's
    // are asked for. The room stays, so a transmission in flight clears its on-air flag.
    resetRadio({ roomGoing: false });
    void refetchRadioLinks();
    // The microphone cap is per room; the destination's publish rights come from the server.
    void applyChannelBitrate(target.channelId);
    scheduleVoiceStateReport();

    tone.playSoftEnterSound();
    telemetry.count("call.moved", { result: "ok" });
    notify({ kind: "moved", spaceId: target.spaceId, channelId: target.channelId });
  }

  /** The SDK renames the room before it disconnects the old room's participants on a move. */
  function roomIsMoving(r: Room) {
    return joinedRoomName !== null && !!r.name && r.name !== joinedRoomName;
  }

  /** The channel's own microphone cap, when a moderator set one; null keeps the SDK preset. */
  async function channelBitrate(channelId: string): Promise<number | null> {
    const channel = await pool.getChannel?.(channelId).catch(() => null);
    return channel?.bitrate ?? null;
  }

  /** Re-tune a published microphone to a channel's cap; the next publish picks it up as well. */
  async function applyChannelBitrate(channelId: string) {
    const kbps = await channelBitrate(channelId);
    if (connectedVoiceChannelId.value !== channelId) return;
    micBitrateKbps = kbps;
    const sender = localMic?.sender;
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      for (const encoding of params.encodings) {
        encoding.maxBitrate = kbps ? kbps * 1000 : AudioPresets.musicStereo.maxBitrate;
      }
      await sender.setParameters(params);
    } catch (e) {
      logger.warn("[CALL] microphone bitrate update failed", e);
    }
  }

  // After a renderer crash the Electron host reloads the page and flags the load
  // as a crash recovery. If we were in a voice channel when it happened (persisted
  // across the reload), rejoin it automatically. This fires ONLY on a real crash —
  // the host hands out the flag exactly once, so a normal restart never rejoins.
  // We wait until the user is back in the same server before rejoining so the
  // Interlink call targets the right place.
  async function maybeRecoverVoiceAfterCrash() {
    try {
      const recovered = await consumeCrashRecovery();
      if (!recovered) return;

      const serverId = lastVoiceServerId.value;
      const channelId = lastVoiceChannelId.value;
      if (!serverId || !channelId) return;

      logger.warn("[CALL] crash recovery — will rejoin voice", { serverId, channelId });
      telemetry.count("call.crash_recovery");

      const rejoin = async (): Promise<boolean> => {
        if (String(pool.selectedServer ?? "") !== serverId) return false;
        await joinVoiceChannel(channelId);
        return true;
      };

      if (await rejoin()) return;

      // Server not active yet (auth + server list still loading post-reload) —
      // rejoin as soon as we're back in it, then stop watching.
      const stop = watch(
        () => pool.selectedServer,
        () => {
          void rejoin().then((done) => {
            if (done) stop();
          });
        },
      );
      // Don't watch forever if the user never returns to that server.
      setTimeout(() => stop(), 60_000);
    } catch (e) {
      logger.error("[CALL] crash recovery failed", e);
    }
  }

  function startTimersRTT() {
    startRtcDiagnostics();
    if (pingTimer) clearInterval(pingTimer);
    if (intervalTimer) intervalTimer();

    pingTimer = setInterval(() => {
      try {
        const currentPing = room.value?.engine?.client?.rtt ?? -1;
        ping.value = currentPing;

        // Add to history every second (skip if same timestamp)
        const now = Date.now();
        if (
          currentPing >= 0 &&
          (pingHistory.length === 0 ||
            now - pingHistory[pingHistory.length - 1].timestamp >= 1000)
        ) {
          pingHistory.push({ timestamp: now, value: currentPing });

          // Keep only last 10 minutes
          if (pingHistory.length > maxPingHistorySize) {
            pingHistory.shift();
          }
        }
      } catch {
        ping.value = -1;
      }
    }, 500);

    intervalTimer = startTimer((t) => {
      const { days, hours, minutes, seconds } = t;
      interval.day = days;
      interval.hor = hours;
      interval.min = minutes;
      interval.sec = seconds;
    });
  }

  function stopTimerRTT() {
    stopRtcDiagnostics();
    if (pingTimer) clearInterval(pingTimer);
    if (intervalTimer) intervalTimer();
    pingHistory.length = 0; // Clear history
  }

  // Participants whose LiveKit listeners are already attached. addParticipant runs for the
  // same participant more than once — participantConnected plus the post-connect sweep, and
  // after a full reconnect the SDK hands back the very same objects — and every pass used to
  // stack another set of handlers on them.
  const boundParticipants = new WeakSet<RemoteParticipant>();

  async function addParticipant(p: RemoteParticipant) {
    const uid = p.identity;

    // Already known: the state below is refreshed, the listeners are not attached again.
    if (participants[uid]) {
      logger.warn(`[CALL] Participant ${uid} already exists, updating state`);
    }

    // Check if this is a guest user (GUID starts with ccccfcfa)
    const isGuest =
      uid.toLowerCase().startsWith("ccccfcfa") ||
      uid.toLowerCase().startsWith("guest-");

    let displayName: string;
    if (isGuest) {
      // For guest users, use name from LiveKit participant metadata or default
      displayName = p.name || p.metadata || `Guest ${uid.substring(0, 8)}`;
      logger.info(
        `[CALL] Adding guest participant ${uid} with name: ${displayName}`,
      );
    } else {
      // For regular users, fetch from pool
      const info = await pool.getUser(uid);
      displayName = info?.displayName ?? "Unknown User";
    }

    const savedVolume = userVolume.getUserVolume(uid);

    // Read initial muted state from tracks
    const audioPub = Array.from(p.trackPublications.values()).find(
      (t) => t.kind === Track.Kind.Audio,
    );

    // Check both publication and actual track if subscribed
    let isInitiallyMuted = audioPub?.isMuted ?? false;
    if (audioPub?.track) {
      isInitiallyMuted = audioPub.track.isMuted;
    }

    logger.info(`[CALL] Reading initial mute state for ${uid}:`, {
      pubMuted: audioPub?.isMuted,
      trackMuted: audioPub?.track?.isMuted,
      finalMuted: isInitiallyMuted,
    });

    // Read initial attributes
    const isInitiallyMutedAll = p.attributes?.isMutedAll === "true";
    const isInitiallyScreencast = p.attributes?.isScreencast === "true";

    logger.info(`[CALL] Adding participant ${uid}:`, {
      isGuest,
      muted: isInitiallyMuted,
      mutedAll: isInitiallyMutedAll,
      screencast: isInitiallyScreencast,
      attributes: p.attributes,
      displayName,
    });

    // Carry over any graphs a trackSubscribed handler already attached: this runs after
    // an await too, so a track can arrive first, and dropping the reference here would
    // orphan a connected graph and silence the participant.
    const existing = participants[uid];

    participants[uid] = {
      userId: uid,
      displayName,
      muted: isInitiallyMuted,
      volume: [savedVolume],
      audioGraph: existing?.audioGraph ?? null,
      screenAudioGraph: existing?.screenAudioGraph ?? null,
      mutedAll: isInitiallyMutedAll,
      screencast: isInitiallyScreencast,
      pfActivity: p.attributes?.pfActivity || undefined,
    };

    // Add guest user to realtime channel if in channel mode
    if (isGuest && mode.value === "channel" && connectedVoiceChannelId.value) {
      // Create a mock user object for guest
      const guestUser = {
        userId: uid,
        displayName,
        username: `guest_${uid.substring(0, 8)}`,
        avatarFileId: null, // Will use default guest avatar
        status: 0,
        activity: undefined,
      };
      pool._realtimeStore.addUserToChannel(
        connectedVoiceChannelId.value,
        uid,
        guestUser as any,
      );
      logger.info(
        `[CALL] Added guest ${uid} to realtime channel ${connectedVoiceChannelId.value}`,
      );
    }

    const isMutedAll = sys.headphoneMuted;

    if (isMutedAll) {
      setVolume(uid, 0);
    } else {
      setVolume(uid, savedVolume);
    }

    // Setup event listeners for this participant — once per participant object.
    if (boundParticipants.has(p)) return;
    boundParticipants.add(p);

    p.on("trackMuted", (pub) => {
      if (pub.kind === Track.Kind.Audio) {
        const pm = participants[uid];
        if (pm) {
          pm.muted = true;
          logger.info(`[MUTE] ${uid} muted microphone`);
        }
      }
    });

    p.on("trackUnmuted", (pub) => {
      if (pub.kind === Track.Kind.Audio) {
        const pm = participants[uid];
        if (pm) {
          pm.muted = false;
          logger.info(`[MUTE] ${uid} unmuted microphone`);
        }
      }
    });

    p.setAudioContext(audio.getCurrentAudioContext());

    p.on("attributesChanged", (x) => {
      logger.info("attributesChanged", uid, x);
      const pm = participants[uid];
      if (pm) {
        pm.mutedAll = x.isMutedAll === "true";
        pm.screencast = x.isScreencast === "true";
        // PlayFrame presence: only update when the key is part of this change set
        if ("pfActivity" in x) {
          pm.pfActivity = x.pfActivity || undefined;
        }
        logger.info(
          `[ATTRIBUTES] ${uid} mutedAll=${pm.mutedAll} screencast=${pm.screencast}`,
        );
      }
    });
  }

  /** Drop everything held for a remote participant: the record, its graphs, its tiles, its stats. */
  function forgetParticipant(uid: string) {
    // Normally already released by the trackUnsubscribed events the SDK fires first; the
    // graphs just must not depend on that ordering.
    releaseAudioGraph(uid, "mic");
    releaseAudioGraph(uid, "screen");
    delete participants[uid];
    speaking.delete(uid);
    deleteVideoTracksForUser(uid);
    diagnostics.delete(uid);
    participantQuality.delete(uid);
    subscriptionErrors.delete(uid);

    // Remove guest user from realtime channel
    const isGuest = uid.toLowerCase().startsWith("fafccccc");
    if (isGuest && mode.value === "channel" && connectedVoiceChannelId.value) {
      pool._realtimeStore.removeUserFromChannel(connectedVoiceChannelId.value, uid);
      logger.info(`[CALL] Removed guest ${uid} from realtime channel`);
    }
  }

  /**
   * Reconcile the realtime channel member list against LiveKit's participant list.
   *
   * LiveKit runs on its own connection and stays authoritative about who is actually
   * in the voice channel even while the realtime stream is down. If the stream
   * drops briefly (VPN switch, network hiccup) we miss JoinedToChannelUser /
   * LeavedFromChannelUser events and the member list goes stale — classic "audible but
   * not shown" desync. Here we trust LiveKit: add anyone it sees but the store is
   * missing, drop anyone the store has but LiveKit doesn't. Known users come from the
   * local cache for free; only genuinely unknown ones cost a single PrefetchUser.
   */
  async function reconcileVoiceMembersFromLiveKit() {
    if (mode.value !== "channel") return;
    const channelId = connectedVoiceChannelId.value;
    const r = room.value;
    if (!channelId || !r) return;

    const rt = realtimeStore.getRealtimeChannel(channelId);
    if (!rt) return;

    const spaceId = rt.Channel.spaceId;

    // Source of truth: self + everyone LiveKit currently sees in the room. Radio participants are
    // forwarded from another room and never members of this one.
    const liveIds = new Set<string>();
    liveIds.add(me.me!.userId);
    for (const id of r.remoteParticipants.keys()) {
      if (!isRadioIdentity(id)) liveIds.add(id);
    }

    // Add LiveKit participants the store is missing
    for (const uid of liveIds) {
      if (rt.Users.has(uid)) continue;

      const isGuest =
        uid.toLowerCase().startsWith("ccccfcfa") ||
        uid.toLowerCase().startsWith("guest-");

      if (isGuest) {
        const rp = r.remoteParticipants.get(uid);
        const displayName =
          rp?.name || rp?.metadata || `Guest ${uid.substring(0, 8)}`;
        realtimeStore.addUserToChannel(channelId, uid, {
          userId: uid,
          displayName,
          username: `guest_${uid.substring(0, 8)}`,
          avatarFileId: null,
        } as any);
        continue;
      }

      // Known user → from cache (free); unknown → single fetch
      let user = await pool.getUser(uid);
      if (!user) {
        try {
          const fetched = await api.serverInteraction.PrefetchUser(spaceId, uid);
          if (fetched) {
            await pool.trackUser(fetched);
            user = fetched as any;
          }
        } catch (e) {
          logger.error(`[CALL] reconcile: failed to fetch user ${uid}`, e);
        }
      }
      if (user) realtimeStore.addUserToChannel(channelId, uid, user as any);
    }

    // Drop store members LiveKit no longer sees (missed Leaved during the gap)
    for (const uid of [...rt.Users.keys()]) {
      if (!liveIds.has(uid)) realtimeStore.removeUserFromChannel(channelId, uid);
    }
  }

  async function updateRtcStats() {
    if (!room.value) {
      logger.warn("updateRtcStats", "no room defined");
      return;
    }

    for (const [uid, particant] of room.value.remoteParticipants) {
      if (isRadioIdentity(uid)) continue;
      const firstTrack = particant.getTrackPublications().at(0);

      try {
        const rtcStats = await firstTrack?.audioTrack?.getRTCStatsReport();
        const raw = rtcStats?.entries().toArray();
        if (!raw || raw.length === 0) continue;

        const parsed = parseRtcStats(raw);

        // The report above comes from the AUDIO receiver, and a receiver only ever
        // reports its own stats — there is no video inbound-rtp in it. Video has to be
        // read off the video track itself, which is also where LiveKit keeps a rolling
        // bitrate for us.
        const videoPub =
          particant.getTrackPublication(Track.Source.ScreenShare) ??
          particant.getTrackPublication(Track.Source.Camera);
        const videoTrack = videoPub?.videoTrack;
        const videoStats = isRemoteTrack(videoTrack)
          ? await (videoTrack as RemoteVideoTrack).getReceiverStats()
          : undefined;

        const diag = {
          // Audio Inbound RTP
          audioPacketsLost: parsed.inboundAudio?.packetsLost ?? null,
          audioJitter: parsed.inboundAudio?.jitter ?? null,
          audioBytesReceived: parsed.inboundAudio?.bytesReceived ?? null,
          audioLevel: parsed.inboundAudio?.audioLevel ?? null,

          // Video Inbound RTP
          videoPacketsLost: videoStats?.packetsLost ?? null,
          videoJitter: videoStats?.jitter ?? null,
          framesDropped: videoStats?.framesDropped ?? null,

          // Resolution as actually decoded
          width: videoStats?.frameWidth ?? null,
          height: videoStats?.frameHeight ?? null,

          // Codec: the video one when there's video, else whatever the audio side says
          codec: videoStats?.mimeType ?? parsed.codec?.mimeType ?? null,

          // What this participant's video is really costing us right now
          videoBitrateKbps: videoTrack
            ? Math.round(videoTrack.currentBitrate / 1000)
            : null,

          // Candidate Pair (RTT, bitrate)
          rtt: parsed.candidatePair?.currentRoundTripTime ?? null,
          bitrateKbps: parsed.candidatePair?.availableOutgoingBitrate
            ? Math.round(parsed.candidatePair.availableOutgoingBitrate / 1000)
            : null,

          // Transport info
          transportPacketsSent: parsed.transport?.packetsSent ?? null,
          transportPacketsReceived: parsed.transport?.packetsReceived ?? null,

          // Media playout (delay)
          playoutDelay: parsed.playout?.totalPlayoutDelay ?? null,
        };

        diagnostics.set(uid, diag);
      } catch {}
    }
  }


  function formatConnectError(err: unknown): string {
    if (err instanceof Error) {
      return err.name && err.name !== "Error" ? `${err.name}: ${err.message}` : err.message;
    }
    return String(err);
  }

  async function joinLiveKit(opts: {
    token: string;
    callId: string;
    selfId: string;
    rts: RtcEndpoint;
    /** Microphone bitrate cap for this room (kbps); null/undefined publishes with the SDK preset. */
    audioBitrateKbps?: number | null;
  }) {
    if (isConnecting.value) return;

    isConnecting.value = true;
    isConnected.value = false;
    joinStartedAt = performance.now();

    if (room.value) {
      await leave();
      return;
    }

    // adaptiveStream makes the SFU send each video at the size its tile is drawn at and
    // pause it when the tile isn't visible; dynacast then lets publishers drop the layers
    // nobody ended up consuming. Both are read once here — see adaptiveSettingPending.
    const adaptive = preference.adaptiveVideoQuality;
    adaptiveStreamActive.value = adaptive;

    const r = createRoom({
      loggerName: `${callId.value}-room`,
      // 'screen' matches the tile's physical pixels, so a share stays readable on a
      // scaled/HiDPI display instead of being downscaled to CSS pixels.
      adaptiveStream: adaptive ? { pixelDensity: "screen" } : false,
      dynacast: adaptive,
      publishDefaults: {
        // VP9 buys roughly a third off the wire versus the vp8 default at equal quality.
        // It is an SVC codec, so one encode carries every layer instead of simulcast's
        // three — cheaper to publish as well as to receive. Note the SDK pins screen
        // share to L1T3 (vp9 cannot do multiple spatial layers on screen content), so
        // shares adapt by framerate rather than resolution; they still pause outright
        // when nobody is looking, which is where the real saving is.
        videoCodec: "vp9",
        // No vp8 fallback layer: publishing one costs a second encode and doubles
        // upstream, which defeats the point. Everything Chromium-based, Firefox and
        // Safari 16+ decode vp9 — older Safari/iOS would see no video at all.
        backupCodec: false,
      },
      webAudioMix: {
        audioContext: audio.getCurrentAudioContext(),
      },
    }, "call");
    room.value = r;

    // Warm DNS/TLS to the SFU while we spend up to 2s probing TURN below, so
    // connect() lands on an already-open connection. Failures are swallowed by
    // the SDK — this is a hint, never a prerequisite for connect().
    void r.prepareConnection(opts.rts.endpoint, opts.token);

    r.on("participantConnected", async (p: RemoteParticipant) => {
      logger.info(`[CALL] participantConnected event:`, p.identity);
      // A radio participant is not a person in this room: no tile, no lookup, no tone. Its audio
      // is wired when its track arrives; its HQ's settings are fetched now, ahead of it.
      if (isRadioIdentity(p.identity)) {
        prefetchHqSettings(p.attributes?.[RADIO_ATTR.broadcast] || null);
        return;
      }
      await addParticipant(p);
      recomputeRadioBusy();
    });

    r.on("participantDisconnected", (p) => {
      const uid = p.identity;
      if (isRadioIdentity(uid)) {
        releaseRadioGraph(uid);
        return;
      }
      recomputeRadioBusy();
      forgetParticipant(uid);
      // On a move the SDK renames the room, then drops the old room's participants: they did
      // not leave, we did, and the move plays its own tone.
      if (!roomIsMoving(r)) tone.playSoftLeaveSound();
    });
    r.on("participantActive", (p) => {
      if (isRadioIdentity(p.identity)) return;
      tone.playSoftEnterSound();
    });

    // "Busy" for the radio key: another HQ member has `argon.radio=on`.
    r.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
      if (isLocalParticipant(participant) || !(RADIO_ATTR.onAir in changed)) return;
      recomputeRadioBusy();
    });
    r.on("trackSubscribed", onTrackSubscribed);
    r.on("trackUnsubscribed", onTrackUnsubscribed);

    r.on("connectionStateChanged", (st) => {
      isConnected.value = st === "connected";
    });

    r.on(RoomEvent.Moved, (name) => {
      if (toRaw(room.value) === r) onRoomMoved(name);
    });

    r.on(RoomEvent.TrackStreamStateChanged, (pub, state, participant) => {
      if (pub.kind !== Track.Kind.Video) return;
      const key = videoTrackKey(participant.identity, pub.source);
      if (state === Track.StreamState.Paused) pausedVideoTracks.add(key);
      else pausedVideoTracks.delete(key);
    });

    // Reported for every participant, so the UI can point at whose link is bad rather
    // than only showing our own.
    r.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (isRadioIdentity(participant.identity)) return;
      participantQuality.set(participant.identity, quality);
      if (isLocalParticipant(participant)) {
        networkQuality.value = quality;
        telemetry.count("call.quality", { mode: mode.value, quality });
      }
    });

    r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      activeSpeakerId.value = speakers.find((s) => !isRadioIdentity(s.identity))?.identity ?? null;
    });

    r.on(RoomEvent.TrackSubscriptionFailed, (trackSid, participant, reason) => {
      if (isRadioIdentity(participant.identity)) return;
      const message = describeSubscriptionError(reason);
      logger.error(`[CALL] track subscription failed for ${participant.identity}`, {
        trackSid,
        reason,
      });
      subscriptionErrors.set(participant.identity, message);
      telemetry.count("call.track.subscription_failed", {
        reason: reason === undefined ? "unknown" : (SubscriptionError[reason] ?? String(reason)),
      });
    });

    r.on(RoomEvent.TrackSubscribed, (_t, _pub, participant) => {
      subscriptionErrors.delete(participant.identity);
    });

    r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      audioPlaybackBlocked.value = !r.canPlaybackAudio;
      if (audioPlaybackBlocked.value) {
        logger.warn("[CALL] audio playback blocked by the browser");
        telemetry.count("call.playback.blocked", { kind: "audio" });
      }
    });

    r.on(RoomEvent.VideoPlaybackStatusChanged, () => {
      videoPlaybackBlocked.value = !r.canPlaybackVideo;
      if (videoPlaybackBlocked.value) {
        logger.warn("[CALL] video playback blocked by the browser");
        telemetry.count("call.playback.blocked", { kind: "video" });
      }
    });

    r.on("reconnecting", () => {
      isReconnecting.value = true;
      if (reconnectStartedAt === null) {
        reconnectStartedAt = performance.now();
        telemetry.count("call.reconnecting", { mode: mode.value });
      }
    });
    r.on("reconnected", () => {
      isReconnecting.value = false;
      if (reconnectStartedAt !== null) {
        telemetry.distribution("call.reconnect.duration", performance.now() - reconnectStartedAt, "millisecond", { mode: mode.value });
        reconnectStartedAt = null;
      }
      telemetry.count("call.reconnected", { mode: mode.value });
    });

    r.on("disconnected", (reason) => {
      isReconnecting.value = false;
      ping.value = -1;
      stopTimerRTT();
      // A disconnect the user did not ask for (leave() has already recorded its own). Recorded
      // here, before leave() runs, so the reason survives: leave() only knows that it was called.
      const why = reason === undefined ? "unknown" : (DisconnectReason[reason] ?? String(reason));
      if (connectedAt !== null) {
        telemetry.count("call.disconnected", { mode: mode.value, reason: why, reconnecting: reconnectStartedAt !== null });
        recordCallEnded(why);
      }
      reconnectStartedAt = null;

      // Our own leave() and moves drop these listeners before disconnecting, so this is the server
      // ending the call. Clean up as a leave would, or the app keeps showing a dead room.
      if (toRaw(room.value) === r && reason !== undefined && SERVER_SIDE_REMOVALS.has(reason)) {
        logger.warn(`[CALL] removed from the room by the server (${why})`);
        void leave();
      }
    });

    // The SFU unpublishes our mic when a moderator mutes us, and restores nothing when they lift
    // it: that is on us, once the permissions allow the microphone again.
    r.on(RoomEvent.LocalTrackUnpublished, (pub) => {
      if (pub.source === Track.Source.Microphone && (!pub.track || toRaw(pub.track) === localMic)) {
        logger.info("[CALL] microphone unpublished by the server");
        localMic = null;
      }
    });
    r.on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
      if (participant && isLocalParticipant(participant)) void ensureMicrophonePublished();
    });

    r.localParticipant.on("localTrackCpuConstrained", () => {
      logger.warn("[CALL] Local track CPU constrained — performance degradation");
      telemetry.count("call.cpu_constrained", { mode: mode.value, screenshare: isSharing.value, camera: isCameraOn.value });
      isCpuConstrained.value = true;
      if (cpuConstrainedResetTimer) clearTimeout(cpuConstrainedResetTimer);
      cpuConstrainedResetTimer = setTimeout(() => {
        isCpuConstrained.value = false;
        cpuConstrainedResetTimer = null;
      }, 10_000);
    });

    try {
      await connectRoom(r, opts.rts, opts.token, {
        // How often the relay path is actually there when a call needs it.
        onTurnProbed: ({ total, alive }) =>
          telemetry.count("call.turn.probe", {
            result: total === 0 ? "none" : alive === 0 ? "all_dead" : alive < total ? "partial" : "ok",
          }),
      });
    } catch (err) {
      logger.error("LiveKit connect failed", err);
      telemetry.count("call.join", { mode: mode.value, result: "failed", stage: "connect", error: errorName(err) });
      await leave();
      connectError.value = { message: formatConnectError(err) };
      return;
    }
    joinedRoomName = r.name || null;

    try {
      // Prompt for mic access before capturing (macOS native host only — elsewhere a no-op).
      await ensureMediaPermission("microphone");

      // Use virtual input stream from AudioManager - it already handles:
      // - Device selection & switching
      // - Input volume control via inputGainNode
      // - Audio processing chain
      // acquireInput() holds the real mic for the lifetime of the call; leave() releases it.
      const virtualStream = await audio.acquireInput();
      const virtualTrack = virtualStream.getAudioTracks()[0];

      if (!virtualTrack) {
        throw new Error("No audio track in virtual input stream");
      }

      micSource = virtualTrack;
      micBitrateKbps = opts.audioBitrateKbps ?? null;

      logger.info(
        `[CALL] Publishing virtual mic track with initial state: micMuted=${sys.microphoneMuted}, headphoneMuted=${sys.headphoneMuted}`,
      );

      // Refused while a moderator has us muted (the token leaves the microphone out); the
      // permissions event publishes it later.
      await publishMicrophone(r);

      // Setup speaking detector using VU meter from AudioManager (runs in AudioWorklet thread)
      disposables.addSubscription(
        await setupLocalSpeakingDetector(opts.selfId),
      );

      // Set initial attributes for local participant IMMEDIATELY after mute
      await r.localParticipant.setAttributes({
        isMutedAll: sys.headphoneMuted ? "true" : "false",
        isScreencast: "false",
      });

      logger.info(
        `[CALL] Local participant joined with mic ${localMic ? `muted=${localMic.isMuted}` : "not published"}, attributes set`,
      );

      const mutedSub = sys.muteEvent.subscribe((x) => {
        if (localMic) {
          if (x) localMic.mute();
          else localMic.unmute();
        }
        scheduleVoiceStateReport();
      });

      const mutedAllSub = sys.muteHeadphoneEvent.subscribe((x) => {
        r.localParticipant.setAttributes({
          isMutedAll: x ? "true" : "false",
          isScreencast: "false",
        });

        applyMuteAllToExistingParticipants(x);
        scheduleVoiceStateReport();
      });

      // No need to set processor - virtual stream already goes through AudioManager's processing chain
      // No need to handle device changes - AudioManager handles it internally and virtual stream stays the same

      disposables.addSubscription(mutedSub);
      disposables.addSubscription(mutedAllSub);

      const audioErrorSub = audio.onAudioDeviceError((err) => {
        logger.error(`[CALL] Audio device error (${err.type}):`, err.message);
        telemetry.count("call.audio_device.error", { type: err.type });
        audioDeviceError.value = { type: err.type, message: err.message };
      });
      disposables.addSubscription(audioErrorSub);
    } catch (err) {
      logger.error("mic publish failed", err);
      telemetry.count("call.join", { mode: mode.value, result: "failed", stage: "mic", error: errorName(err) });
      await leave();
      connectError.value = { message: formatConnectError(err) };
      return;
    }

    isConnecting.value = false;
    isConnected.value = true;
    connectedAt = performance.now();
    telemetry.count("call.join", { mode: mode.value, result: "ok" });
    if (joinStartedAt !== null) {
      telemetry.distribution("call.join.duration", performance.now() - joinStartedAt, "millisecond", { mode: mode.value });
      joinStartedAt = null;
    }
    // Ourselves included: how big the rooms people actually end up in are.
    telemetry.distribution("call.room.size", r.remoteParticipants.size + 1, "none", { mode: mode.value });
    // The events only fire on a change, so take the initial readings ourselves.
    audioPlaybackBlocked.value = !r.canPlaybackAudio;
    videoPlaybackBlocked.value = !r.canPlaybackVideo;
    tone.playSoftEnterSound();

    // Process already connected participants
    logger.info(
      `[CALL] Processing ${r.remoteParticipants.size} already connected participants`,
    );
    for (const [uid, participant] of r.remoteParticipants) {
      if (isRadioIdentity(uid)) continue;
      await addParticipant(participant);
    }
    recomputeRadioBusy();
  }

  /** Whether the SFU would take a microphone track from us right now. */
  function canPublishMicrophone(r: Room) {
    const p = r.localParticipant.permissions;
    // Nothing known yet: try, and let a refusal land in publishMicrophone's catch.
    if (!p) return true;
    if (!p.canPublish) return false;
    const sources = p.canPublishSources ?? [];
    return sources.length === 0 || sources.includes(Track.sourceToProto(Track.Source.Microphone));
  }

  /**
   * Publish a microphone track cloned from the call's input. Returns false when the SFU does not
   * allow the microphone (server mute/deafen, or no Speak): the caller carries on without it.
   */
  async function publishMicrophone(r: Room): Promise<boolean> {
    if (localMic || micPublishing || !micSource) return !!localMic;
    if (!canPublishMicrophone(r)) {
      logger.info("[CALL] microphone not allowed right now, publishing it later");
      return false;
    }

    micPublishing = true;
    // A clone, so LiveKit stopping its track on unpublish or disconnect leaves the input alone.
    // userProvidedTrack=true tells LiveKit not to manage this track internally.
    const clone = micSource.clone();
    const mic = new LocalAudioTrack(clone, undefined, true, audio.getCurrentAudioContext());
    mic.source = Track.Source.Microphone;
    try {
      // simulcast/degradationPreference are video-only and were carried over from an
      // older SDK; the SDK now also picks the right degradation preference per source.
      // A channel bitrate replaces the preset's cap only; RED, stereo and mute handling stay as
      // they are, so a low cap degrades quality rather than behaviour.
      await r.localParticipant.publishTrack(mic, {
        red: true,
        stopMicTrackOnMute: false,
        audioPreset: micBitrateKbps
          ? { maxBitrate: micBitrateKbps * 1000 }
          : AudioPresets.musicStereo,
        forceStereo: true,
      });
    } catch (err) {
      if (err instanceof PublishTrackError && err.status === 403) {
        logger.info("[CALL] microphone refused by the SFU, publishing it later");
        try { clone.stop?.(); } catch { /* already stopped */ }
        return false;
      }
      throw err;
    } finally {
      micPublishing = false;
    }

    if (toRaw(room.value) !== r) return false;
    localMic = mic;
    // Mute IMMEDIATELY after publishing if needed
    if (sys.microphoneMuted) await mic.mute();
    return true;
  }

  /** Republish the microphone once the SFU allows it again. No-op when it is already up. */
  async function ensureMicrophonePublished() {
    const r = toRaw(room.value) as Room | null;
    if (!r || !micSource || localMic || micPublishing || !canPublishMicrophone(r)) return;
    try {
      if (await publishMicrophone(r)) logger.info("[CALL] microphone republished");
    } catch (err) {
      logger.error("[CALL] microphone republish failed", err);
    }
  }

  async function setupLocalSpeakingDetector(
    userId: string,
  ): Promise<Subscription> {
    // Use VU meter from AudioManager - it runs in AudioWorklet thread (much cheaper than AnalyserNode on main thread)
    const vuMeter = await audio.createVirtualVUMeter((level) => {
      // level is 0-100, threshold ~5 for speaking
      const isMicMuted = sys.microphoneMuted;
      const isSpeaking = !isMicMuted && level > 5;

      if (isSpeaking) {
        speaking.add(userId);
      } else {
        speaking.delete(userId);
      }
    });

    return new Subscription(() => {
      speaking.delete(userId);
      vuMeter.dispose();
    });
  }

  function applyMuteAllToExistingParticipants(isMutedAll: boolean) {
    if (!room.value) return;

    // Deafened is deafened: the radio graphs sit on the master, past the ducked bus, so they
    // are silenced here, one by one, like every other graph.
    for (const entry of radioGraphs.values()) entry.graph.setVolume(isMutedAll ? 0 : 100);

    Object.values(participants).forEach((x) => {
      if (isMutedAll) {
        // Mute: set volume to 0 WITHOUT saving to localStorage
        setVolume(x.userId, 0, true);
      } else {
        // Unmute: restore saved volume from localStorage
        const savedVolume = userVolume.getUserVolume(x.userId);
        setVolume(x.userId, savedVolume, true);
      }
    });
  }

  async function onTrackSubscribed(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) {
    const uid = participant.identity;
    if (isRadioIdentity(uid)) {
      if (track.kind === Track.Kind.Audio) setupRadioGraph(uid, track, participant);
      return;
    }
    if (!participants[uid]) {
      const info = await pool.getUser(uid);
      // Re-check after the await. A participant's microphone and screen-share audio
      // arrive back to back, and both handlers pass the guard above before either
      // resumes — overwriting here would discard the record the first one has already
      // hung an audio graph on, leaving that graph connected but unreachable and the
      // participant silent.
      if (!participants[uid]) {
        const savedVolume = userVolume.getUserVolume(uid);
        participants[uid] = {
          userId: uid,
          displayName: info?.displayName ?? "User",
          muted: pub.isMuted,
          volume: [savedVolume],
          audioGraph: null,
          screenAudioGraph: null,
          mutedAll: false,
          screencast: false,
        };
      }
    }

    if (track.kind === Track.Kind.Video) {
      const source = track.source || pub.source || 'unknown';
      videoTracks.set(videoTrackKey(uid, source), track);
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      const existing = participants[uid];
      const isScreenAudio =
        (track.source || pub.source) === Track.Source.ScreenShareAudio;

      if (isScreenAudio) {
        // Desktop/system audio from a screen share — separate graph so it plays
        // alongside the mic and never lights the "speaking" ring.
        if (existing?.screenAudioGraph) {
          logger.warn(`[CALL] Screen-audio graph already exists for ${uid}, skipping`);
          return;
        }
        logger.info(`[CALL] Setting up screen-audio graph for ${uid}`);
        setupScreenAudioGraph(uid, track);
        return;
      }

      // Microphone audio
      if (existing?.audioGraph) {
        logger.warn(
          `[CALL] Audio graph already exists for ${uid}, skipping duplicate setup`,
        );
        return;
      }

      logger.info(`[CALL] Setting up audio graph for ${uid}`);
      setupAudioGraph(uid, track);
    }
  }

  function onTrackUnsubscribed(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) {
    const uid = participant.identity;

    if (track.kind === "video") {
      const source = track.source || pub.source || 'unknown';
      // Detach before the map entry goes: the <video> unmounts because the entry is gone, and by
      // then the component can no longer find the track to detach it — every camera-off and
      // share-stop used to leave an element with a live srcObject behind.
      try { track.detach(); } catch { /* already detached */ }
      videoTracks.delete(videoTrackKey(uid, source));
      pausedVideoTracks.delete(videoTrackKey(uid, source));
      return;
    }

    if (track.kind === "audio") {
      track.detach();
      if (isRadioIdentity(uid)) {
        releaseRadioGraph(uid);
        return;
      }
      const isScreenAudio =
        (track.source || pub.source) === Track.Source.ScreenShareAudio;
      // Through the handle rather than the graph: that clears the record's slot and takes the
      // graph out of `disposables` in the same step (see releaseAudioGraph).
      releaseAudioGraph(uid, isScreenAudio ? "screen" : "mic");
    }
  }

  function setupAudioGraph(userId: string, track: RemoteTrack) {
    const pdata = participants[userId];
    if (pdata?.audioGraph) {
      logger.error(
        `[CALL] setupAudioGraph called for ${userId} but audioGraph already exists! Preventing duplicate.`,
      );
      return;
    }
    // No graph on the record, so any handle left here is stale: run it down before installing.
    releaseAudioGraph(userId, "mic");

    // Get saved volume and mute state
    const savedVolume = userVolume.getUserVolume(userId);
    const isMutedAll = sys.headphoneMuted;

    // Use AudioManager to create the audio graph
    const audioGraph = audio.createRemoteAudioGraph({
      track: (track as any).mediaStreamTrack,
      initialVolume: isMutedAll ? 0 : savedVolume,
      isMutedAll,
      onSpeakingChange: (isSpeaking) => {
        if (isSpeaking) {
          speaking.add(userId);
        } else {
          speaking.delete(userId);
        }
      },
    });

    // Store the audio graph
    if (pdata) {
      pdata.audioGraph = audioGraph;
      pdata.volume = [savedVolume];

      // Update volume in realtimeStore for UI sync
      if (targetId.value) {
        realtimeStore.setUserProperty(targetId.value, userId, (user) => {
          user.volume = [savedVolume];
        });
      }
    }

    const sub = new Subscription(() => {
      speaking.delete(userId);
      audioGraph.dispose();
      // Clear the slot only while it still holds this graph — the record hands back a reactive
      // proxy, hence toRaw — so a replacement installed since is left alone.
      const pm = participants[userId];
      if (pm && toRaw(pm.audioGraph) === audioGraph) pm.audioGraph = null;
    });
    audioGraphSubs.set(userId, sub);
    disposables.addSubscription(sub);
  }

  /**
   * Graph for a participant's screen-share (desktop) audio. Unlike the mic graph
   * it has no speaking detection (desktop audio must not light the speaking ring),
   * but it shares the same per-user volume + deafen state so the volume slider and
   * headphone-mute affect it too.
   */
  function setupScreenAudioGraph(userId: string, track: RemoteTrack) {
    const pdata = participants[userId];
    if (pdata?.screenAudioGraph) {
      return;
    }
    releaseAudioGraph(userId, "screen");

    const savedVolume = userVolume.getUserVolume(userId);
    const isMutedAll = sys.headphoneMuted;

    const screenAudioGraph = audio.createRemoteAudioGraph({
      track: (track as any).mediaStreamTrack,
      label: "Screen Audio",
      initialVolume: isMutedAll ? 0 : savedVolume,
      isMutedAll,
      // no onSpeakingChange — desktop audio should never mark the user as speaking
    });

    if (pdata) {
      pdata.screenAudioGraph = screenAudioGraph;
    }

    const sub = new Subscription(() => {
      screenAudioGraph.dispose();
      const pm = participants[userId];
      if (pm && toRaw(pm.screenAudioGraph) === screenAudioGraph) pm.screenAudioGraph = null;
    });
    screenAudioGraphSubs.set(userId, sub);
    disposables.addSubscription(sub);
  }

  function setVolume(userId: string, vol: number, skipSave = false) {
    const u = participants[userId];
    if (!u || (!u.audioGraph && !u.screenAudioGraph)) return;

    u.audioGraph?.setVolume(vol);
    // Keep the user's desktop-audio at the same level as their voice.
    u.screenAudioGraph?.setVolume(vol);
    u.volume = [vol];

    if (!skipSave) {
      userVolume.setUserVolume(userId, vol);
    }

    // Update volume in realtimeStore for UI sync
    if (targetId.value) {
      realtimeStore.setUserProperty(targetId.value, userId, (user) => {
        user.volume = [vol];
      });
    }
  }

  async function startScreenShare(opts: ScreenShareOpts) {
    if (!room.value) return;
    if (!canInCurrentChannel("Stream")) {
      logger.warn("[CALL] No Stream permission in this channel");
      return;
    }

    const fr = opts.frameRate ?? 30;

    // On the desktop host, tell the main process which source to provide before
    // calling getDisplayMedia (it is intercepted by setDisplayMediaRequestHandler).
    // Elsewhere the host supplies a no-op and the browser shows its own picker.
    if (opts.deviceId) {
      await config.selectScreenSource(opts.deviceId, opts.systemAudio === "include");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        // restrictOwnAudio keeps this page's own output out of the desktop capture, so the
        // other participants' voices coming from our speakers aren't echoed back into the
        // room. Unknown constraint names are dropped where unsupported, and Electron's
        // loopback path builds the audio track in the main process regardless.
        audio:
          opts.systemAudio === "include"
            ? ({ restrictOwnAudio: true } as unknown as MediaTrackConstraints)
            : false,
      });
    } catch (err) {
      // Most often the user dismissing the picker (NotAllowedError) — worth knowing how often
      // a share is started and then abandoned, and separately from real capture failures.
      telemetry.count("call.screenshare.start", { result: "failed", error: errorName(err), system_audio: opts.systemAudio === "include" });
      throw err;
    }

    // From here on the capture is live. Should anything below fail, every track of it has to
    // be stopped, or the OS keeps its "sharing" indicator up for the rest of the session with
    // nothing behind it.
    const stopCapture = () => {
      for (const t of stream.getTracks()) {
        try { t.stop(); } catch { /* already stopped */ }
      }
    };

    let vid: LocalVideoTrack;
    try {
      vid = new LocalVideoTrack(stream.getVideoTracks()[0]);
      vid.source = Track.Source.ScreenShare;

      // A ScreenShare-source track takes screenShareEncoding; videoEncoding is ignored here.
      screenTrackPub = await room.value.localParticipant.publishTrack(vid, {
        screenShareEncoding: {
          maxBitrate: opts.maxBitrate ?? 5_000_000,
          maxFramerate: fr,
        },
      });

      // Publish the desktop/system audio captured alongside the video. Electron's
      // display-media handler returns `audio: "loopback"` when system audio is
      // requested, so the stream carries a real audio track — forward it to the room.
      const audioTrack = stream.getAudioTracks()[0];
      if (opts.systemAudio === "include" && audioTrack) {
        const sysAudio = new LocalAudioTrack(audioTrack);
        sysAudio.source = Track.Source.ScreenShareAudio;
        try {
          screenAudioTrackPub = await room.value.localParticipant.publishTrack(sysAudio, {
            dtx: false, // keep continuous music/game audio intact (DTX is for speech gaps)
            red: false,
            audioPreset: AudioPresets.musicHighQualityStereo,
          });
        } catch (err) {
          logger.error("[CALL] Failed to publish system audio:", err);
          // The share goes on without it; the loopback capture must not — nothing else would
          // ever stop it.
          try { audioTrack.stop(); } catch { /* already stopped */ }
        }
      }
    } catch (err) {
      logger.error("[CALL] Failed to publish screen share:", err);
      telemetry.count("call.screenshare.start", { result: "failed", error: errorName(err), system_audio: opts.systemAudio === "include" });
      // Whatever did get published goes too (unpublishing with stop=true stops its track).
      const published = [screenAudioTrackPub, screenTrackPub].filter((pub) => pub?.track);
      screenTrackPub = null;
      screenAudioTrackPub = null;
      for (const pub of published) {
        try { await room.value.localParticipant.unpublishTrack(pub.track, true); }
        catch (e) { logger.warn("[CALL] Failed to unpublish half-started share:", e); }
      }
      stopCapture();
      isSharing.value = false;
      throw err;
    }

    isSharing.value = true;
    lastShareOpts.value = { ...opts };
    systemAudioEnabled.value = opts.systemAudio === "include";
    shareStartedAt = performance.now();
    telemetry.count("call.screenshare.start", {
      result: "ok",
      mode: mode.value,
      system_audio: opts.systemAudio === "include",
      fps: fr,
    });

    // Add local screen share to videoTracks
    const localId = me.me!.userId;
    videoTracks.set(videoTrackKey(localId, Track.Source.ScreenShare), vid);

    // Open a screencast drawing session for this share (no-op unless flag + channel ctx).
    try { drawing.beginStreamerSession(opts.deviceId); }
    catch (e) { logger.warn("[CALL] beginStreamerSession failed", e); }

    screenTrackPub.once("ended", () => stopScreenShare());
  }

  async function stopScreenShare() {
    if (screenTrackPub) {
      if (shareStartedAt !== null) {
        telemetry.distribution("call.screenshare.duration", (performance.now() - shareStartedAt) / 1000, "second");
        shareStartedAt = null;
      }
      const localId = me.me!.userId;
      videoTracks.delete(videoTrackKey(localId, Track.Source.ScreenShare));

      // Close the screencast drawing session tied to this share.
      try { drawing.endStreamerSession(); }
      catch (e) { logger.warn("[CALL] endStreamerSession failed", e); }

      if (screenAudioTrackPub) {
        try {
          await room.value?.localParticipant.unpublishTrack(screenAudioTrackPub.track, true);
        } catch (err) {
          logger.warn("[CALL] Failed to unpublish system audio:", err);
        }
        screenAudioTrackPub = null;
      }

      await room.value?.localParticipant.setScreenShareEnabled(false);
      screenTrackPub = null;
      isSharing.value = false;
    }
  }

  async function startCamera(deviceId?: string) {
    if (!room.value) return;
    if (isCameraOn.value) return;
    if (!canInCurrentChannel("Video")) {
      logger.warn("[CALL] No Video permission in this channel");
      return;
    }

    let cam: LocalVideoTrack | null = null;
    try {
      // Prompt for camera access before capturing (macOS native host only — elsewhere a no-op).
      await ensureMediaPermission("camera");

      const dev = deviceId || preference.defaultVideoDevice || undefined;
      cam = await createLocalVideoTrack({
        deviceId: dev,
        resolution: VideoPresets.h720.resolution,
      });

      // No simulcast flag: vp9 is SVC, so the layers come from scalabilityMode
      // (L3T3_KEY) in a single encode and the flag is ignored.
      cameraTrackPub = await room.value.localParticipant.publishTrack(cam, {
        videoEncoding: VideoPresets.h720.encoding,
      });
      isCameraOn.value = true;
      cameraStartedAt = performance.now();
      telemetry.count("call.camera.start", { result: "ok", mode: mode.value });

      // Add local video to videoTracks so ParticipantCard shows it
      const localId = me.me!.userId;
      videoTracks.set(videoTrackKey(localId, Track.Source.Camera), cam);

      cameraTrackPub.once("ended", () => stopCamera());
    } catch (err) {
      logger.error("[CALL] Failed to start camera:", err);
      telemetry.count("call.camera.start", { result: "failed", mode: mode.value, error: errorName(err) });
      // createLocalVideoTrack has already opened the device: a publish that fails after it
      // has to close it again, or the camera LED stays on with nothing behind it.
      if (cam && !isCameraOn.value) {
        try { cam.stop(); } catch { /* already stopped */ }
      }
    }
  }

  async function stopCamera() {
    if (cameraTrackPub) {
      if (cameraStartedAt !== null) {
        telemetry.distribution("call.camera.duration", (performance.now() - cameraStartedAt) / 1000, "second");
        cameraStartedAt = null;
      }
      const localId = me.me!.userId;
      videoTracks.delete(videoTrackKey(localId, Track.Source.Camera));

      await room.value?.localParticipant.setCameraEnabled(false);
      cameraTrackPub = null;
      isCameraOn.value = false;
    }
  }

  async function toggleCamera(deviceId?: string) {
    if (isCameraOn.value) {
      await stopCamera();
    } else {
      await startCamera(deviceId);
    }
  }

  /**
   * Switch the active webcam device. Persists the choice; if the camera is live
   * it restarts the track on the new device (LiveKit has no live replaceTrack here).
   */
  async function switchCamera(deviceId: string) {
    preference.defaultVideoDevice = deviceId;
    if (!isCameraOn.value) return;
    await stopCamera();
    await startCamera(deviceId);
  }

  /** Switch the screen-share target/source by restarting the capture with new opts. */
  async function switchScreenShare(opts: ScreenShareOpts) {
    if (isSharing.value) await stopScreenShare();
    await startScreenShare(opts);
  }

  /**
   * Toggle system/desktop audio. While sharing: turning OFF unpublishes the audio
   * track instantly; turning ON re-captures the same source with audio (the stored
   * source id makes Electron auto-select it, so there is no picker re-prompt).
   * Outside a share it just records the preference for the next share.
   */
  async function toggleSystemAudio() {
    systemAudioEnabled.value = !systemAudioEnabled.value;
    if (!isSharing.value || !lastShareOpts.value) return;

    const want = systemAudioEnabled.value ? "include" : "exclude";
    if (lastShareOpts.value.systemAudio === want) return;

    if (want === "exclude") {
      // Stop forwarding desktop audio without interrupting the video.
      if (screenAudioTrackPub) {
        try {
          await room.value?.localParticipant.unpublishTrack(screenAudioTrackPub.track, true);
        } catch (err) {
          logger.warn("[CALL] Failed to unpublish system audio:", err);
        }
        screenAudioTrackPub = null;
      }
      lastShareOpts.value = { ...lastShareOpts.value, systemAudio: "exclude" };
      return;
    }

    // Turning ON: audio wasn't captured, so restart the capture with the same source.
    await switchScreenShare({ ...lastShareOpts.value, systemAudio: "include" });
  }

  // ── Radio (broadcast channels) ───────────────────────────────────
  //
  // Broadcaster side: in a broadcast channel ("HQ") with the Broadcast right, the server hands
  // out a token for a second room, `radio/{space}/{HQ}`, joined as `bc:{me}`; the SFU forwards
  // that participant into the targets. The key unmutes the radio track, opens the HQ mic through
  // the shared hold, and flags `argon.radio=on` on the HQ participant so others see "Busy".
  //
  // Listener side: every `bc:*` in our room is a forwarded broadcaster. It gets a playback graph
  // on the master (past the ducked bus) and nothing else — no tile, no tones, no roster entry.

  const radio = ref<RadioState>(initialRadioState());
  let radioSession: RadioSession | null = null;
  // Bumped by every fetch; anything async that finds another number is stale and stops.
  let radioFetchSeq = 0;
  let radioRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let radioBackoffStep = 0;
  let radioConfirmRetried = false;
  // The channel we already re-Interlinked for after the roster lost us; once per join.
  let radioRejoinedFor: string | null = null;
  let radioRejoining = false;
  let radioEntitlementTimer: ReturnType<typeof setTimeout> | null = null;
  let radioResyncTimer: ReturnType<typeof setTimeout> | null = null;

  // The key, as the user holds it, versus the transmission, which outlives it by the release
  // delay and dies early on the max-transmit guard.
  let radioKeyHeld = false;
  let radioLastKeyUpAt = -Infinity;
  let radioReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  let radioMaxTimer: ReturnType<typeof setTimeout> | null = null;
  let radioTransmitStartedAt: number | null = null;

  const radioGraphs = new Map<string, {
    graph: RemoteAudioGraph;
    userId: string;
    hqChannelId: string | null;
    hangover: ReturnType<typeof setTimeout> | null;
  }>();
  // Broadcast settings of HQ channels we listen to, from the pool when the realtime store has no
  // copy; the ducking depth and the chirp come from here.
  const radioHqSettings = new Map<string, BroadcastSettings | null>();
  const radioHqLookups = new Set<string>();

  function clearRadioRetry() {
    if (radioRetryTimer) {
      clearTimeout(radioRetryTimer);
      radioRetryTimer = null;
    }
  }

  /**
   * Stop transmitting now: the key release, the guard, and every close come through here.
   * `roomGoing`: the call room is about to disconnect, so the on-air attribute dies with it and
   * writing it would only wait out LiveKit's timeout.
   */
  function stopRadioTransmission(opts: { roomGoing?: boolean } = {}) {
    if (radioReleaseTimer) {
      clearTimeout(radioReleaseTimer);
      radioReleaseTimer = null;
    }
    if (radioMaxTimer) {
      clearTimeout(radioMaxTimer);
      radioMaxTimer = null;
    }
    if (!radio.value.transmitting) return;
    radio.value.transmitting = false;
    if (radioSession) {
      radioSession.setTransmitting(false).catch((e) => logger.warn("[RADIO] mute failed", e));
    }
    void micHold.release("radio");
    if (!opts.roomGoing) void setRadioOnAir(false);
    if (radioTransmitStartedAt !== null) {
      telemetry.distribution("call.radio.transmit_ms", performance.now() - radioTransmitStartedAt, "millisecond");
      radioTransmitStartedAt = null;
    }
  }

  /** Mute, disconnect, forget the links; `reason` is what the UI shows in place of the key. */
  function closeRadio(reason: RadioUnavailableReason | null, opts: { roomGoing?: boolean } = {}) {
    radioFetchSeq++;
    clearRadioRetry();
    stopRadioTransmission(opts);
    radioKeyHeld = false;
    const session = radioSession;
    radioSession = null;
    session?.close();
    const s = radio.value;
    s.available = false;
    s.connecting = false;
    s.settings = null;
    s.unavailableReason = reason;
  }

  /** Everything radio, both sides: on leave(), and on a move, where the room stays. */
  function resetRadio(opts: { roomGoing: boolean } = { roomGoing: true }) {
    closeRadio(null, opts);
    if (radioEntitlementTimer) {
      clearTimeout(radioEntitlementTimer);
      radioEntitlementTimer = null;
    }
    if (radioResyncTimer) {
      clearTimeout(radioResyncTimer);
      radioResyncTimer = null;
    }
    radioBackoffStep = 0;
    radioConfirmRetried = false;
    // A leave of our own making (the rejoin below) keeps the once-per-join guard.
    if (!radioRejoining) radioRejoinedFor = null;
    for (const identity of [...radioGraphs.keys()]) releaseRadioGraph(identity);
    radioHqSettings.clear();
    radioHqLookups.clear();
    radio.value = initialRadioState();
    audio.setVoiceBusGain(1);
  }

  async function setRadioOnAir(on: boolean) {
    const r = toRaw(room.value) as Room | null;
    if (!r) return;
    try {
      await r.localParticipant.setAttributes({ [RADIO_ATTR.onAir]: on ? RADIO_ON_AIR.on : RADIO_ON_AIR.off });
    } catch (e) {
      logger.warn("[RADIO] on-air attribute failed", e);
    }
  }

  /** The broadcast settings of the channel we are in, as the host knows them right now. */
  async function currentBroadcast(channelId: string): Promise<BroadcastSettings | null> {
    const rt = realtimeStore.getRealtimeChannel(channelId);
    if (rt) return rt.Channel.broadcast ?? null;
    const channel = await pool.getChannel?.(channelId).catch(() => null);
    return channel?.broadcast ?? null;
  }

  /** The server said no for a reason no retry will change. */
  function radioLinksFailed(reason: RadioUnavailableReason, error: string) {
    telemetry.count("call.radio.links", { result: "failed", error });
    closeRadio(reason);
  }

  /** Put the radio into "connecting" and fetch again after `delay`. */
  function scheduleRadioFetch(delay: number, opts: FetchRadioOptions = {}) {
    closeRadio("connecting");
    radio.value.connecting = true;
    radioRetryTimer = setTimeout(() => {
      radioRetryTimer = null;
      void fetchRadioLinks(opts);
    }, delay);
  }

  /**
   * A transient failure — the SFU, the transport, a thrown call: try again after a growing
   * delay, then give up with "error" until the next trigger or key press.
   */
  function radioRetryLater(error: string) {
    telemetry.count("call.radio.links", { result: "failed", error });
    const delay = RADIO_RECONNECT_BACKOFF_MS[radioBackoffStep];
    if (delay === undefined) {
      logger.warn("[RADIO] giving up until the next trigger");
      closeRadio("error");
      return;
    }
    radioBackoffStep++;
    scheduleRadioFetch(delay);
  }

  /**
   * The server does not see us in the channel: once a short wait (the roster is catching up),
   * then one re-Interlink of HQ (a silo restart wiped the roster), then it stays that way.
   */
  function onRadioNotInChannel(spaceId: string, channelId: string) {
    telemetry.count("call.radio.links", { result: "failed", error: "not_in_channel" });
    if (!radioConfirmRetried) {
      radioConfirmRetried = true;
      scheduleRadioFetch(RADIO_CONFIRM_RETRY_MS);
      return;
    }
    if (radioRejoinedFor !== channelId) {
      radioRejoinedFor = channelId;
      closeRadio("connecting");
      radio.value.connecting = true;
      void rejoinForRadio(spaceId, channelId);
      return;
    }
    closeRadio("not_in_channel");
  }

  /** Leave and join HQ again; the join asks for the links on its own. */
  async function rejoinForRadio(spaceId: string, channelId: string) {
    logger.warn("[RADIO] not in the channel twice, rejoining HQ");
    radioRejoining = true;
    try {
      await leave();
      await joinChannel(channelId, spaceId);
    } catch (e) {
      logger.error("[RADIO] rejoin failed", e);
    } finally {
      radioRejoining = false;
    }
  }

  interface FetchRadioOptions {
    /** The channel's settings as the trigger carried them (a ChannelModifiedV2 the host may not have applied yet). */
    broadcast?: BroadcastSettings | null;
    /** Skip the local permission check and let the server decide (after an entitlement change the host's copy may lag). */
    trustServer?: boolean;
  }

  /** Ask for the links and connect. */
  async function fetchRadioLinks(opts: FetchRadioOptions = {}) {
    clearRadioRetry();
    const channelId = connectedVoiceChannelId.value;
    const spaceId = connectedVoiceSpaceId.value;
    if (mode.value !== "channel" || !channelId || !spaceId || !isConnected.value) {
      closeRadio(null);
      return;
    }
    if (serverMuted.value || serverDeafened.value) {
      closeRadio("server_restricted");
      return;
    }
    const seq = ++radioFetchSeq;
    const settings = opts.broadcast === undefined ? await currentBroadcast(channelId) : opts.broadcast;
    if (seq !== radioFetchSeq) return;
    if (!settings) {
      closeRadio(null);
      return;
    }
    if (!opts.trustServer && !canInChannel(channelId, "Broadcast", spaceId)) {
      closeRadio("insufficient_permissions");
      return;
    }

    closeRadio(null);
    const mySeq = ++radioFetchSeq;
    radio.value.connecting = true;
    radio.value.unavailableReason = "connecting";

    let links;
    try {
      links = await api.channelInteraction.GetBroadcastLinks(spaceId, channelId);
    } catch (e) {
      if (mySeq !== radioFetchSeq) return;
      logger.error("[RADIO] GetBroadcastLinks failed", e);
      radioRetryLater(errorName(e));
      return;
    }
    if (mySeq !== radioFetchSeq) return;
    if (!links.isSuccessBroadcastLinks()) {
      const code = links.isFailedBroadcastLinks() ? Number(links.error) : -1;
      const reason = RADIO_LINKS_ERRORS[code] ?? "error";
      logger.warn("[RADIO] links refused", reason);
      if (code === RADIO_LINKS_ERROR_NOT_IN_CHANNEL) onRadioNotInChannel(spaceId, channelId);
      else if (code === RADIO_LINKS_ERROR_SFU_UNAVAILABLE) radioRetryLater(reason);
      else radioLinksFailed(reason, reason);
      return;
    }

    radio.value.settings = links.settings;
    const session = new RadioSession(
      {
        createRoom: (options) => createRoom(options, "radio"),
        connect: (r, rtc, token) => connectRoom(r, rtc, token, { connect: { autoSubscribe: false }, tag: "[RADIO]" }),
        audioContext: () => audio.getCurrentAudioContext(),
        micSource: () => micSource,
        onReconnected: () => {
          if (radioSession === session) void confirmRadioLinks(mySeq, spaceId, channelId);
        },
        onDisconnected: (reason) => {
          if (radioSession === session) onRadioDisconnected(reason);
        },
      },
      `radio-${channelId}`,
    );
    radioSession = session;
    try {
      const connected = await session.connect(links.rtc, links.token);
      if (!connected || mySeq !== radioFetchSeq) return;
    } catch (e) {
      if (mySeq !== radioFetchSeq) return;
      // A failed first connect never raises Disconnected, so the backoff has to start here.
      logger.error("[RADIO] connect failed", e);
      radioRetryLater(errorName(e));
      return;
    }
    await confirmRadioLinks(mySeq, spaceId, channelId);
  }

  /** Tell the server the radio room is up, so it forwards `bc:{me}` into the targets. */
  async function confirmRadioLinks(seq: number, spaceId: string, channelId: string) {
    let res;
    try {
      res = await api.channelInteraction.ConfirmBroadcastLinks(spaceId, channelId);
    } catch (e) {
      if (seq !== radioFetchSeq) return;
      logger.error("[RADIO] ConfirmBroadcastLinks failed", e);
      radioRetryLater(errorName(e));
      return;
    }
    if (seq !== radioFetchSeq) return;
    if (res.isSuccessConfirmBroadcastLinks()) {
      const s = radio.value;
      s.available = true;
      s.connecting = false;
      s.unavailableReason = null;
      radioBackoffStep = 0;
      radioConfirmRetried = false;
      telemetry.count("call.radio.links", { result: "ok" });
      logger.info("[RADIO] on the air-ready", { targets: res.forwardedTargets });
      return;
    }
    const code = res.isFailedConfirmBroadcastLinks() ? Number(res.error) : -1;
    const reason = RADIO_LINKS_ERRORS[code] ?? "error";
    if (code === RADIO_LINKS_ERROR_NOT_IN_CHANNEL) onRadioNotInChannel(spaceId, channelId);
    else if (code === RADIO_LINKS_ERROR_SFU_UNAVAILABLE) radioRetryLater(reason);
    else radioLinksFailed(reason, reason);
  }

  /**
   * The radio room dropped while we are still in HQ. A removal by the server (the links revoked,
   * the room gone, this identity joined elsewhere) is final until the next trigger; anything
   * else is reconnected with a short backoff.
   */
  function onRadioDisconnected(reason: DisconnectReason | undefined) {
    const why = reason === undefined ? "unknown" : (DisconnectReason[reason] ?? String(reason));
    logger.warn(`[RADIO] disconnected (${why})`);
    if (reason !== undefined && SERVER_SIDE_REMOVALS.has(reason)) {
      closeRadio("error");
      return;
    }
    radioRetryLater(why);
  }

  /** A fresh attempt from a trigger: earlier retries are forgotten. */
  async function refetchRadioLinks(opts: FetchRadioOptions = {}) {
    radioBackoffStep = 0;
    radioConfirmRetried = false;
    await fetchRadioLinks(opts);
  }

  /** After a realtime resync: a working radio only needs its forward re-confirmed. */
  function resyncRadio() {
    if (mode.value !== "channel" || radio.value.connecting) return;
    const channelId = connectedVoiceChannelId.value;
    const spaceId = connectedVoiceSpaceId.value;
    if (radio.value.available && radioSession && channelId && spaceId) {
      void confirmRadioLinks(radioFetchSeq, spaceId, channelId);
      return;
    }
    void refetchRadioLinks();
  }

  function scheduleRadioResync() {
    if (radioResyncTimer) return;
    radioResyncTimer = setTimeout(() => {
      radioResyncTimer = null;
      resyncRadio();
    }, RADIO_RESYNC_COALESCE_MS);
  }

  /** The channel's broadcast settings changed under us. */
  function onRadioBroadcastChanged(broadcast: BroadcastSettings | null) {
    if (broadcast === null) {
      closeRadio(null);
      return;
    }
    if (radio.value.available) {
      radio.value.settings = broadcast;
      return;
    }
    radioBackoffStep = 0;
    radioConfirmRetried = false;
    void fetchRadioLinks({ broadcast });
  }

  /**
   * My entitlements changed. The host refetches its copy with a debounce and the answer can be
   * slow, so the local check is not trusted here: the server is asked and refuses if it must.
   */
  function onRadioEntitlementsChanged() {
    if (radioEntitlementTimer) clearTimeout(radioEntitlementTimer);
    radioEntitlementTimer = setTimeout(() => {
      radioEntitlementTimer = null;
      if (mode.value !== "channel") return;
      void refetchRadioLinks({ trustServer: true });
    }, RADIO_ENTITLEMENT_SETTLE_MS);
  }

  function recomputeRadioBusy() {
    const r = toRaw(room.value) as Room | null;
    let busy: string | null = null;
    if (r) {
      for (const [identity, p] of r.remoteParticipants) {
        if (isRadioIdentity(identity)) continue;
        if (p.attributes?.[RADIO_ATTR.onAir] === RADIO_ON_AIR.on) {
          busy = identity;
          break;
        }
      }
    }
    radio.value.busyBy = busy;
  }

  function radioKeyDown() {
    if (radioKeyHeld) return;
    if (mode.value !== "channel" || !isConnected.value) return;
    // Pressed again inside the release delay: the transmission simply goes on. Never a bounce.
    if (radioReleaseTimer && radio.value.transmitting) {
      clearTimeout(radioReleaseTimer);
      radioReleaseTimer = null;
      radioKeyHeld = true;
      return;
    }
    if (Date.now() - radioLastKeyUpAt < RADIO_KEY_DEBOUNCE_MS) return;
    const s = radio.value;
    if (!s.available || !radioSession) {
      tone.playRadioError();
      if (s.connecting) {
        notify({ kind: "radio_connecting" });
        return;
      }
      // Nothing to connect (a plain channel), or a reason no retry changes: the beep is all.
      if (s.unavailableReason === null || RADIO_TERMINAL_REASONS.has(s.unavailableReason)) return;
      // A radio that gave up (backoff exhausted, revoked): the press is the next trigger.
      notify({ kind: "radio_connecting" });
      void refetchRadioLinks();
      return;
    }
    if (Number(s.settings?.overlap) === RADIO_OVERLAP_LOCK && s.busyBy) {
      tone.playRadioError();
      notify({ kind: "radio_busy", userId: s.busyBy });
      return;
    }

    radioKeyHeld = true;
    s.transmitting = true;
    radioTransmitStartedAt = performance.now();
    radioSession.setTransmitting(true).catch((e) => logger.error("[RADIO] unmute failed", e));
    // The HQ mic too: HQ hears the callout once, through HQ.
    void micHold.acquire("radio");
    void setRadioOnAir(true);
    const maxSeconds = Number(s.settings?.maxTransmitSeconds ?? 0);
    if (maxSeconds > 0) {
      radioMaxTimer = setTimeout(() => {
        radioMaxTimer = null;
        logger.warn("[RADIO] max transmit reached, releasing");
        radioKeyHeld = false;
        radioLastKeyUpAt = Date.now();
        stopRadioTransmission();
        notify({ kind: "radio_max_transmit" });
      }, maxSeconds * 1000);
    }
    telemetry.count("call.radio.transmit");
  }

  function radioKeyUp() {
    if (!radioKeyHeld) return;
    radioKeyHeld = false;
    radioLastKeyUpAt = Date.now();
    if (!radio.value.transmitting) return;
    const delay = Math.max(0, Number(config.pttReleaseDelayMs?.() ?? 0) || 0);
    if (delay > 0) {
      radioReleaseTimer = setTimeout(() => {
        radioReleaseTimer = null;
        stopRadioTransmission();
      }, delay);
      return;
    }
    stopRadioTransmission();
  }

  // ── Radio, listener side ──

  /**
   * Fetch an HQ channel's settings from the pool when the realtime store has no copy. Started
   * as soon as a broadcaster appears, so they are in by the first transmission.
   */
  function prefetchHqSettings(hqChannelId: string | null) {
    if (!hqChannelId || !pool.getChannel) return;
    if (realtimeStore.getRealtimeChannel(hqChannelId)) return;
    if (radioHqSettings.has(hqChannelId) || radioHqLookups.has(hqChannelId)) return;
    radioHqLookups.add(hqChannelId);
    pool.getChannel(hqChannelId)
      .then((channel) => {
        if (!radioHqSettings.has(hqChannelId)) radioHqSettings.set(hqChannelId, channel?.broadcast ?? null);
        updateRadioDucking();
      })
      .catch(() => radioHqSettings.set(hqChannelId, null))
      .finally(() => radioHqLookups.delete(hqChannelId));
  }

  /** What we know of an HQ channel's settings; undefined while the lookup is still out. */
  function knownHqSettings(hqChannelId: string | null): BroadcastSettings | null | undefined {
    if (!hqChannelId) return null;
    const rt = realtimeStore.getRealtimeChannel(hqChannelId);
    if (rt) return rt.Channel.broadcast ?? null;
    if (radioHqSettings.has(hqChannelId)) return radioHqSettings.get(hqChannelId);
    prefetchHqSettings(hqChannelId);
    return undefined;
  }

  /** An HQ channel we listen to changed: drop the cached copy, take the patch when it has one. */
  function onHqChannelModified(channelId: string, patch: { broadcast?: BroadcastSettings | null } | null | undefined) {
    if (!radioHqSettings.has(channelId) && !radioHqLookups.has(channelId)) return;
    radioHqSettings.delete(channelId);
    if (patch && "broadcast" in patch && patch.broadcast !== undefined) radioHqSettings.set(channelId, patch.broadcast);
    else prefetchHqSettings(channelId);
    updateRadioDucking();
  }

  /** Duck the voice bus under whoever is on air; the deepest setting wins when there are several. */
  function updateRadioDucking() {
    const speakers = radio.value.onAir;
    if (speakers.length === 0) {
      audio.setVoiceBusGain(1);
      return;
    }
    let db = 0;
    for (const speaker of speakers) {
      const settings = knownHqSettings(speaker.hqChannelId);
      const depth = settings === undefined ? RADIO_DEFAULT_DUCKING_DB : (settings?.duckingDb ?? RADIO_DEFAULT_DUCKING_DB);
      db = Math.min(db, Number(depth) || 0);
    }
    audio.setVoiceBusGain(Math.pow(10, db / 20));
  }

  function onRadioSpeaking(identity: string, speaking: boolean) {
    const entry = radioGraphs.get(identity);
    if (!entry) return;
    if (speaking) {
      if (entry.hangover) {
        clearTimeout(entry.hangover);
        entry.hangover = null;
      }
      const onAir = radio.value.onAir;
      if (onAir.some((s) => s.userId === entry.userId && s.hqChannelId === entry.hqChannelId)) return;
      onAir.push({ userId: entry.userId, hqChannelId: entry.hqChannelId });
      if (knownHqSettings(entry.hqChannelId)?.chirp) tone.playRadioChirp();
      updateRadioDucking();
      return;
    }
    if (entry.hangover) return;
    entry.hangover = setTimeout(() => {
      entry.hangover = null;
      removeRadioSpeaker(entry.userId, entry.hqChannelId);
    }, RADIO_ON_AIR_HANGOVER_MS);
  }

  function removeRadioSpeaker(userId: string, hqChannelId: string | null) {
    const onAir = radio.value.onAir;
    const index = onAir.findIndex((s) => s.userId === userId && s.hqChannelId === hqChannelId);
    if (index < 0) return;
    onAir.splice(index, 1);
    updateRadioDucking();
  }

  /** A forwarded broadcaster's audio: on the master, so the ducking never touches it. */
  function setupRadioGraph(identity: string, track: RemoteTrack, participant: RemoteParticipant) {
    if (radioGraphs.has(identity)) return;
    prefetchHqSettings(participant.attributes?.[RADIO_ATTR.broadcast] || null);
    const deafened = sys.headphoneMuted;
    const graph = audio.createRemoteAudioGraph({
      track: (track as any).mediaStreamTrack,
      label: "Radio",
      initialVolume: deafened ? 0 : 100,
      isMutedAll: deafened,
      destination: audio.getOutputDestination(),
      onSpeakingChange: (speaking) => onRadioSpeaking(identity, speaking),
    });
    radioGraphs.set(identity, {
      graph,
      userId: radioUserId(identity) ?? identity,
      hqChannelId: participant.attributes?.[RADIO_ATTR.broadcast] || null,
      hangover: null,
    });
    logger.info(`[RADIO] listening to ${identity}`);
  }

  function releaseRadioGraph(identity: string) {
    const entry = radioGraphs.get(identity);
    if (!entry) return;
    radioGraphs.delete(identity);
    if (entry.hangover) clearTimeout(entry.hangover);
    removeRadioSpeaker(entry.userId, entry.hqChannelId);
    try { entry.graph.dispose(); } catch (e) { logger.warn("[RADIO] graph dispose failed", e); }
  }

  // Held separately from `disposables`, which leave() empties. Putting them there is
  // exactly how the previous implementation stopped ringing after the first completed
  // call — these have to outlive every call the manager handles.
  const busSubscriptions = [
    bus.onServerEvent<CallIncoming>("CallIncoming", handleIncoming),

    bus.onServerEvent<CallFinished>("CallFinished", async (ev) => {
      // If this is our active call - leave
      if (callId.value === ev.callId) {
        await leave();
      }

      // If this is the incoming call we're seeing - clear the overlay and stop ringing
      if (incoming.value?.callId === ev.callId) {
        tone.stopPlayRingSound();
        incoming.value = null;
      }
    }),

    bus.onServerEvent<CallAccepted>("CallAccepted", (ev) =>
      logger.info("[CALL] CallAccepted", ev),
    ),

    bus.onServerEvent<VoiceMemberStateChanged>("VoiceMemberStateChanged", onVoiceMemberStateChanged),

    // Radio triggers. A null userId is a role change that touches everyone, us included.
    bus.onServerEvent<EntitlementsChanged>("EntitlementsChanged", (ev) => {
      if (mode.value !== "channel" || String(ev.spaceId) !== connectedVoiceSpaceId.value) return;
      if (ev.userId != null && String(ev.userId) !== me.me?.userId) return;
      onRadioEntitlementsChanged();
    }),

    bus.onServerEvent<ChannelModifiedV2>("ChannelModifiedV2", (ev) => {
      if (mode.value !== "channel") return;
      const channelId = String(ev.channelId);
      const patch = ev.patch as { broadcast?: BroadcastSettings | null } | null | undefined;
      // An HQ we listen to (listener side), or our own channel (broadcaster side).
      onHqChannelModified(channelId, patch);
      if (channelId !== connectedVoiceChannelId.value) return;
      if (!patch || !("broadcast" in patch) || patch.broadcast === undefined) return;
      onRadioBroadcastChanged(patch.broadcast);
    }),

    bus.onReconnected?.(() => scheduleRadioResync()) ?? { unsubscribe() {} },
    bus.onFullResync?.(() => scheduleRadioResync()) ?? { unsubscribe() {} },
  ];

  const stopSharingWatch = watch(isSharing, () => scheduleVoiceStateReport());

  /**
   * Tear the manager down for good: end any call and stop listening to the bus. The app
   * never calls this (the store lives as long as the page), but a package that keeps
   * subscriptions has to offer a way to release them.
   */
  async function dispose() {
    await leave();
    stopSharingWatch();
    for (const sub of busSubscriptions) sub.unsubscribe();
    busSubscriptions.length = 0;
  }

  return {
    dispose,
    radio,
    radioKeyDown,
    radioKeyUp,
    refetchRadioLinks,
    micHold,
    mode,
    room,
    callId,
    targetId,
    connectedVoiceChannelId,
    connectedVoiceSpaceId,
    serverMuted,
    serverDeafened,
    isConnected,
    isConnecting,
    isReconnecting,

    participants,
    videoTracks,
    videoTrackKey,
    getVideoTracksForUser,
    hasVideoTrack,
    pausedVideoTracks,
    isVideoPaused,
    isVideoHidden,
    setVideoHidden,
    videoQualityOf,
    setVideoQuality,
    participantQuality,
    subscriptionErrors,
    activeSpeakerId,
    speaking,
    incoming,

    isSharing,
    isCameraOn,
    systemAudioEnabled,
    lastShareOpts,

    isCpuConstrained,
    audioDeviceError,
    audioPlaybackBlocked,
    videoPlaybackBlocked,
    playbackBlocked,
    unblockPlayback,
    connectError,

    adaptiveStreamActive,
    adaptiveSettingPending,

    ping,
    pingHistory,
    averagePing,
    qualityConnection,
    interval,
    diagnostics,

    startDirectCall,
    acceptIncomingCall,
    rejectIncomingCall,
    joinVoiceChannel,
    maybeRecoverVoiceAfterCrash,
    startScreenShare,
    stopScreenShare,
    switchScreenShare,
    toggleSystemAudio,
    startCamera,
    stopCamera,
    toggleCamera,
    switchCamera,
    setVolume,
    leave,
    reconcileVoiceMembersFromLiveKit,
  };
}

export type CallManager = ReturnType<typeof createCallManager>;
