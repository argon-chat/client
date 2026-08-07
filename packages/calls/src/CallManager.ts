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
  SubscriptionError,
  VideoQuality,
  RemoteVideoTrack,
  createLocalVideoTrack,
  isLocalParticipant,
  isRemoteTrack,
  VideoPresets,
} from "livekit-client";
import { ref, reactive, computed, watch } from "vue";
import { Subscription } from "rxjs";
import { logger, startTimer, DisposableBag } from "@argon/core";
import type { CallIncoming, CallFinished, CallAccepted, RtcEndpoint } from "@argon/glue";

import { parseRtcStats } from "./rtcStats";
import type { CallManagerConfig, RemoteAudioGraph, ScreenShareOpts } from "./types";

export type { ScreenShareOpts } from "./types";

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

  const callId = ref<string | null>(null);
  const targetId = ref<string | null>(null);
  const connectedVoiceChannelId = ref<string | null>(null);

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
      if (key.startsWith(uid + ":")) videoTracks.delete(key);
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
    logger.warn("[CALL] leave()");

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
    // Explicit leave → don't auto-rejoin if the renderer later crashes/reloads.
    lastVoiceServerId.value = "";
    lastVoiceChannelId.value = "";

    isConnecting.value = false;
    isConnected.value = false;
    isReconnecting.value = false;

    Object.keys(participants).forEach((key) => delete participants[key]);
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

    // Release the mic held for this call (detaches the device on macOS when idle).
    audio.releaseInput();

    isSharing.value = false;
    screenTrackPub = null;

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
      mode.value = "none";
      return;
    }

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
      api.callInteraction.RejectCall(ev.callId);
      return;
    }
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
      return;
    }

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
      tone.stopPlayRingSound();
      await api.callInteraction.RejectCall(incoming.value.callId);
    }
    incoming.value = null;
  }

  async function joinVoiceChannel(channelId: string) {
    logger.info("[CALL] joinVoiceChannel", channelId);

    if (!pex.has("Connect")) {
      logger.warn("[CALL] No Connect permission");
      return;
    }

    if (mode.value === "dm") await leave();

    mode.value = "channel";

    const selected = pool.selectedServer;
    if (!selected) {
      logger.error("selectedServer = null");
      mode.value = "none";
      return;
    }

    const join = await api.channelInteraction.Interlink(selected, channelId);

    if (!join || !join.isSuccessJoinVoice()) {
      logger.error("Interlink failed", join);
      mode.value = "none";
      return;
    }

    callId.value = `channel-${channelId}`;
    targetId.value = channelId;
    connectedVoiceChannelId.value = channelId;
    // Remember where we are so a crash-triggered reload can rejoin (see below).
    lastVoiceServerId.value = String(selected);
    lastVoiceChannelId.value = channelId;

    await joinLiveKit({
      token: join.token,
      callId: callId.value!,
      selfId: me.me!.userId,
      rts: join.rtc,
    });

    startTimersRTT();
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

  async function addParticipant(p: RemoteParticipant) {
    const uid = p.identity;

    // Skip if already added
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

    // Setup event listeners for this participant
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

  /**
   * Reconcile the realtime channel member list against LiveKit's participant list.
   *
   * LiveKit runs on its own connection and stays authoritative about who is actually
   * in the voice channel even while the realtime (SignalR) hub is down. If the hub
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

    // Source of truth: self + everyone LiveKit currently sees in the room
    const liveIds = new Set<string>();
    liveIds.add(me.me!.userId);
    for (const id of r.remoteParticipants.keys()) liveIds.add(id);

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
  }) {
    if (isConnecting.value) return;

    isConnecting.value = true;
    isConnected.value = false;

    if (room.value) {
      await leave();
      return;
    }

    // adaptiveStream makes the SFU send each video at the size its tile is drawn at and
    // pause it when the tile isn't visible; dynacast then lets publishers drop the layers
    // nobody ended up consuming. Both are read once here — see adaptiveSettingPending.
    const adaptive = preference.adaptiveVideoQuality;
    adaptiveStreamActive.value = adaptive;

    const r = new Room({
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
    });
    room.value = r;

    // Warm DNS/TLS to the SFU while we spend up to 2s probing TURN below, so
    // connect() lands on an already-open connection. Failures are swallowed by
    // the SDK — this is a hint, never a prerequisite for connect().
    void r.prepareConnection(opts.rts.endpoint, opts.token);

    r.on("participantConnected", async (p: RemoteParticipant) => {
      logger.info(`[CALL] participantConnected event:`, p.identity);
      await addParticipant(p);
    });

    r.on("participantDisconnected", (p) => {
      const uid = p.identity;
      delete participants[uid];
      speaking.delete(uid);
      deleteVideoTracksForUser(uid);
      diagnostics.delete(uid);
      participantQuality.delete(uid);
      subscriptionErrors.delete(uid);

      // Remove guest user from realtime channel
      const isGuest = uid.toLowerCase().startsWith("fafccccc");
      if (
        isGuest &&
        mode.value === "channel" &&
        connectedVoiceChannelId.value
      ) {
        pool._realtimeStore.removeUserFromChannel(
          connectedVoiceChannelId.value,
          uid,
        );
        logger.info(`[CALL] Removed guest ${uid} from realtime channel`);
      }

      tone.playSoftLeaveSound();
    });
    r.on("participantActive", (p) => {
      tone.playSoftEnterSound();
    });
    r.on("trackSubscribed", onTrackSubscribed);
    r.on("trackUnsubscribed", onTrackUnsubscribed);

    r.on("connectionStateChanged", (st) => {
      isConnected.value = st === "connected";
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
      participantQuality.set(participant.identity, quality);
      if (isLocalParticipant(participant)) networkQuality.value = quality;
    });

    r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      activeSpeakerId.value = speakers[0]?.identity ?? null;
    });

    r.on(RoomEvent.TrackSubscriptionFailed, (trackSid, participant, reason) => {
      const message = describeSubscriptionError(reason);
      logger.error(`[CALL] track subscription failed for ${participant.identity}`, {
        trackSid,
        reason,
      });
      subscriptionErrors.set(participant.identity, message);
    });

    r.on(RoomEvent.TrackSubscribed, (_t, _pub, participant) => {
      subscriptionErrors.delete(participant.identity);
    });

    r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      audioPlaybackBlocked.value = !r.canPlaybackAudio;
      if (audioPlaybackBlocked.value) {
        logger.warn("[CALL] audio playback blocked by the browser");
      }
    });

    r.on(RoomEvent.VideoPlaybackStatusChanged, () => {
      videoPlaybackBlocked.value = !r.canPlaybackVideo;
      if (videoPlaybackBlocked.value) {
        logger.warn("[CALL] video playback blocked by the browser");
      }
    });

    r.on("reconnecting", () => (isReconnecting.value = true));
    r.on("reconnected", () => (isReconnecting.value = false));

    r.on("disconnected", () => {
      isReconnecting.value = false;
      ping.value = -1;
      stopTimerRTT();
    });

    r.localParticipant.on("localTrackCpuConstrained", () => {
      logger.warn("[CALL] Local track CPU constrained — performance degradation");
      isCpuConstrained.value = true;
      if (cpuConstrainedResetTimer) clearTimeout(cpuConstrainedResetTimer);
      cpuConstrainedResetTimer = setTimeout(() => {
        isCpuConstrained.value = false;
        cpuConstrainedResetTimer = null;
      }, 10_000);
    });

    function isStun(url: string) {
      return url.startsWith("stun:");
    }

    function isTurn(url: string) {
      return url.startsWith("turn:");
    }

    function normalizeUrls(urls: string | string[]) {
      return Array.isArray(urls) ? urls : [urls];
    }

    try {
      const stunServers: RTCIceServer[] = opts.rts.ices.flatMap((x) =>
        normalizeUrls(x.endpoint)
          .filter(isStun)
          .map((url) => ({ urls: url })),
      );

      // Check TURN servers aggressively in parallel
      const turnServers: RTCIceServer[] = [];
      const turnConfigs = opts.rts.ices.filter((x) =>
        normalizeUrls(x.endpoint).some(isTurn),
      );

      if (turnConfigs.length > 0) {
        logger.info(`[CALL] Testing ${turnConfigs.length} TURN servers...`);

        const probePromises = turnConfigs.flatMap((turnConfig) => {
          const turnUrls = normalizeUrls(turnConfig.endpoint).filter(isTurn);
          return turnUrls.map(async (turnUrl) => {
            const isAlive = await probeTurn(
              {
                endpoint: turnUrl,
                username: turnConfig.username || "",
                password: turnConfig.password || "",
              },
              2000, // 2s timeout for real data transfer test
            );

            if (isAlive) {
              logger.info(`[CALL] ✓ TURN OK: ${turnUrl}`);
              return {
                urls: turnUrl,
                username: turnConfig.username,
                credential: turnConfig.password,
              };
            } else {
              logger.warn(`[CALL] ✗ TURN DEAD: ${turnUrl}`);
              return null;
            }
          });
        });

        const results = await Promise.allSettled(probePromises);
        results.forEach((result) => {
          if (result.status === "fulfilled" && result.value) {
            turnServers.push(result.value);
          }
        });

        logger.info(`[CALL] TURN results: ${turnServers.length}/${turnConfigs.length} alive`);
      }

      const allIceServers = [...stunServers, ...turnServers];

      logger.warn("LiveKit connecting...", opts.rts.endpoint, {
        stun: stunServers.length,
        turn: turnServers.length,
      });

      await r.connect(opts.rts.endpoint, opts.token, {
        rtcConfig: {
          iceServers: allIceServers,
          iceCandidatePoolSize: 10,
          iceTransportPolicy: "all",
        },
      });
    } catch (err) {
      logger.error("LiveKit connect failed", err);
      await leave();
      connectError.value = { message: formatConnectError(err) };
      return;
    }

    try {
      const audioCtx = audio.getCurrentAudioContext();

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

      // Clone the track for LiveKit - this way if LiveKit stops the track on disconnect,
      // it won't affect our original virtual stream
      const clonedTrackForLiveKit = virtualTrack.clone();

      // Create LocalAudioTrack from cloned track
      // userProvidedTrack=true tells LiveKit not to manage this track internally
      const mic = new LocalAudioTrack(
        clonedTrackForLiveKit,
        undefined,
        true,
        audioCtx,
      );
      mic.source = Track.Source.Microphone;

      const shouldMuteMic = sys.microphoneMuted;

      logger.info(
        `[CALL] Publishing virtual mic track with initial state: micMuted=${shouldMuteMic}, headphoneMuted=${sys.headphoneMuted}`,
      );

      // simulcast/degradationPreference are video-only and were carried over from an
      // older SDK; the SDK now also picks the right degradation preference per source.
      await r.localParticipant.publishTrack(mic, {
        red: true,
        stopMicTrackOnMute: false,
        audioPreset: AudioPresets.musicStereo,
        forceStereo: true,
      });

      // Setup speaking detector using VU meter from AudioManager (runs in AudioWorklet thread)
      disposables.addSubscription(
        await setupLocalSpeakingDetector(opts.selfId),
      );

      // Mute IMMEDIATELY after publishing if needed (before attributes)
      if (shouldMuteMic) {
        logger.info("[CALL] Muting mic AFTER publish");
        await mic.mute();
      }

      // Set initial attributes for local participant IMMEDIATELY after mute
      await r.localParticipant.setAttributes({
        isMutedAll: sys.headphoneMuted ? "true" : "false",
        isScreencast: "false",
      });

      logger.info(
        `[CALL] Local participant published with muted=${mic.isMuted}, attributes set`,
      );

      const mutedSub = sys.muteEvent.subscribe((x) => {
        if (x) mic.mute();
        else mic.unmute();
      });

      const mutedAllSub = sys.muteHeadphoneEvent.subscribe((x) => {
        r.localParticipant.setAttributes({
          isMutedAll: x ? "true" : "false",
          isScreencast: "false",
        });

        applyMuteAllToExistingParticipants(x);
      });

      // No need to set processor - virtual stream already goes through AudioManager's processing chain
      // No need to handle device changes - AudioManager handles it internally and virtual stream stays the same

      disposables.addSubscription(mutedSub);
      disposables.addSubscription(mutedAllSub);

      const audioErrorSub = audio.onAudioDeviceError((err) => {
        logger.error(`[CALL] Audio device error (${err.type}):`, err.message);
        audioDeviceError.value = { type: err.type, message: err.message };
      });
      disposables.addSubscription(audioErrorSub);
    } catch (err) {
      logger.error("mic publish failed", err);
      await leave();
      connectError.value = { message: formatConnectError(err) };
      return;
    }

    isConnecting.value = false;
    isConnected.value = true;
    // The events only fire on a change, so take the initial readings ourselves.
    audioPlaybackBlocked.value = !r.canPlaybackAudio;
    videoPlaybackBlocked.value = !r.canPlaybackVideo;
    tone.playSoftEnterSound();

    // Process already connected participants
    logger.info(
      `[CALL] Processing ${r.remoteParticipants.size} already connected participants`,
    );
    for (const [uid, participant] of r.remoteParticipants) {
      await addParticipant(participant);
    }
  }

  async function probeTurn(
    turn: {
      endpoint: string;
      username: string;
      password: string;
    },
    timeoutMs = 3000,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let pc1: RTCPeerConnection | null = null;
      let pc2: RTCPeerConnection | null = null;
      let settled = false;
      let dataReceived = false;

      const cleanup = () => {
        if (pc1) pc1.close();
        if (pc2) pc2.close();
        pc1 = null;
        pc2 = null;
      };

      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(false);
      };

      const ok = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };

      try {
        // Create two peer connections - both forced to use TURN relay only
        const config = {
          iceServers: [
            {
              urls: turn.endpoint,
              username: turn.username,
              credential: turn.password,
            },
          ],
          iceTransportPolicy: "relay" as RTCIceTransportPolicy,
        };

        pc1 = new RTCPeerConnection(config);
        pc2 = new RTCPeerConnection(config);

        // Setup data channel
        const dc = pc1.createDataChannel("probe");
        const testMessage = "ping";

        dc.onopen = () => {
          try {
            dc.send(testMessage);
          } catch (err) {
            fail();
          }
        };

        dc.onerror = fail;

        // Receive data on pc2
        pc2.ondatachannel = (event) => {
          const remoteChannel = event.channel;
          remoteChannel.onmessage = (msg) => {
            if (msg.data === testMessage) {
              dataReceived = true;
              ok(); // Real data transfer successful!
            }
          };
          remoteChannel.onerror = fail;
        };

        // ICE candidate exchange
        pc1.onicecandidate = (e) => {
          if (e.candidate) {
            pc2?.addIceCandidate(e.candidate).catch(fail);
          }
        };

        pc2.onicecandidate = (e) => {
          if (e.candidate) {
            pc1?.addIceCandidate(e.candidate).catch(fail);
          }
        };

        // Monitor connection state
        pc1.oniceconnectionstatechange = () => {
          if (pc1!.iceConnectionState === "failed") {
            fail();
          }
        };

        pc2.oniceconnectionstatechange = () => {
          if (pc2!.iceConnectionState === "failed") {
            fail();
          }
        };

        // Start signaling
        pc1
          .createOffer()
          .then((offer) => pc1!.setLocalDescription(offer))
          .then(() => pc2!.setRemoteDescription(pc1!.localDescription!))
          .then(() => pc2!.createAnswer())
          .then((answer) => pc2!.setLocalDescription(answer))
          .then(() => pc1!.setRemoteDescription(pc2!.localDescription!))
          .catch(fail);

        // Timeout
        setTimeout(() => {
          if (!settled) {
            if (!dataReceived) {
              fail();
            }
          }
        }, timeoutMs);
      } catch (err) {
        fail();
      }
    });
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
        disposables.addSubscription(setupScreenAudioGraph(uid, track));
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
      disposables.addSubscription(setupAudioGraph(uid, track));
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
      videoTracks.delete(videoTrackKey(uid, source));
      pausedVideoTracks.delete(videoTrackKey(uid, source));
      return;
    }

    if (track.kind === "audio") {
      track.detach();
      const pdata = participants[uid];
      const isScreenAudio =
        (track.source || pub.source) === Track.Source.ScreenShareAudio;
      if (isScreenAudio) {
        if (pdata?.screenAudioGraph) {
          pdata.screenAudioGraph.dispose();
          pdata.screenAudioGraph = null;
        }
        return;
      }
      // Dispose mic audio graph if exists
      if (pdata?.audioGraph) {
        pdata.audioGraph.dispose();
        pdata.audioGraph = null;
      }
    }
  }

  function setupAudioGraph(userId: string, track: RemoteTrack) {
    const pdata = participants[userId];
    if (pdata?.audioGraph) {
      logger.error(
        `[CALL] setupAudioGraph called for ${userId} but audioGraph already exists! Preventing duplicate.`,
      );
      return new Subscription(() => {}); // Return empty subscription
    }

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

    return new Subscription(() => {
      speaking.delete(userId);
      audioGraph.dispose();
    });
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
      return new Subscription(() => {});
    }

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

    return new Subscription(() => {
      screenAudioGraph.dispose();
    });
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

    const fr = opts.frameRate ?? 30;

    // On the desktop host, tell the main process which source to provide before
    // calling getDisplayMedia (it is intercepted by setDisplayMediaRequestHandler).
    // Elsewhere the host supplies a no-op and the browser shows its own picker.
    if (opts.deviceId) {
      await config.selectScreenSource(opts.deviceId, opts.systemAudio === "include");
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
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

    const vid = new LocalVideoTrack(stream.getVideoTracks()[0]);
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
      }
    }

    isSharing.value = true;
    lastShareOpts.value = { ...opts };
    systemAudioEnabled.value = opts.systemAudio === "include";

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

    try {
      // Prompt for camera access before capturing (macOS native host only — elsewhere a no-op).
      await ensureMediaPermission("camera");

      const dev = deviceId || preference.defaultVideoDevice || undefined;
      const cam = await createLocalVideoTrack({
        deviceId: dev,
        resolution: VideoPresets.h720.resolution,
      });

      // No simulcast flag: vp9 is SVC, so the layers come from scalabilityMode
      // (L3T3_KEY) in a single encode and the flag is ignored.
      cameraTrackPub = await room.value.localParticipant.publishTrack(cam, {
        videoEncoding: VideoPresets.h720.encoding,
      });
      isCameraOn.value = true;

      // Add local video to videoTracks so ParticipantCard shows it
      const localId = me.me!.userId;
      videoTracks.set(videoTrackKey(localId, Track.Source.Camera), cam);

      cameraTrackPub.once("ended", () => stopCamera());
    } catch (err) {
      logger.error("[CALL] Failed to start camera:", err);
    }
  }

  async function stopCamera() {
    if (cameraTrackPub) {
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
  ];

  /**
   * Tear the manager down for good: end any call and stop listening to the bus. The app
   * never calls this (the store lives as long as the page), but a package that keeps
   * subscriptions has to offer a way to release them.
   */
  async function dispose() {
    await leave();
    for (const sub of busSubscriptions) sub.unsubscribe();
    busSubscriptions.length = 0;
  }

  return {
    dispose,
    mode,
    room,
    callId,
    targetId,
    connectedVoiceChannelId,
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
