// @argon/calls - Call Manager
// Core call management logic extracted from unifiedCallStore

import {
  Room,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  LocalVideoTrack,
  createLocalAudioTrack,
  ScreenShareCaptureOptions,
  Track,
  LocalAudioTrack,
  AudioPresets,
} from "livekit-client";
import { ref, shallowRef, shallowReactive, reactive, computed, type Ref, type ShallowRef, type ComputedRef } from "vue";
import { Subscription } from "rxjs";
import { logger, DisposableBag } from "@argon/core";
import type { CallIncoming, CallFinished, CallAccepted, RtcEndpoint } from "@argon/glue";

import type {
  CallManagerConfig,
  CallParticipant,
  RtcDiagnostics,
  ConnectionQuality,
  CallMode,
} from "./types";
import { parseRtcStats } from "./rtcStats";
import { createSpeakingDetector } from "./speakingDetector";

export interface CallManager {
  // State
  readonly mode: Ref<CallMode>;
  readonly room: ShallowRef<Room | null>;
  readonly callId: Ref<string | null>;
  readonly targetId: Ref<string | null>;
  readonly connectedVoiceChannelId: Ref<string | null>;
  readonly isConnected: Ref<boolean>;
  readonly isConnecting: Ref<boolean>;
  readonly isReconnecting: Ref<boolean>;
  readonly participants: Record<string, CallParticipant>;
  readonly videoTracks: Map<string, RemoteTrack>; // reactive Map
  readonly speaking: Set<string>; // reactive Set
  readonly incoming: Ref<CallIncoming | null>;
  readonly isSharing: Ref<boolean>;
  readonly ping: Ref<number>;
  readonly pingHistory: Array<{ timestamp: number; value: number }>;
  readonly averagePing: ComputedRef<number>;
  readonly qualityConnection: ComputedRef<ConnectionQuality>;
  readonly diagnostics: Map<string, RtcDiagnostics>;

  // Actions
  startDirectCall(targetUserId: string): Promise<void>;
  acceptIncomingCall(): Promise<void>;
  rejectIncomingCall(): Promise<void>;
  joinVoiceChannel(channelId: string): Promise<void>;
  leave(): Promise<void>;
  startScreenShare(opts: { deviceId: string | null; systemAudio: "include" | "exclude" }): Promise<void>;
  stopScreenShare(): Promise<void>;
  setVolume(userId: string, volume: number, skipSave?: boolean): void;

  // Cleanup
  dispose(): void;
}

/**
 * Create a call manager instance with injected dependencies
 */
