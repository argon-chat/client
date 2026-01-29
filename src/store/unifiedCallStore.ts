import { defineStore } from "pinia";
import {
  Room,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  LocalVideoTrack,
  ScreenShareCaptureOptions,
  Track,
  LocalAudioTrack,
  AudioPresets,
} from "livekit-client";
import { ref, reactive, computed } from "vue";

import { audio, type RemoteAudioGraph } from "@/lib/audio/AudioManager";
import { useApi } from "./apiStore";
import { usePoolStore } from "./poolStore";
import { useTone } from "./toneStore";
import { logger } from "@argon/core";
import { useMe } from "./meStore";
import { useBus } from "./busStore";
import { useUserVolumeStore } from "./userVolumeStore";
import { useRealtimeStore } from "./realtimeStore";

import {
  CallIncoming,
  CallFinished,
  CallAccepted,
  RtcEndpoint,
} from "@argon/glue";
import { startTimer } from "@argon/core";
import { useSystemStore } from "./systemStore";
import { DisposableBag } from "@argon/core";
import { Subscription } from "rxjs";

export const useUnifiedCall = defineStore("unifiedCall", () => {
  const api = useApi();
  const pool = usePoolStore();
  const tone = useTone();
  const me = useMe();
  const bus = useBus();
  const sys = useSystemStore();
  const userVolume = useUserVolumeStore();
  const realtimeStore = useRealtimeStore();

  const mode = ref<"none" | "dm" | "channel">("none");

  const room = ref<Room | null>(null);

  const callId = ref<string | null>(null);
  const targetId = ref<string | null>(null);
  const connectedVoiceChannelId = ref<string | null>(null);

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
      }
    >
  >({});

  const videoTracks = reactive(new Map<string, RemoteTrack>());

  const speaking = reactive(new Set<string>());

  const incoming = ref<CallIncoming | null>(null);

  const isSharing = ref(false);
  let screenTrackPub: any = null;

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
    if (ping.value < 0) return "NONE";
    if (ping.value < 50) return "GREEN";
    if (ping.value < 100) return "ORANGE";
    return "RED";
  });

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

    isConnecting.value = false;
    isConnected.value = false;
    isReconnecting.value = false;

    Object.keys(participants).forEach((key) => delete participants[key]);
    videoTracks.clear();
    speaking.clear();
    incoming.value = null;

    stopTimerRTT();
    ping.value = -1;
    disposables.dispose();

    isSharing.value = false;
    screenTrackPub = null;

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

    await joinLiveKit({
      token: join.token,
      callId: callId.value!,
      selfId: me.me!.userId,
      rts: join.rtc,
    });

    startTimersRTT();
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

    participants[uid] = {
      userId: uid,
      displayName,
      muted: isInitiallyMuted,
      volume: [savedVolume],
      audioGraph: null,
      mutedAll: isInitiallyMutedAll,
      screencast: isInitiallyScreencast,
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
        logger.info(
          `[ATTRIBUTES] ${uid} mutedAll=${pm.mutedAll} screencast=${pm.screencast}`,
        );
      }
    });
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

        const diag = {
          // Audio Inbound RTP
          audioPacketsLost: parsed.inboundAudio?.packetsLost ?? null,
          audioJitter: parsed.inboundAudio?.jitter ?? null,
          audioBytesReceived: parsed.inboundAudio?.bytesReceived ?? null,
          audioLevel: parsed.inboundAudio?.audioLevel ?? null,

          // Video Inbound RTP (если есть)
          videoPacketsLost: parsed.inboundVideo?.packetsLost ?? null,
          videoJitter: parsed.inboundVideo?.jitter ?? null,

          // Resolution
          width: parsed.inboundVideo?.frameWidth ?? null,
          height: parsed.inboundVideo?.frameHeight ?? null,

          // Codec
          codec: parsed.codec?.mimeType ?? null,

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

  function parseRtcStats(raw: any[]): any {
    const stats: any = {
      inboundAudio: null,
      inboundVideo: null,
      outboundAudio: null,
      outboundVideo: null,
      candidatePair: null,
      codec: null,
      transport: null,
      playout: null,
    };

    for (const [id, s] of raw) {
      switch (s.type) {
        case "inbound-rtp":
          if (s.kind === "audio") stats.inboundAudio = s;
          if (s.kind === "video") stats.inboundVideo = s;
          break;

        case "remote-outbound-rtp":
          if (s.kind === "audio") stats.outboundAudio = s;
          if (s.kind === "video") stats.outboundVideo = s;
          break;

        case "candidate-pair":
          if (s.state === "succeeded") stats.candidatePair = s;
          break;

        case "transport":
          stats.transport = s;
          break;

        case "codec":
          stats.codec = s;
          break;

        case "media-playout":
          stats.playout = s;
          break;
      }
    }

    return stats;
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

    const r = new Room({
      loggerName: `${callId.value}-room`,
      webAudioMix: {
        audioContext: audio.getCurrentAudioContext(),
      },
    });
    room.value = r;

    r.on("participantConnected", async (p: RemoteParticipant) => {
      logger.info(`[CALL] participantConnected event:`, p.identity);
      await addParticipant(p);
    });

    r.on("participantDisconnected", (p) => {
      const uid = p.identity;
      delete participants[uid];
      speaking.delete(uid);
      if (videoTracks.has(uid)) videoTracks.delete(uid);

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

    r.on("reconnecting", () => (isReconnecting.value = true));
    r.on("reconnected", () => (isReconnecting.value = false));

    r.on("disconnected", () => {
      isReconnecting.value = false;
      ping.value = -1;
      stopTimerRTT();
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

      // Check TURN servers in parallel (non-blocking)
      const turnServers: RTCIceServer[] = [];
      const turnConfigs = opts.rts.ices.filter((x) =>
        normalizeUrls(x.endpoint).some(isTurn),
      );

      if (turnConfigs.length > 0) {
        logger.info(`[CALL] Probing ${turnConfigs.length} TURN servers in parallel...`);

        const probePromises = turnConfigs.flatMap((turnConfig) => {
          const turnUrls = normalizeUrls(turnConfig.endpoint).filter(isTurn);
          return turnUrls.map(async (turnUrl) => {
            const isAlive = await probeTurn(
              {
                endpoint: turnUrl,
                username: turnConfig.username || "",
                password: turnConfig.password || "",
              },
              1500, // Shorter timeout for parallel probing
            );

            if (isAlive) {
              logger.info(`[CALL] TURN server alive: ${turnUrl}`);
              return {
                urls: turnUrl,
                username: turnConfig.username,
                credential: turnConfig.password,
              };
            } else {
              logger.warn(`[CALL] TURN server dead, skipping: ${turnUrl}`);
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
      }

      const allIceServers = [...stunServers, ...turnServers];

      logger.warn("LiveKit connecting...", opts.rts.endpoint, {
        stun: stunServers.length,
        turn: turnServers.length,
        iceServers: allIceServers,
      });

      await r.connect(opts.rts.endpoint, opts.token, {
        rtcConfig: {
          iceServers: allIceServers,
        },
      });
    } catch (err) {
      logger.error("LiveKit connect failed", err);
      await leave();
      return;
    }

    try {
      const audioCtx = audio.getCurrentAudioContext();

      // Use virtual input stream from AudioManager - it already handles:
      // - Device selection & switching
      // - Input volume control via inputGainNode
      // - Audio processing chain
      const virtualStream = await audio.getVirtualInputStream();
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

      await r.localParticipant.publishTrack(mic, {
        red: true,
        simulcast: true,
        stopMicTrackOnMute: false,
        audioPreset: AudioPresets.musicStereo,
        forceStereo: true,
        degradationPreference: "maintain-resolution",
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
    } catch (err) {
      logger.error("mic publish failed", err);
      await leave();
      return;
    }

    isConnecting.value = false;
    isConnected.value = true;
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
    return new Promise<boolean>(async (resolve) => {
      const pc = new RTCPeerConnection({
        iceServers: [
          {
            urls: turn.endpoint,
            username: turn.username,
            credential: turn.password,
          },
        ],
        iceTransportPolicy: "relay",
        bundlePolicy: "max-bundle",
      });

      let settled = false;
      let hasRelayCandidates = false;

      const fail = () => {
        if (settled) return;
        settled = true;
        pc.close();
        resolve(false);
      };

      const ok = () => {
        if (settled) return;
        settled = true;
        pc.close();
        resolve(true);
      };

      // Check for relay candidates (means TURN is working)
      pc.onicecandidate = (event) => {
        if (event.candidate?.type === "relay") {
          hasRelayCandidates = true;
          logger.info(`[TURN] Relay candidate found for ${turn.endpoint}`);
          ok();
        }
      };

      // Monitor ICE gathering state
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          if (hasRelayCandidates) {
            ok();
          } else {
            logger.warn(`[TURN] No relay candidates found for ${turn.endpoint}`);
            fail();
          }
        }
      };

      // Monitor connection state
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          fail();
        } else if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          ok();
        }
      };

      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
      } catch (err) {
        logger.error(`[TURN] Failed to create offer for ${turn.endpoint}`, err);
        fail();
      }

      setTimeout(() => {
        if (!settled) {
          logger.warn(`[TURN] Probe timeout for ${turn.endpoint}`);
          fail();
        }
      }, timeoutMs);
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
      const savedVolume = userVolume.getUserVolume(uid);
      participants[uid] = {
        userId: uid,
        displayName: info?.displayName ?? "User",
        muted: pub.isMuted,
        volume: [savedVolume],
        audioGraph: null,
        mutedAll: false,
        screencast: false,
      };
    }

    if (track.kind === Track.Kind.Video) {
      videoTracks.set(uid, track);
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      // Check if audio graph already exists for this user
      const existing = participants[uid];
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
      videoTracks.delete(uid);
      return;
    }

    if (track.kind === "audio") {
      track.detach();
      // Dispose audio graph if exists
      const pdata = participants[uid];
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

  function setVolume(userId: string, vol: number, skipSave = false) {
    const u = participants[userId];
    if (!u || !u.audioGraph) return;

    u.audioGraph.setVolume(vol);
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

  async function startScreenShare(opts: {
    deviceId: string | null;
    systemAudio: "include" | "exclude";
  }) {
    if (!room.value) return;

    let oo = {};

    if (opts.deviceId) {
      oo = {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: opts.deviceId,
        },
      } as any;
    } else {
      oo = true;
    }

    const capture: ScreenShareCaptureOptions = {
      video: oo as any,
      audio: false,
      systemAudio: opts.systemAudio,
    };

    const stream = await navigator.mediaDevices.getDisplayMedia(capture);

    const vid = new LocalVideoTrack(stream.getTracks()[0]);
    vid.source = Track.Source.ScreenShare;

    screenTrackPub = await room.value.localParticipant.publishTrack(vid);
    isSharing.value = true;

    screenTrackPub.once("ended", () => stopScreenShare());
  }

  async function stopScreenShare() {
    if (screenTrackPub) {
      await room.value?.localParticipant.setScreenShareEnabled(false);
      screenTrackPub = null;
      isSharing.value = false;
    }
  }

  bus.onServerEvent<CallIncoming>("CallIncoming", handleIncoming);

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
  });

  bus.onServerEvent<CallAccepted>("CallAccepted", (ev) =>
    logger.info("[CALL] CallAccepted", ev),
  );

  return {
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
    speaking,
    incoming,

    isSharing,

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
    startScreenShare,
    stopScreenShare,
    setVolume,
    leave,
  };
});
