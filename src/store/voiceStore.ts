import { logger } from "@/lib/logger";
import {
  ConnectionQuality,
  createLocalAudioTrack,
  LocalAudioTrack,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomConnectOptions,
} from "livekit-client";
import { defineStore } from "pinia";
import { computed, Reactive, reactive, ref } from "vue";
import { usePoolStore } from "./poolStore";
import { useApi } from "./apiStore";
import { delay, Subscription, timer } from "rxjs";
import { useConfig } from "./remoteConfig";
import { useSystemStore } from "./systemStore";
import { useSessionTimer } from './sessionTimer'

export const useVoice = defineStore("voice", () => {
  const pool = usePoolStore();
  const api = useApi();
  const cfg = useConfig();
  const sys = useSystemStore();
  const sessionTimerStore = useSessionTimer();

  const currentState = ref("NONE" as "NONE" | "BEGIN_CONNECT" | "CONNECTED");

  const isBeginConnect = computed(() => currentState.value === "BEGIN_CONNECT");

  const isConnected = computed(() => currentState.value === "CONNECTED");

  const activeChannel = ref(null as null | IChannel);

  const connectedRoom = reactive({ room: null, opt: null, subs: [] } as {
    room: Reactive<Room> | null;
    opt: null | RoomConnectOptions;
    subs: Subscription[];
  });

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
    sessionTimerStore.stopTimer()
    pool.selectedChannel = channelId;
    activeChannel.value = (await pool.getChannel(channelId))!;
    currentState.value = "BEGIN_CONNECT";

    await delay(2000);

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

    const connectOptions: RoomConnectOptions = {};

    const room = new Room();

    connectedRoom.opt = connectOptions;
    connectedRoom.room = reactive(room);

    room.on("connectionQualityChanged", onParticipantQualityChanged);
    room.on("trackSubscribed", onTrackSubscribed);
    room.on("trackUnsubscribed", onTrackUnsubscribed);

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

    const localAudioTrack = await createLocalAudioTrack();
    await room.localParticipant.publishTrack(localAudioTrack);

    connectedRoom.subs.push(
      sys.muteEvent.subscribe((x) => {
        if (x) localAudioTrack.mute();
        else localAudioTrack.unmute();
      })
    );

    const source = timer(500, 500);

    connectedRoom.subs.push(
      source.subscribe(() => {
        rtt.value = connectedRoom.room?.engine?.client?.rtt ?? -1;
      })
    );

    if (sys.microphoneMuted) {
      localAudioTrack.mute();
    }

    currentState.value = "CONNECTED";
    sessionTimerStore.startTimer()
    logger.success("Connected to channel");
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

        room.disconnect();
        logger.warn("Success disconnected from channel");

        for (const s of connectedRoom.subs) {
          s.unsubscribe();
        }
        currentState.value = "NONE";
        connectedRoom.room = null;
        pool.selectedChannel = null;
        activeChannel.value = null;
        sessionTimerStore.stopTimer()
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

    if (track.kind === "audio") {
      const audioElement = track.attach();
      document.body.appendChild(audioElement);
      logger.info("Audio is attached");
    }
  }

  function onParticipantQualityChanged(
    quality: ConnectionQuality,
    participant: Participant
  ) {}

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

    if (track.kind === "audio") {
      track.detach();
      logger.info("Audio is detached");
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
  };
});
