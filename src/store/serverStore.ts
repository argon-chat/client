import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useApi } from "./apiStore";
import { logger } from "@/lib/logger";
import {
  ConnectionQuality,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomConnectOptions,
} from "livekit-client";
import { useConfig } from "./remoteConfig";
import delay from "@/lib/delay";
import { toast } from "@/components/ui/toast";
import { useBus } from "./busStore";
import { Channel } from "diagnostics_channel";

export const useServerStore = defineStore("server", () => {
  const api = useApi();
  const cfg = useConfig();
  const bus = useBus();
  const activeServer = ref(null as IServer | null);
  const registeredUsers = new Map<string, IUser>();
  const servers = ref([] as IServer[]);
  const channels = ref([] as IChannel[]);
  const currentChannelId = ref(null as string | null);
  const currentChannelUsers = ref([] as IUser[]);
  const isBeginConnect = ref(false);
  const isConnected = ref(false);
  const ping = computed(() =>
    connectedRoom.value
      ? connectedRoom.value.room?.engine?.client?.rtt
        ? `${connectedRoom.value.room.engine.client.rtt}ms`
        : "???ms"
      : "???ms"
  );
  const connectedChannel = computed(() =>
    channels.value.find((x) => x.Id == currentChannelId.value)
  );
  const connectedRoom = ref(
    null as { opt: RoomConnectOptions; room: Room } | null
  );
  const serverSelected = computed(() => !!activeServer.value);

  async function init() {
    const s = await loadServers();
    servers.value = s;

    if (s.length == 0) return;
    logger.success(`Loaded ${s.length} servers`, s);

    for (let ser of s) {
      channels.value = [];
      for (let ch of ser.Channels) {
        channels.value.push(ch);
      }
      registeredUsers.clear();
      for (let u of ser.Users) {
        registeredUsers.set(`${u.UserId.replaceAll("-", "")}`, u.User);
      }

      bus.listenEvents(ser.Id);
      bus.onServerEvent<ChannelCreated>("ChannelCreated", (x) => {
        if (activeServer.value?.Id == x.serverId) {
          activeServer.value.Channels.push(x.channel);
        }
      });
      bus.onServerEvent<ChannelRemoved>("ChannelRemoved", (x) => {
        if (activeServer.value?.Id == x.serverId) {
          removeItemOnce(activeServer.value.Channels, z => z.Id == x.channelId);
        }
      });
      /*bus.onServerEvent<ChannelModified>("ChannelModified", (x) => {
        logger.info(`ChannelModified!!!`, x);
        if (activeServer.value?.Id == x.serverId) {
          removeItemOnce(activeServer.value.Channels, z => z.Id == x.channelId);
        }
      });*/
    }

    selectServer(s[0].Id);
    logger.log("Users: ", registeredUsers);
  }

  function removeItemOnce<T>(arr: T[], redicate: (value: T, index: number, obj: T[]) => unknown) {
    const index = arr.findIndex(redicate);
    if (index > -1) {
      arr.splice(index, 1);
    }
    return arr;
  }

  async function joinToServer(inviteCode: string): Promise<boolean> {
    const r = await api.userInteraction.JoinToServerAsync({
      inviteCode,
    });

    if (r.IsSuccess) {
      servers.value.push(r.Value);
      return true;
    } else {
      switch (r.Error) {
        case "EXPIRED":
          toast({
            title: "Invite code expired",
            description: "Ask the person who gave you the code to give it again",
            variant: "destructive",
            duration: 2500,
          });
          return false;
        case "NOT_FOUND":
        case "YOU_ARE_BANNED":
          toast({
            title: "Invite code incorrect",
            description: "Invite code not found or you are not allowed to join this server",
            variant: "destructive",
            duration: 2500,
          });
          return false;
      }
      toast({
        title: "Unknown error",
        description: "An error occurred while connecting to the server",
        variant: "destructive",
        duration: 2500,
      });
      return false;
    }
  }

  function loadServers(): Promise<IServer[]> {
    return api.userInteraction.GetServers();
  }

  function onParticipantConnected(participant: RemoteParticipant) {
    logger.log("Participant connected: ", participant.identity);
    logger.log(
      "Participant connected, user: ",
      registeredUsers.get(participant.identity)!
    );
    currentChannelUsers.value.push(registeredUsers.get(participant.identity)!);
  }
  function onParticipantDisconnected(participant: RemoteParticipant) {
    logger.log("Participant disconnected:", participant.identity);
    //currentChannelUsers.value.(registeredUsers.get(participant.identity)!);
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
  async function addChannelToServer(channelName: string, channelKind: "Text" | "Voice" | "Announcement") {
    await api.serverInteraction.CreateChannel({
      name: channelName,
      desc: "",
      kind: channelKind,
      serverId: activeServer.value?.Id!
    });
  }

  async function deleteChannel(channelId: string) {
    await api.serverInteraction.DeleteChannel(activeServer.value!.Id, channelId);
  }

  function getDetailsOfChannel(channelId: string): IChannel | undefined {
    return activeServer.value?.Channels.filter(x => x.Id == channelId).at(0);
  }


  async function getServerInvites(): Promise<InviteCodeEntity[]> {
    return api.serverInteraction.GetInviteCodes(activeServer.value?.Id!);
  }

  async function addInvite(): Promise<InviteCode> {
    return api.serverInteraction.CreateInviteCode(activeServer.value?.Id!, 77760000000000n);
  }

  async function connectTo(channelId: string) {
    currentChannelId.value = channelId;
    isBeginConnect.value = true;

    await delay(2000);

    const me = await api.userInteraction.GetMe();

    const livekitToken = await api.serverInteraction.JoinToVoiceChannel(
      activeServer.value!.Id,
      channelId
    );

    logger.warn(livekitToken);

    const connectOptions: RoomConnectOptions = {};

    const room = new Room();

    connectedRoom.value = {
      opt: connectOptions,
      room: room,
    };

    room.on("participantConnected", onParticipantConnected);
    room.on("connectionQualityChanged", onParticipantQualityChanged);
    room.on("participantDisconnected", onParticipantDisconnected);
    room.on("trackSubscribed", onTrackSubscribed);
    room.on("trackUnsubscribed", onTrackUnsubscribed);

    await room.connect(cfg.webRtcEndpoint, livekitToken, {
      ...connectOptions,
    });

    isBeginConnect.value = false;
    isConnected.value = true;
    currentChannelUsers.value.push(me);
    logger.success("Connected to channel");
  }

  function disconnect() {
    if (!connectedRoom.value) return;
    const room = connectedRoom.value.room;
    try {
      if (room) {
        room.off("participantConnected", onParticipantConnected);
        room.off("participantDisconnected", onParticipantDisconnected);
        room.off("trackSubscribed", onTrackSubscribed);
        room.off("trackUnsubscribed", onTrackUnsubscribed);
        room.off("connectionQualityChanged", onParticipantQualityChanged);

        room.disconnect();
        logger.warn("Success disconnected from channel");

        isConnected.value = false;
        connectedRoom.value = null;
        currentChannelId.value = null;
      } else {
        logger.error("No active channel connection");
      }
    } catch (error) {
      logger.error("Failed to disconnect from channel", error);
    }
  }

  function selectServer(serverId: string) {
    activeServer.value = servers.value.find((x) => x.Id == serverId) ?? null;
  }

  return {
    activeServer,
    selectServer,
    isBeginConnect,
    isConnected,
    connectedChannel,
    connectTo,
    ping,
    servers,
    serverSelected,
    disconnect,
    init,
    currentChannelUsers,
    joinToServer,
    addChannelToServer,
    deleteChannel,
    getDetailsOfChannel,
    getServerInvites,
    addInvite
  };
});
