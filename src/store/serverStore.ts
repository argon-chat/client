import { toast } from "@/components/ui/toast";
import { logger } from "@/lib/logger";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { usePoolStore } from "./poolStore";
import {
  AcceptInviteError,
  ChannelType,
  InviteCode,
  InviteCodeEntity,
} from "@/lib/glue/argonChat";
import { v7 } from "uuid";
import { Guid } from "@argon-chat/ion.webcore";

export const useServerStore = defineStore("server", () => {
  const api = useApi();
  const isBeginConnect = ref(false);
  const isConnected = ref(false);
  const pool = usePoolStore();

  async function createServer(name: string): Promise<boolean> {
    try {
      await api.userInteraction.CreateSpace({
        avatarFieldId: "",
        description: "",
        name: name,
      });
      await pool.loadServerDetails();
      return true;
    } catch (e) {
      logger.error("failed to create server", e);
      return false;
    }
  }

  async function joinToServer(inviteCode: string): Promise<string> {
    const r = await api.userInteraction.JoinToSpace({
      inviteCode,
    });

    if (r.isSuccessJoin()) {
      await pool.loadServerDetails();
      return '';
    } else if (r.isFailedJoin()) {
      switch (r.error) {
        case AcceptInviteError.EXPIRED:
          return "Invite code expired";
        case AcceptInviteError.NOT_FOUND:
        case AcceptInviteError.YOU_ARE_BANNED:
          return "Invite code incorrect";
      }
    }
    return "Unknown error";
  }

  async function addChannelToServer(
    spaceId: Guid,
    channelName: string,
    channelKind: ChannelType
  ) {
    await api.channelInteraction.CreateChannel(spaceId, v7(), {
      name: channelName,
      desc: "",
      kind: channelKind,
      spaceId: spaceId,
    });
  }

  async function deleteChannel(channelId: string) {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return;

    await api.channelInteraction.DeleteChannel(selectedServer, channelId);
  }

  async function getServerInvites(): Promise<InviteCodeEntity[]> {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return [];

    return api.serverInteraction.GetInviteCodes(selectedServer);
  }

  async function addInvite(): Promise<InviteCode | null> {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return null;

    return api.serverInteraction.CreateInviteCode(selectedServer);
  }

  return {
    isBeginConnect,
    isConnected,
    joinToServer,
    addChannelToServer,
    deleteChannel,
    getServerInvites,
    addInvite,
    createServer,
  };
});
