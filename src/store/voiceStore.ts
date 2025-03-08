import { logger } from "@/lib/logger";
import {
  ConnectionQuality,
  ConnectionState,
  createLocalAudioTrack,
  createLocalScreenTracks,
  createLocalTracks,
  LocalAudioTrack,
  LocalTrackPublication,
  LocalVideoTrack,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomConnectOptions,
  Track,
  TrackPublication,
  VideoTrack,
} from "livekit-client";
import { defineStore } from "pinia";
import { computed, Reactive, reactive, ref } from "vue";
import { usePoolStore } from "./poolStore";
import { useApi } from "./apiStore";
import { delay, Subject, Subscription, timer } from "rxjs";
import { useConfig } from "./remoteConfig";
import { useSystemStore } from "./systemStore";
import { useTone } from "./toneStore";
import { useSessionTimer } from "./sessionTimer";
import { usePreference } from "./preferenceStore";

export const useVoice = defineStore("voice", () => {
  const pool = usePoolStore();
  const api = useApi();
  const cfg = useConfig();
  const sys = useSystemStore();
  const tone = useTone();
  const sessionTimerStore = useSessionTimer();
  const preferenceStore = usePreference();

  const currentState = ref("NONE" as "NONE" | "BEGIN_CONNECT" | "CONNECTED");

  const isBeginConnect = computed(() => currentState.value === "BEGIN_CONNECT");

  const isConnected = computed(() => currentState.value === "CONNECTED");

  const activeChannel = ref(null as null | IChannel);

  const connectedRoom = reactive({ room: null, opt: null, subs: [] } as {
    room: Reactive<Room> | null;
    opt: null | RoomConnectOptions;
    subs: Subscription[];
  });

  const onVideoCreated: Subject<Track> = new Subject<Track>();
  const onVideoDestroyed: Subject<Track> = new Subject<Track>();

  const rtt = ref(0);

  const ping = computed(() => `${rtt.value}ms`);

  const qualityConnection = computed(() => {
    if (!isConnected) return "NONE";
    const e = rtt.value;
    if (!e) {
      return "NONE";
    }
    if (e < 50) {
      return "GREEN";
    }
    if (e < 100) {
      return "ORANGE";
    }
    return "RED";
  });

  async function connectToChannel(channelId: string) {
    sessionTimerStore.stopTimer();
    pool.selectedChannel = channelId;
    activeChannel.value = (await pool.getChannel(channelId))!;
    currentState.value = "BEGIN_CONNECT";

    const livekitToken = await api.serverInteraction.JoinToVoiceChannel(
      pool.selectedServer!,
      channelId
    );

    logger.log(`Livekit authorization`, livekitToken);

    if (!livekitToken.IsSuccess) {
      logger.error(
        `Failed retrive authorization token for login to room`,
        livekitToken.Error
      );
      currentState.value = "NONE";
      activeChannel.value = null;
      pool.selectedChannel = null;
      return;
    }

    const connectOptions: RoomConnectOptions = {
      maxRetries: 500,
    };

    const room = new Room();

    connectedRoom.opt = connectOptions;
    connectedRoom.room = reactive(room);

    room.on("connectionQualityChanged", onParticipantQualityChanged);
    room.on("trackSubscribed", onTrackSubscribed);
    room.on("trackUnsubscribed", onTrackUnsubscribed);
    room.on("reconnecting", onReconnectiong);

    try {
      await room.connect(cfg.webRtcEndpoint, livekitToken.Value, {
        ...connectOptions,
      });

      (window as any)["room"] = room;
    } catch (e) {
      logger.error(e);
      logger.error("Failed connect to web rtc server");
      currentState.value = "NONE";
      activeChannel.value = null;
      pool.selectedChannel = null;
      return;
    }

    logger.log("Start voice with settings", {
      noiseSuppression: preferenceStore.noiseSuppression,
      echoCancellation: preferenceStore.echoCancellation,
      voiceIsolation: preferenceStore.voiceIsolation,
      autoGainControl: preferenceStore.autoGainControl,
      deviceId: preferenceStore.defaultAudioDevice ?? undefined,
    });

    const localAudioTrack = await createLocalAudioTrack({
      noiseSuppression: preferenceStore.noiseSuppression,
      echoCancellation: preferenceStore.echoCancellation,
      voiceIsolation: preferenceStore.voiceIsolation,
      autoGainControl: preferenceStore.autoGainControl,

      deviceId: preferenceStore.defaultAudioDevice ?? undefined,
    });
    await room.localParticipant.publishTrack(localAudioTrack);

    connectedRoom.subs.push(
      sys.muteEvent.subscribe((x) => {
        if (x) localAudioTrack.mute();
        else localAudioTrack.unmute();
      })
    );

    const source = timer(50, 500);

    connectedRoom.subs.push(
      source.subscribe(() => {
        rtt.value = connectedRoom.room?.engine?.client?.rtt ?? -1;
      })
    );

    if (sys.microphoneMuted) {
      localAudioTrack.mute();
    }
    tone.playSoftEnterSound();

    currentState.value = "CONNECTED";
    sessionTimerStore.startTimer();
    logger.success("Connected to channel");

    room.localParticipant.on("isSpeakingChanged", (val) => {
      pool.indicateSpeaking(
        pool.selectedChannel!,
        room.localParticipant.identity,
        val
      );
    });

    room.localParticipant.on("trackMuted", (_) => {
      pool.setProperty(
        pool.selectedChannel!,
        room.localParticipant.identity,
        (x) => {
          (x.isMuted as any) = true;
        }
      );
    });

    room.localParticipant.on("trackUnmuted", (_) => {
      pool.setProperty(
        pool.selectedChannel!,
        room.localParticipant.identity,
        (x) => {
          (x.isMuted as any) = false;
        }
      );
    });
  }

  async function disconnectFromChannel() {
    if (!connectedRoom.room) return;
    const room = connectedRoom.room;
    try {
      if (room) {
        await api.serverInteraction.DisconnectFromVoiceChannel(
          activeChannel.value!.ServerId,
          activeChannel.value!.Id
        );
        room.off("trackSubscribed", onTrackSubscribed);
        room.off("trackUnsubscribed", onTrackUnsubscribed);
        room.off("connectionQualityChanged", onParticipantQualityChanged);
        room.off("signalReconnecting", onReconnectiong);

        //room.disconnect();
        logger.warn("Success disconnected from channel");

        for (const s of connectedRoom.subs) {
          s.unsubscribe();
        }
        currentState.value = "NONE";
        connectedRoom.room = null;
        pool.selectedChannel = null;
        activeChannel.value = null;
        tone.playSoftLeaveSound();
      } else {
        logger.error("No active channel connection");
      }
    } catch (error) {
      logger.error("Failed to disconnect from channel", error);
    }
  }

  function onTrackSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) {
    logger.log(
      "Track subscribed:",
      track.kind,
      "at particant:",
      participant.identity
    );

    if (track.kind === "video") {
      logger.log(track, publication);
      isOtherUserSharing.value = true;
      onVideoCreated.next(track);
    } else if (track.kind === "audio") {
      const audioElement = track.attach();
      document.body.appendChild(audioElement);
      logger.info("Audio is attached");

      participant.on("isSpeakingChanged", (val) => {
        pool.indicateSpeaking(pool.selectedChannel!, participant.identity, val);
      });

      participant.on("trackMuted", (track) => {
        pool.setProperty(pool.selectedChannel!, participant.identity, (x) => {
          (x.isMuted as any) = true;
        });
      });
      participant.on("trackUnmuted", (track) => {
        pool.setProperty(pool.selectedChannel!, participant.identity, (x) => {
          (x.isMuted as any) = false;
        });
      });

      tone.playSoftEnterSound();
    }
  }

  function onParticipantQualityChanged(
    quality: ConnectionQuality,
    participant: Participant
  ) {}

  const allSizes = [
    //{ title: "SVGA (600p)", h: 600, w: 800 },
    //{ title: "XGA (768p)", h: 768, w: 1024 },
    { title: "WXGA (720p)", h: 720, w: 1280, preset: "720p" },
    // { title: "WXGA+ (900p)", h: 900, w: 1440 },
    //{ title: "HD+ (900p)", h: 900, w: 1600 },
    { title: "Full HD (1080p)", h: 1080, w: 1920, preset: "1080p" },
    // { title: "WUXGA (1200p)", h: 1200, w: 1920 },
    { title: "QHD (1440p)", h: 1440, w: 2560, preset: "1440p" },
    // { title: "WQXGA (1600p)", h: 1600, w: 2560 },
    { title: "4K UHD (2160p)", h: 2160, w: 3840, preset: "2160p" },
    // { title: "5K (2880p)", h: 2880, w: 5120 },
    // { title: "8K UHD (4320p)", h: 4320, w: 7680 },
    // { title: "UWHD (1080p)", h: 1080, w: 2560 },
    //{ title: "UWQHD (1440p)", h: 1440, w: 3440 },
    // { title: "UWQHD+ (1600p)", h: 1600, w: 3840 },
    //{ title: "5K2K (2160p)", h: 2160, w: 5120 },
    // { title: "DFHD (1080p x2)", h: 1080, w: 3840 },
    // { title: "DQHD (1440p x2)", h: 1440, w: 5120 }
  ];

  let screenTrack: LocalTrackPublication | undefined;
  const isSharing = ref(false);
  const isOtherUserSharing = ref(false);
  const startScreenShare = async (options: {
    systemAudio: "include" | "exclude";
    preset: "720p" | "1080p" | "1440p" | "2160p" | "4320p" | "10240p";
    fps: number;
    deviceId: string;
    deviceKind: "screen" | "desktop";
  }) => {
    try {
      const room = connectedRoom.room!;

      const enabled = room.localParticipant.isScreenShareEnabled;

      const selectedPreset = allSizes.filter(x => x.preset === options.preset).at(0);

      isSharing.value = true;
      screenTrack = await room.localParticipant.setScreenShareEnabled(
        !enabled,
        {
          audio: true,
          resolution: {
            height: selectedPreset?.h,
            width: selectedPreset?.w,
            frameRate: options.fps,
          },
          systemAudio: options.systemAudio,
          video: true,
          contentHint: "motion",
          mandatory: {
            chromeMediaSourceId: options.deviceId,
            chromeMediaSource: options.deviceKind,
          } as any,
        } as any
      );

      logger.warn("Started video scren share", screenTrack);
      onVideoCreated.next(screenTrack?.track as any);

      screenTrack!.once("ended", () => {
        stopScreenShare();
        onVideoDestroyed.next(screenTrack?.track as any);
      });
    } catch (error) {
      console.error("Ошибка при захвате экрана:", error);
    }
  };

  const stopScreenShare = async () => {
    if (screenTrack) {
      onVideoDestroyed.next(screenTrack.track!);
      screenTrack =
        await connectedRoom.room!.localParticipant.setScreenShareEnabled(false);
      screenTrack = undefined;
      isSharing.value = false;
    }
  };

  const currentlyReconnect = ref(false);
  function onReconnectiong() {
    if (currentlyReconnect.value) return;
    currentlyReconnect.value = true;

    var internvalId: NodeJS.Timeout;
    internvalId = setInterval(async () => {
      await tone.playReconnectSound();
      if (
        connectedRoom.room?.state == ConnectionState.Connected ||
        connectedRoom.room?.state == ConnectionState.Disconnected
      )
        clearInterval(internvalId);
      currentlyReconnect.value = false;
    }, 1250);
  }

  function onTrackUnsubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant
  ) {
    logger.log(
      "Track unsubscribed:",
      track.kind,
      "at particant:",
      participant.identity
    );

    if (track.kind === "video") {
      isOtherUserSharing.value = false;
      onVideoDestroyed.next(track);
    } else if (track.kind === "audio") {
      track.detach();
      logger.info("Audio is detached");
      tone.playSoftLeaveSound();
    }
  }

  return {
    ping,
    connectToChannel,
    disconnectFromChannel,
    isBeginConnect,
    isConnected,
    activeChannel,
    qualityConnection,
    currentlyReconnect,
    onVideoCreated,
    onVideoDestroyed,
    startScreenShare,
    stopScreenShare,
    isSharing,
    isOtherUserSharing,
  };
});
