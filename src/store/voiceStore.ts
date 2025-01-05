import { logger } from "@/lib/logger";
import { ConnectionQuality, Participant, RemoteParticipant, RemoteTrack, RemoteTrackPublication, Room, RoomConnectOptions } from "livekit-client";
import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { usePoolStore } from "./poolStore";
import { useApi } from "./apiStore";
import { delay } from "rxjs";
import { useConfig } from "./remoteConfig";

export const useVoice = defineStore("voice", () => {
  const pool = usePoolStore();
  const api = useApi();
  const cfg = useConfig();

  const currentState = ref("NONE" as "NONE" | "BEGIN_CONNECT" | "CONNECTED");

  const isBeginConnect = computed(() => currentState.value === "BEGIN_CONNECT");

  const isConnected = computed(() => currentState.value === "CONNECTED");

  const activeChannel = ref(null as null | IChannel);

  const connectedRoom = reactive({ room: null, opt: null } as {
    room: Room | null;
    opt: null | RoomConnectOptions;
  });

  const ping = computed(() =>
    connectedRoom
      ? connectedRoom.room?.engine?.client?.rtt
        ? `${connectedRoom.room.engine.client.rtt}ms`
        : "???ms"
      : "???ms"
  );

  async function connectToChannel(channelId: string) {
    pool.selectedChannel = channelId;
    activeChannel.value = (await pool.getChannel(channelId))!;
    currentState.value = "BEGIN_CONNECT";

    await delay(2000);

    const livekitToken = await api.serverInteraction.JoinToVoiceChannel(
        pool.selectedServer!,
      channelId
    );

    const connectOptions: RoomConnectOptions = {};

    const room = new Room();

    connectedRoom.opt = connectOptions;
    connectedRoom.room = room;

    room.on("connectionQualityChanged", onParticipantQualityChanged);
    room.on("trackSubscribed", onTrackSubscribed);
    room.on("trackUnsubscribed", onTrackUnsubscribed);

    await room.connect(cfg.webRtcEndpoint, livekitToken, {
      ...connectOptions,
    });

    currentState.value = "CONNECTED";
    logger.success("Connected to channel");
  }

  function disconnectFromChannel() {
    if (!connectedRoom.room) return;
    const room = connectedRoom.room;
    try {
      if (room) {
        room.off("trackSubscribed", onTrackSubscribed);
        room.off("trackUnsubscribed", onTrackUnsubscribed);
        room.off("connectionQualityChanged", onParticipantQualityChanged);

        room.disconnect();
        logger.warn("Success disconnected from channel");

        currentState.value = "NONE";
        connectedRoom.room = null;
        pool.selectedChannel = null;
        activeChannel.value = null;
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
      track.attach();
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
    activeChannel
  };
});
