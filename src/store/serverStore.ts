import { toast } from "@/components/ui/toast";
import { logger } from "@/lib/logger";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { usePoolStore } from "./poolStore";

export const useServerStore = defineStore("server", () => {
  const api = useApi();
  const isBeginConnect = ref(false);
  const isConnected = ref(false);
  const pool = usePoolStore();

  async function createServer(name: string): Promise<boolean> {
    try {
      await api.userInteraction.CreateServer({
        AvatarFileId: "",
        Description: "",
        Name: name,
      });
      await pool.loadServerDetails();
      return true;
    } catch (e) {
      logger.error("failed to create server", e);
      return false;
    }
  }

  async function joinToServer(inviteCode: string): Promise<boolean> {
    const r = await api.userInteraction.JoinToServerAsync({
      inviteCode,
    });

    if (r.IsSuccess) {
      await pool.loadServerDetails();
      return true;
    }
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
          description:
            "Invite code not found or you are not allowed to join this server",
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

  async function addChannelToServer(
    channelName: string,
    channelKind: "Text" | "Voice" | "Announcement",
  ) {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return;

    await api.serverInteraction.CreateChannel({
      name: channelName,
      desc: "",
      kind: channelKind,
      serverId: selectedServer,
    });
  }

  async function deleteChannel(channelId: string) {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return;

    await api.serverInteraction.DeleteChannel(selectedServer, channelId);
  }

  async function getServerInvites(): Promise<InviteCodeEntity[]> {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return [];

    return api.serverInteraction.GetInviteCodes(selectedServer);
  }

  async function addInvite(): Promise<InviteCode | null> {
    const selectedServer = pool.selectedServer;
    if (!selectedServer) return null;

    return api.serverInteraction.CreateInviteCode(
      selectedServer,
      77760000000000n,
    );
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