export function createCallManager(config: CallManagerConfig): CallManager {
  const {
    audio,
    api,
    userPool,
    eventBus,
    tones,
    system,
    userVolume,
    currentUser,
    onRealtimeUpdate,
  } = config;

  const disposables = new DisposableBag();

  // State
  const mode = ref<CallMode>("none");
  const room = shallowRef<Room | null>(null);
  const callId = ref<string | null>(null);
  const targetId = ref<string | null>(null);
  const connectedVoiceChannelId = ref<string | null>(null);

  const isConnecting = ref(false);
  const isConnected = ref(false);
  const isReconnecting = ref(false);

  const diagnostics = reactive(new Map<string, RtcDiagnostics>());
  let rtcTimer: ReturnType<typeof setInterval> | null = null;

  const participants = reactive<Record<string, CallParticipant>>({});
  const videoTracks = shallowReactive(new Map<string, RemoteTrack>());
  const speaking = shallowReactive(new Set<string>());

  const incoming = ref<CallIncoming | null>(null);

  const isSharing = ref(false);
  let screenTrackPub: any = null;

  const ping = ref(-1);
  const pingHistory = reactive<Array<{ timestamp: number; value: number }>>([]);
  const maxPingHistorySize = 600;

  const averagePing = computed(() => {
    if (pingHistory.length === 0) return -1;
    const sum = pingHistory.reduce((acc, item) => acc + item.value, 0);
    return Math.round(sum / pingHistory.length);
  });

  const qualityConnection = computed<ConnectionQuality>(() => {
    if (averagePing.value === -1) return "poor";
    if (averagePing.value < 50) return "excellent";
    if (averagePing.value < 100) return "good";
    if (averagePing.value < 200) return "fair";
    return "poor";
  });

  let pingInterval: ReturnType<typeof setInterval> | null = null;

  // Internal methods
  function startRtcDiagnostics() {
    if (rtcTimer) clearInterval(rtcTimer);
    rtcTimer = setInterval(updateRtcStats, 1000);
  }

  function stopRtcDiagnostics() {
    if (rtcTimer) clearInterval(rtcTimer);
    rtcTimer = null;
  }

  async function updateRtcStats() {
    if (!room.value) return;

    for (const [uid, participant] of room.value.remoteParticipants) {
      const firstTrack = participant.getTrackPublications().at(0);

      try {
        const rtcStats = await firstTrack?.audioTrack?.getRTCStatsReport();
        const raw = rtcStats?.entries().toArray();
        if (!raw || raw.length === 0) continue;

        const parsed = parseRtcStats(raw);

        const diag: RtcDiagnostics = {
          audioPacketsLost: parsed.inboundAudio?.packetsLost ?? null,
          audioJitter: parsed.inboundAudio?.jitter ?? null,
          audioBytesReceived: parsed.inboundAudio?.bytesReceived ?? null,
          audioLevel: parsed.inboundAudio?.audioLevel ?? null,
          videoPacketsLost: parsed.inboundVideo?.packetsLost ?? null,
          videoJitter: parsed.inboundVideo?.jitter ?? null,
          width: parsed.inboundVideo?.frameWidth ?? null,
          height: parsed.inboundVideo?.frameHeight ?? null,
          codec: parsed.codec?.mimeType ?? null,
          rtt: parsed.candidatePair?.currentRoundTripTime ?? null,
          bitrateKbps: parsed.candidatePair?.availableOutgoingBitrate
            ? Math.round(parsed.candidatePair.availableOutgoingBitrate / 1000)
            : null,
          transportPacketsSent: parsed.transport?.packetsSent ?? null,
          transportPacketsReceived: parsed.transport?.packetsReceived ?? null,
          playoutDelay: parsed.playout?.totalPlayoutDelay ?? null,
        };

        diagnostics.set(uid, diag);
      } catch {}
    }
  }

  function startTimersRTT() {
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(async () => {
      if (!room.value) return;

      try {
        // @ts-expect-error - RTT access varies by livekit version
        const latency = room.value.engine.client?.currentRTT ?? room.value.engine.latency ?? 0;
        const pingMs = Math.round(latency);
        ping.value = pingMs;

        pingHistory.push({ timestamp: Date.now(), value: pingMs });
        if (pingHistory.length > maxPingHistorySize) {
          pingHistory.shift();
        }
      } catch {}
    }, 1000);
  }

  function stopTimerRTT() {
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = null;
  }

  async function handleIncoming(ev: CallIncoming) {
    logger.info("[CALL] Incoming call:", ev);
    incoming.value = ev;
    tones.playRingSound();
  }

  async function addParticipant(p: RemoteParticipant) {
    const uid = p.identity;
    if (participants[uid]) {
      logger.warn(`[CALL] addParticipant: participant ${uid} already exists`);
      return;
    }

    const info = await userPool.getUser(uid);
    const savedVolume = userVolume.getUserVolume(uid);

    participants[uid] = {
      userId: uid,
      displayName: info?.displayName ?? "User",
      muted: false,
      mutedAll: false,
      screencast: false,
      volume: [savedVolume],
      gain: null,
    };

    // Attributes
    const attrs = p.attributes;
    if (attrs) {
      const pm = participants[uid];
      pm.mutedAll = attrs.isMutedAll === "true";
      pm.screencast = attrs.isScreencast === "true";
      logger.info(`[ATTRIBUTES] ${uid} mutedAll=${pm.mutedAll} screencast=${pm.screencast}`);
    }

    p.on("attributesChanged", (x) => {
      const pm = participants[uid];
      if (pm && x) {
        pm.mutedAll = x.isMutedAll === "true";
        pm.screencast = x.isScreencast === "true";
        logger.info(`[ATTRIBUTES] ${uid} mutedAll=${pm.mutedAll} screencast=${pm.screencast}`);
      }
    });
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
      tones.playSoftLeaveSound();
    });

    r.on("participantActive", () => {
      tones.playSoftEnterSound();
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

    try {
      logger.warn("LiveKit connecting...", opts.rts.endpoint);
      await r.connect(opts.rts.endpoint, opts.token, {
        rtcConfig: {
          bundlePolicy: "max-bundle",
          iceTransportPolicy: "all",
          rtcpMuxPolicy: "require",
          iceServers: [
            ...opts.rts.ices.map((x) => ({
              urls: x.endpoint,
              username: x.username,
              credential: x.password,
            })),
          ],
        },
      });
    } catch (err) {
      logger.error("LiveKit connect failed", err);
      await leave();
      return;
    }

    try {
      const audioCtx = audio.getCurrentAudioContext();
      const mic = await createLocalAudioTrack({
        deviceId: audio.getInputDevice().value ?? undefined,
        noiseSuppression: false,
        echoCancellation: false,
        autoGainControl: false,
        voiceIsolation: false,
        channelCount: 2,
      });

      mic.setAudioContext(audioCtx);

      const shouldMuteMic = system.microphoneMuted;

      logger.info(`[CALL] Publishing track with initial state: micMuted=${shouldMuteMic}, headphoneMuted=${system.headphoneMuted}`);

      await r.localParticipant.publishTrack(mic, {
        red: true,
        simulcast: true,
        stopMicTrackOnMute: false,
        audioPreset: AudioPresets.musicStereo,
        forceStereo: true,
        degradationPreference: "maintain-resolution",
      });

      // Setup speaking detector AFTER publish
      disposables.addSubscription(
        createSpeakingDetector({
          audioContext: audioCtx,
          mediaStreamTrack: mic.mediaStreamTrack,
          userId: opts.selfId,
          isMuted: () => system.microphoneMuted,
          onSpeakingChange: (userId, isSpeaking) => {
            if (isSpeaking) speaking.add(userId);
            else speaking.delete(userId);
          },
        })
      );

      // Mute IMMEDIATELY after publishing if needed
      if (shouldMuteMic) {
        logger.info("[CALL] Muting mic AFTER publish");
        await mic.mute();
      }

      // Set initial attributes
      await r.localParticipant.setAttributes({
        isMutedAll: system.headphoneMuted ? "true" : "false",
        isScreencast: "false",
      });

      logger.info(`[CALL] Local participant published with muted=${mic.isMuted}, attributes set`);

      const mutedSub = system.muteEvent.subscribe((x) => {
        if (x) mic.mute();
        else mic.unmute();
      });

      const mutedAllSub = system.muteHeadphoneEvent.subscribe((x) => {
        r.localParticipant.setAttributes({
          isMutedAll: x ? "true" : "false",
          isScreencast: "false",
        });
        applyMuteAllToExistingParticipants(x);
      });

      const processor = audio.createRtcProcessor();
      if (processor) {
        // @ts-expect-error - AudioWorkletNode is compatible with TrackProcessor at runtime
        mic.setProcessor(processor);
      }

      const onIdc = audio.onInputDeviceChanged(async (devId) => {
        logger.warn("audio input device has changed");

        const localParticipant = r.localParticipant;
        const publication = Array.from(localParticipant.trackPublications.values())
          .filter((x) => x.source == Track.Source.Microphone)
          .at(0);

        const newTrack = await createLocalAudioTrack({
          deviceId: devId,
          noiseSuppression: false,
          echoCancellation: false,
          autoGainControl: false,
          voiceIsolation: false,
          channelCount: 2,
        });
        newTrack.setAudioContext(audio.getCurrentAudioContext());
        const newProcessor = audio.createRtcProcessor();
        if (newProcessor) {
          // @ts-expect-error - AudioWorkletNode is compatible with TrackProcessor at runtime
          newTrack.setProcessor(newProcessor);
        }

        if (publication?.track instanceof LocalAudioTrack) {
          try {
            await publication.track.replaceTrack(newTrack.mediaStreamTrack);
            logger.info("Microphone successfully replaced");
          } catch (err) {
            console.error("Failed to replace microphone", err);
          }
        } else {
          await localParticipant.publishTrack(newTrack);
        }
      });

      disposables.addSubscription(onIdc);
      disposables.addSubscription(mutedSub);
      disposables.addSubscription(mutedAllSub);
    } catch (err) {
      logger.error("mic publish failed", err);
      await leave();
      return;
    }

    isConnecting.value = false;
    isConnected.value = true;
    tones.playSoftEnterSound();

    // Process already connected participants
    logger.info(`[CALL] Processing ${r.remoteParticipants.size} already connected participants`);
    for (const [uid, participant] of r.remoteParticipants) {
      await addParticipant(participant);
    }
  }

  function applyMuteAllToExistingParticipants(isMutedAll: boolean) {
    if (!room.value) return;

    Object.values(participants).forEach((x) => {
      if (isMutedAll) {
        setVolume(x.userId, 0, true);
      } else {
        const savedVolume = userVolume.getUserVolume(x.userId);
        setVolume(x.userId, savedVolume, true);
      }
    });
  }

  async function onTrackSubscribed(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant
  ) {
    const uid = participant.identity;
    if (!participants[uid]) {
      const info = await userPool.getUser(uid);
      const savedVolume = userVolume.getUserVolume(uid);
      participants[uid] = {
        userId: uid,
        displayName: info?.displayName ?? "User",
        muted: pub.isMuted,
        volume: [savedVolume],
        gain: null,
        mutedAll: false,
        screencast: false,
      };
    }

    if (track.kind === Track.Kind.Video) {
      videoTracks.set(uid, track);
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      const existing = participants[uid];
      if (existing?.gain) {
        logger.warn(`[CALL] Audio graph already exists for ${uid}, skipping duplicate setup`);
        return;
      }

      logger.info(`[CALL] Setting up audio graph for ${uid}`);
      disposables.addSubscription(setupAudioGraph(uid, track));
    }
  }

  function onTrackUnsubscribed(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant
  ) {
    const uid = participant.identity;

    if (track.kind === "video") {
      videoTracks.delete(uid);
      return;
    }

    if (track.kind === "audio") {
      track.detach();
    }
  }

  function setupAudioGraph(userId: string, track: RemoteTrack): Subscription {
    const pdata = participants[userId];
    if (pdata?.gain) {
      logger.error(`[CALL] setupAudioGraph called for ${userId} but gain already exists!`);
      return new Subscription(() => {});
    }

    const audioCtx = audio.getCurrentAudioContext();

    const el = document.createElement("audio");
    el.autoplay = true;
    el.muted = true;
    el.style.display = "none";

    const mediaStream = new MediaStream([(track as any).mediaStreamTrack]);
    el.srcObject = mediaStream;
    document.body.appendChild(el);

    const gain = audioCtx.createGain();
    gain.gain.value = 1;

    const src = (() => {
      try {
        return audioCtx.createMediaStreamSource(mediaStream);
      } catch {
        return audioCtx.createMediaElementSource(el);
      }
    })();

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;

    const buffer = new Float32Array(analyser.fftSize);

    src.connect(analyser).connect(gain).connect(audioCtx.destination);

    if (pdata) {
      pdata.gain = gain;

      const savedVolume = userVolume.getUserVolume(userId);
      const isMutedAll = system.headphoneMuted;

      if (isMutedAll) {
        gain.gain.setValueAtTime(0, gain.context.currentTime);
      } else {
        const g = Math.max(0, Math.min(savedVolume / 100, 2.0));
        gain.gain.setValueAtTime(g, gain.context.currentTime);
        pdata.volume = [savedVolume];

        if (targetId.value && onRealtimeUpdate) {
          onRealtimeUpdate(targetId.value, userId, { volume: [savedVolume] });
        }
      }
    }

    let speakingState = false;
    let stopped = false;
    const threshold = 0.001;

    function detect() {
      if (stopped) return;

      analyser.getFloatTimeDomainData(buffer);

      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i];
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buffer.length);

      const newState = rms > threshold;

      if (newState !== speakingState) {
        speakingState = newState;
        if (speakingState) {
          speaking.add(userId);
        } else {
          speaking.delete(userId);
        }
      }

      requestAnimationFrame(detect);
    }

    detect();

    return new Subscription(() => {
      stopped = true;
      speaking.delete(userId);
      try {
        el.remove();
      } catch {}
    });
  }

  function setVolume(userId: string, vol: number, skipSave = false) {
    const u = participants[userId];
    if (!u || !u.gain) return;

    const g = Math.max(0, Math.min(vol / 100, 2.0));
    u.gain.gain.setValueAtTime(g, u.gain.context.currentTime);
    u.volume = [vol];

    if (!skipSave) {
      userVolume.setUserVolume(userId, vol);
    }

    if (targetId.value && onRealtimeUpdate) {
      onRealtimeUpdate(targetId.value, userId, { volume: [vol] });
    }
  }

  // Public actions
  async function startDirectCall(targetUserId: string) {
    const result = await api.startDirectCall(targetUserId);
    if (!result) return;

    mode.value = "dm";
    callId.value = result.callId;
    targetId.value = targetUserId;

    startTimersRTT();
    startRtcDiagnostics();

    await joinLiveKit({
      token: result.token,
      callId: result.callId,
      selfId: currentUser.id,
      rts: result.rtc,
    });
  }

  async function acceptIncomingCall() {
    if (!incoming.value) return;

    tones.stopPlayRingSound();

    const result = await api.acceptCall(incoming.value.callId);
    if (!result) return;

    mode.value = "dm";
    callId.value = incoming.value.callId;
    targetId.value = incoming.value.fromId;

    const incomingRef = incoming.value;
    incoming.value = null;

    startTimersRTT();
    startRtcDiagnostics();

    await joinLiveKit({
      token: result.token,
      callId: incomingRef.callId,
      selfId: currentUser.id,
      rts: result.rtc,
    });
  }

  async function rejectIncomingCall() {
    if (!incoming.value) return;

    tones.stopPlayRingSound();
    await api.rejectCall(incoming.value.callId);
    incoming.value = null;
  }

  async function joinVoiceChannel(channelId: string) {
    const result = await api.joinVoiceChannel(channelId);
    if (!result) return;

    mode.value = "channel";
    callId.value = result.callId;
    targetId.value = channelId;
    connectedVoiceChannelId.value = channelId;

    startTimersRTT();
    startRtcDiagnostics();

    await joinLiveKit({
      token: result.token,
      callId: result.callId,
      selfId: currentUser.id,
      rts: result.rtc,
    });
  }

  async function leave() {
    mode.value = "none";

    if (callId.value) {
      await api.leaveCall(callId.value);
    }

    stopTimerRTT();
    stopRtcDiagnostics();
    disposables.dispose();

    if (room.value) {
      room.value.disconnect();
      room.value = null;
    }

    // Clear state
    callId.value = null;
    targetId.value = null;
    connectedVoiceChannelId.value = null;
    isConnecting.value = false;
    isConnected.value = false;
    isReconnecting.value = false;

    Object.keys(participants).forEach((key) => delete participants[key]);
    videoTracks.clear();
    speaking.clear();
    diagnostics.clear();
    pingHistory.splice(0);
    ping.value = -1;
  }

  async function startScreenShare(opts: {
    deviceId: string | null;
    systemAudio: "include" | "exclude";
  }) {
    if (!room.value) return;

    let videoConstraints: any = {};

    if (opts.deviceId) {
      videoConstraints = {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: opts.deviceId,
        },
      };
    } else {
      videoConstraints = true;
    }

    const capture: ScreenShareCaptureOptions = {
      video: videoConstraints,
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

  // Subscribe to server events
  const callIncomingSub = eventBus.onServerEvent<CallIncoming>("CallIncoming", handleIncoming);
  disposables.addSubscription(callIncomingSub);

  const callFinishedSub = eventBus.onServerEvent<CallFinished>("CallFinished", async (ev) => {
    if (callId.value === ev.callId) {
      await leave();
    }
    if (incoming.value?.callId === ev.callId) {
      tones.stopPlayRingSound();
      incoming.value = null;
    }
  });
  disposables.addSubscription(callFinishedSub);

  const callAcceptedSub = eventBus.onServerEvent<CallAccepted>("CallAccepted", (ev) =>
    logger.info("[CALL] CallAccepted", ev)
  );
  disposables.addSubscription(callAcceptedSub);

  function dispose() {
    leave();
    disposables.dispose();
  }

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
    diagnostics,

    startDirectCall,
    acceptIncomingCall,
    rejectIncomingCall,
    joinVoiceChannel,
    leave,
    startScreenShare,
    stopScreenShare,
    setVolume,

    dispose,
  };
}
