import { audio } from "@/lib/audio/AudioManager";
import { DisposableBag } from "@/lib/disposables";
import { logger } from "@/lib/logger";
import {
  type ConnectionQuality,
  ConnectionState,
  LocalAudioTrack,
  type LocalTrackPublication,
  LocalVideoTrack,
  type Participant,
  RemoteAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  type RoomConnectOptions,
  ScreenShareCaptureOptions,
  Track,
  createLocalAudioTrack,
} from "livekit-client";
import { defineStore } from "pinia";
import { Subject, type Subscription, timer } from "rxjs";
import {
  type Reactive,
  type Ref,
  type WatchHandle,
  computed,
  reactive,
  ref,
  watch,
} from "vue";
import { useApi } from "./apiStore";
import { usePoolStore } from "./poolStore";
import { usePreference } from "./preferenceStore";
import { useConfig } from "./remoteConfig";
import { useSessionTimer } from "./sessionTimer";
import { useSystemStore } from "./systemStore";
import { useTone } from "./toneStore";
import { ArgonChannel } from "@/lib/glue/argonChat";
import { Guid } from "@argon-chat/ion.webcore";

export type DirectRef<T> = Ref<T, T>;

export type IChannelMemberData = {
  video?: HTMLVideoElement;
  stream?: HTMLVideoElement;
  context: AudioContext;
  gain: GainNode;
  watcher: WatchHandle;
  volume: Reactive<number[]>;
  userId: Guid;
};
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

  const activeChannel = ref(null as null | ArgonChannel);

  async function switchMicrophone(room: Room, newDeviceId: string) {
    const localParticipant = room.localParticipant;
    const publication = Array.from(
      localParticipant.trackPublications.values()
    )[0];

    const newTrack = await createLocalAudioTrack({ deviceId: newDeviceId });
    newTrack.setAudioContext(audio.getCurrentAudioContext());

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
  }

  const connectedRoom = reactive({
    room: null,
    opt: null,
    subs: [],
    roomData: new Map(),
    disposableBag: new DisposableBag(),
  } as {
    room: Reactive<Room> | null;
    opt: null | RoomConnectOptions;
    subs: Subscription[];
    roomData: Map<Guid, IChannelMemberData>;
    disposableBag: DisposableBag;
  }) as Reactive<{
    room: Reactive<Room> | null;
    opt: null | RoomConnectOptions;
    subs: Subscription[];
    roomData: Map<Guid, IChannelMemberData>;
    disposableBag: DisposableBag;
  }>;

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
    if (activeChannel.value?.channelId === channelId) return;

    sessionTimerStore.stopTimer();
    pool.selectedChannel = channelId;
    const channel = await pool.getChannel(channelId);
    if (!channel) return;
    activeChannel.value = channel;
    currentState.value = "BEGIN_CONNECT";

    const selectedServer = pool.selectedServer;
    if (!selectedServer) return;

    const joinResult = await api.channelInteraction.JoinToVoiceChannel(
      selectedServer,
      channelId
    );

    if (joinResult.isFailedJoinVoice()) {
      logger.error(
        "Failed retrive authorization token for login to room",
        joinResult.error
      );
      currentState.value = "NONE";
      activeChannel.value = null;
      pool.selectedChannel = null;
      return;
    } else if (!joinResult.isSuccessJoinVoice()) {
      throw new Error("");
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
    room.once("disconnected", async (reason) => {
      logger.warn("DISCONECT CALLED", reason);
      await disconnectFromChannel();
    });
    try {
      await room.connect(cfg.webRtcEndpoint, joinResult.token, {
        ...connectOptions,
      });

      (window as any).room = room;
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
      deviceId: audio.getInputDevice().value ?? undefined,
    });

    const localAudioTrack = await createLocalAudioTrack({
      noiseSuppression: false,
      deviceId: audio.getInputDevice().value ?? undefined,
      autoGainControl: false,
      channelCount: 2,
      echoCancellation: false,
      voiceIsolation: false,
    });

    localAudioTrack.setAudioContext(audio.getCurrentAudioContext());

    await room.localParticipant.publishTrack(localAudioTrack, {
      dtx: true,
      red: true,
    });

    localAudioTrack.setProcessor(audio.createRtcProcessor());

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

    connectedRoom.subs.push(
      audio.onInputDeviceChanged(async (devId) => {
        logger.error("onInputDeviceChanged", devId, audio.getInputDevice());
        await switchMicrophone(room, devId);
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
      const selectedChannel = pool.selectedChannel;
      if (!selectedChannel) return;

      pool.indicateSpeaking(
        selectedChannel,
        room.localParticipant.identity,
        val
      );
    });

    room.localParticipant.on("trackMuted", (_) => {
      const selectedChannel = pool.selectedChannel;
      if (!selectedChannel) return;

      pool.setProperty(selectedChannel, room.localParticipant.identity, (x) => {
        (x.isMuted as any) = true;
      });
    });

    room.localParticipant.on("trackUnmuted", (_) => {
      const selectedChannel = pool.selectedChannel;
      if (!selectedChannel) return;

      pool.setProperty(selectedChannel, room.localParticipant.identity, (x) => {
        (x.isMuted as any) = false;
      });
    });
  }

  function setUserVolume(participantId: string, volumePercent: number) {
    const data = connectedRoom.roomData.get(participantId);
    if (!data) {
      logger.error("No participant found in room data");
      return;
    }
    const gain = Math.max(0, volumePercent) / 100;
    const clamped = Math.min(gain, 2.0);
    data.gain.gain.setValueAtTime(clamped, data.context.currentTime);
    data.volume[0] = Math.max(0, volumePercent);
  }

  async function disconnectFromChannel() {
    if (!connectedRoom.room) return;
    const room = connectedRoom.room;
    try {
      if (room) {
        await api.channelInteraction.DisconnectFromVoiceChannel(
          activeChannel.value?.spaceId as string,
          activeChannel.value?.channelId as string
        );
        room.removeAllListeners();
        room.disconnect();
        logger.warn("Success disconnected from channel");

        for (const s of connectedRoom.subs) {
          s.unsubscribe();
        }
        currentState.value = "NONE";
        connectedRoom.room = null;
        connectedRoom.roomData.clear();
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
      "at participant:",
      participant.identity
    );

    if (track.kind === "video") {
      isOtherUserSharing.value = true;
      onVideoCreated.next(track);
      return;
    }

    if (track.kind !== "audio") return;

    const audioCtx = audio.getCurrentAudioContext();

    if (audioCtx.state === "suspended") {
      const resume = () => {
        audioCtx.resume();
        document.removeEventListener("click", resume);
        document.removeEventListener("keydown", resume);
      };
      document.addEventListener("click", resume, { once: true });
      document.addEventListener("keydown", resume, { once: true });
    }

    const el = document.createElement("audio");
    el.autoplay = true;
    el.muted = true;
    el.style.display = "none";

    const mediaStream = new MediaStream([
      (track as RemoteAudioTrack).mediaStreamTrack,
    ]);
    el.srcObject = mediaStream;
    document.body.appendChild(el);

    let sourceNode:
      | MediaStreamAudioSourceNode
      | MediaElementAudioSourceNode
      | null = null;

    const setupGraph = () => {
      // @ts-ignore
      const captured: MediaStream | null = typeof el.captureStream === "function" ? el.captureStream() : null;

      const hasCapturedAudio =
        !!captured &&
        captured.getAudioTracks &&
        captured.getAudioTracks().length > 0;

      const gain = audioCtx.createGain();
      gain.gain.value = 1.0;

      if (hasCapturedAudio) {
        sourceNode = audioCtx.createMediaStreamSource(captured!);
        sourceNode.connect(gain).connect(audioCtx.destination);
      } else {
        try {
          const directSource = audioCtx.createMediaStreamSource(mediaStream);
          directSource.connect(gain).connect(audioCtx.destination);
          sourceNode = directSource;
        } catch (e) {
          const elemSource = audioCtx.createMediaElementSource(el);
          elemSource.connect(gain).connect(audioCtx.destination);
          sourceNode = elemSource;
        }
      }

      const volume = reactive([100]);

      if (pool.selectedChannel) {
        pool.setProperty(pool.selectedChannel, participant.identity, (x) => {
          (x.volume as any) = volume;
        });
      }

      const item: IChannelMemberData = {
        context: audioCtx,
        gain,
        userId: participant.identity,
        volume,
        watcher: watch(
          () => [...volume],
          (e) => setUserVolume(participant.identity, e[0]),
          { deep: true }
        ),
      };

      connectedRoom.roomData.set(participant.identity, item);

      participant.on("isSpeakingChanged", (val) => {
        if (pool.selectedChannel) {
          pool.indicateSpeaking(
            pool.selectedChannel,
            participant.identity,
            val
          );
        }
      });
      participant.on("trackMuted", () => {
        if (pool.selectedChannel) {
          pool.setProperty(pool.selectedChannel, participant.identity, (x) => {
            (x.isMuted as any) = true;
          });
        }
      });
      participant.on("trackUnmuted", () => {
        if (pool.selectedChannel) {
          pool.setProperty(pool.selectedChannel, participant.identity, (x) => {
            (x.isMuted as any) = false;
          });
        }
      });

      tone.playSoftEnterSound();
    };

    el.play()
      .then(setupGraph)
      .catch((err) => {
        logger.warn(
          "Autoplay blocked, will init graph after first user gesture",
          err
        );
        const handler = () => {
          el.play().then(setupGraph).catch(logger.error);
          document.removeEventListener("click", handler);
          document.removeEventListener("keydown", handler);
        };
        document.addEventListener("click", handler);
        document.addEventListener("keydown", handler);
      });
  }
  function getVolumeRef(userId: Guid) {
    return connectedRoom.roomData.get(userId)?.volume;
  }

  function onParticipantQualityChanged(
    quality: ConnectionQuality,
    participant: Participant
  ) {
    logger.warn("onParticipantQualityChanged", quality, participant);
  }

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
    logger.error("Start streaming screen", options);

    try {
      if (!connectedRoom.room) {
        logger.error("Cannot start screen share: no active room");
        return;
      }

      const room = connectedRoom.room;

      const sharingOptions: ScreenShareCaptureOptions = {
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: options.deviceId,
            resizeMode: "none",
          } as any,
        } as any,
        audio: false,
        systemAudio: options.systemAudio,
        suppressLocalAudioPlayback: true,
        resolution: {
          width: 1920,
          height: 1080,
        },
        resizeMode: "none" as any,
      } as any;

      const mediaStream =
        await navigator.mediaDevices.getUserMedia(sharingOptions);

      const localVideoTrack = new LocalVideoTrack(mediaStream.getTracks()[0]);
      localVideoTrack.source = Track.Source.ScreenShare;

      screenTrack = await room.localParticipant.publishTrack(localVideoTrack);

      isSharing.value = true;
      /*screenTrack = await room.localParticipant.setScreenShareEnabled(
        !enabled,
        sharingOptions
      );*/

      logger.warn("Started video scren share", screenTrack);

      onVideoCreated.next(screenTrack?.track as any);

      screenTrack?.once("ended", () => {
        stopScreenShare();
        onVideoDestroyed.next(screenTrack?.track as any);
      });
    } catch (error) {
      console.error("Ошибка при захвате экрана:", error);
    }
  };

  const stopScreenShare = async () => {
    if (screenTrack?.track) {
      onVideoDestroyed.next(screenTrack.track);
      screenTrack =
        await connectedRoom.room?.localParticipant.setScreenShareEnabled(false);
      screenTrack = undefined;
      isSharing.value = false;
    }
  };

  const currentlyReconnect = ref(false);
  function onReconnectiong() {
    if (currentlyReconnect.value) return;
    currentlyReconnect.value = true;

    const intervalId = setInterval(async () => {
      await tone.playReconnectSound();
      if (
        connectedRoom.room?.state === ConnectionState.Connected ||
        connectedRoom.room?.state === ConnectionState.Disconnected
      ) {
        clearInterval(intervalId);
        currentlyReconnect.value = false;
      }
    }, 2000);
  }

  function onTrackUnsubscribed(
    track: RemoteTrack,
    _: RemoteTrackPublication,
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
    setUserVolume,
    getVolumeRef,
  };
});
