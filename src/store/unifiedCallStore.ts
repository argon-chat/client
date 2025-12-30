import { defineStore } from "pinia";
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
} from "livekit-client";
import { ref, reactive, computed } from "vue";

import { audio } from "@/lib/audio/AudioManager";
import { useApi } from "./apiStore";
import { usePoolStore } from "./poolStore";
import { useTone } from "./toneStore";
import { logger } from "@/lib/logger";
import { useMe } from "./meStore";
import { useBus } from "./busStore";
import { useUserVolumeStore } from "./userVolumeStore";
import { useRealtimeStore } from "./realtimeStore";

import { CallIncoming, CallFinished, CallAccepted } from "@/lib/glue/argonChat";
import { startTimer } from "@/lib/intervalTimer";
import { useSystemStore } from "./systemStore";
import { DisposableBag } from "@/lib/disposables";
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

  const participants = reactive(
    new Map<
      string,
      {
        userId: string;
        displayName: string;
        muted: boolean;
        mutedAll: boolean;
        screencast: boolean;
        volume: number[];
        gain: GainNode | null;
      }
    >()
  );

  const videoTracks = reactive(new Map<string, RemoteTrack>());

  const speaking = reactive(new Set<string>());

  const incoming = ref<CallIncoming | null>(null);

  const isSharing = ref(false);
  let screenTrackPub: any = null;

  const ping = ref(-1);
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

    isConnecting.value = false;
    isConnected.value = false;
    isReconnecting.value = false;

    participants.clear();
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

    await joinLiveKit({
      token: join.token,
      callId: callId.value!,
      selfId: me.me!.userId,
    });

    startTimersRTT();
  }

  function startTimersRTT() {
    startRtcDiagnostics();
    if (pingTimer) clearInterval(pingTimer);
    if (intervalTimer) intervalTimer();

    pingTimer = setInterval(() => {
      try {
        ping.value = room.value?.engine?.client?.rtt ?? -1;
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
  }) {
    if (isConnecting.value) return;

    isConnecting.value = true;
    isConnected.value = false;

    if (room.value) {
      await leave();
      return;
    }

    const r = new Room();
    room.value = r;

    r.on("participantConnected", async (p: RemoteParticipant) => {
      const uid = p.identity;
      const info = await pool.getUser(uid);

      const savedVolume = userVolume.getUserVolume(uid);

      participants.set(uid, {
        userId: uid,
        displayName: info?.displayName ?? "Unknown User",
        muted: false,
        volume: [savedVolume],
        gain: null,
        mutedAll: false,
        screencast: false,
      });

      const isMutedAll = sys.headphoneMuted;

      if (isMutedAll) {
        setVolume(uid, 0);
      } else {
        setVolume(uid, savedVolume);
      }

      p.on("trackMuted", (pub) => {
        const pm = participants.get(uid);
        if (pm) pm.muted = true;
      });
      p.on("trackUnmuted", (pub) => {
        const pm = participants.get(uid);
        if (pm) pm.muted = false;
      });
      p.setAudioContext(audio.getCurrentAudioContext());
      p.on("attributesChanged", (x) => {
        logger.info("attributesChanged", x);
        const pm = participants.get(uid);
        if (pm) {
          pm.mutedAll = x.isMutedAll === "true";
          pm.screencast = x.isScreencast === "true";
        }
      });
    });

    r.on("participantDisconnected", (p) => {
      const uid = p.identity;
      participants.delete(uid);
      speaking.delete(uid);
      if (videoTracks.has(uid)) videoTracks.delete(uid);
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

    try {
      await r.connect("wss://rts.argon.gl", opts.token);
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

      if (sys.microphoneMuted) mic.mute();

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

      mic.setAudioContext(audioCtx);
      await r.localParticipant.publishTrack(mic, {
        red: true,
        simulcast: true,
        stopMicTrackOnMute: true,
      });

      mic.setProcessor(audio.createRtcProcessor());

      disposables.addSubscription(setupLocalSpeakingDetector(mic, opts.selfId));

      const onIdc = audio.onInputDeviceChanged(async (devId) => {
        logger.warn("audio input device has changed");

        const localParticipant = r.localParticipant;
        const publication = Array.from(
          localParticipant.trackPublications.values()
        )
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
        newTrack.setProcessor(audio.createRtcProcessor());

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
    tone.playSoftEnterSound();
  }

  function setupLocalSpeakingDetector(track: LocalAudioTrack, userId: string) {
    const audioCtx = audio.getCurrentAudioContext();
    const mediaStream = new MediaStream([track.mediaStreamTrack]);

    const src = audioCtx.createMediaStreamSource(mediaStream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;

    const buffer = new Float32Array(analyser.fftSize);

    const threshold = 0.001;

    src.connect(analyser);

    let speakingState = false;
    let stopped = false;

    function detect() {
      if (stopped) return;

      analyser.getFloatTimeDomainData(buffer);

      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }
      const rms = Math.sqrt(sum / buffer.length);

      const newState = rms > threshold;

      if (newState !== speakingState) {
        speakingState = newState;

        if (speakingState) speaking.add(userId);
        else speaking.delete(userId);
      }

      requestAnimationFrame(detect);
    }

    detect();

    return new Subscription(() => {
      stopped = true;
      speaking.delete(userId);
    });
  }

  function applyMuteAllToExistingParticipants(isMutedAll: boolean) {
    if (!room.value) return;

    const volume = isMutedAll ? 0 : 100;

    participants.forEach((x) => {
      setVolume(x.userId, volume);
    });
  }

  async function onTrackSubscribed(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant
  ) {
    const uid = participant.identity;
    if (!participants.has(uid)) {
      const info = await pool.getUser(uid);
      const savedVolume = userVolume.getUserVolume(uid);
      participants.set(uid, {
        userId: uid,
        displayName: info?.displayName ?? "User",
        muted: pub.isMuted,
        volume: [savedVolume],
        gain: null,
        mutedAll: false,
        screencast: false,
      });
    }

    if (track.kind === Track.Kind.Video) {
      videoTracks.set(uid, track);
      return;
    }

    if (track.kind === Track.Kind.Audio) {
      logger.warn(track);
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

  function setupAudioGraph(userId: string, track: RemoteTrack) {
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

    const pdata = participants.get(userId);
    if (pdata) {
      pdata.gain = gain;
      
      // Apply saved volume from localStorage
      const savedVolume = userVolume.getUserVolume(userId);
      const isMutedAll = sys.headphoneMuted;
      
      if (isMutedAll) {
        gain.gain.setValueAtTime(0, gain.context.currentTime);
      } else {
        const g = Math.max(0, Math.min(savedVolume / 100, 2.0));
        gain.gain.setValueAtTime(g, gain.context.currentTime);
        pdata.volume = [savedVolume];
        
        // Update volume in realtimeStore for UI sync
        if (targetId.value) {
          realtimeStore.setUserProperty(targetId.value, userId, (user) => {
            user.volume = [savedVolume];
          });
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
        if (speakingState) speaking.add(userId);
        else speaking.delete(userId);
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

  function setVolume(userId: string, vol: number) {
    const u = participants.get(userId);
    if (!u || !u.gain) return;

    const g = Math.max(0, Math.min(vol / 100, 2.0));
    u.gain.gain.setValueAtTime(g, u.gain.context.currentTime);
    u.volume = [vol];
    
    userVolume.setUserVolume(userId, vol);
    
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
      } as any
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
    if (callId.value === ev.callId) {
      await leave();
    }
  });

  bus.onServerEvent<CallAccepted>("CallAccepted", (ev) =>
    logger.info("[CALL] CallAccepted", ev)
  );

  return {
    mode,
    room,
    callId,
    targetId,
    isConnected,
    isConnecting,
    isReconnecting,

    participants,
    videoTracks,
    speaking,
    incoming,

    isSharing,

    ping,
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
