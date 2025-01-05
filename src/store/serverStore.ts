import { defineStore } from "pinia";
import { useApi } from "./apiStore";
import { toast } from "@/components/ui/toast";
import { ref } from "vue";
import { usePoolStore } from "./poolStore";

export const useServerStore = defineStore("server", () => {
  const api = useApi();
  const isBeginConnect = ref(false);
  const isConnected = ref(false);
  const pool = usePoolStore();

  async function joinToServer(inviteCode: string): Promise<boolean> {
    const r = await api.userInteraction.JoinToServerAsync({
      inviteCode,
    });

    if (r.IsSuccess) {
      await pool.loadServerDetails();
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

  async function addChannelToServer(channelName: string, channelKind: "Text" | "Voice" | "Announcement") {
    await api.serverInteraction.CreateChannel({
      name: channelName,
      desc: "",
      kind: channelKind,
      serverId: pool.selectedServer!
    });
  }

  async function deleteChannel(channelId: string) {
    await api.serverInteraction.DeleteChannel(pool.selectedServer!, channelId);
  }


  async function getServerInvites(): Promise<InviteCodeEntity[]> {
    return api.serverInteraction.GetInviteCodes(pool.selectedServer!);
  }

  async function addInvite(): Promise<InviteCode> {
    return api.serverInteraction.CreateInviteCode(pool.selectedServer!, 77760000000000n);
  }
  
  return {
    isBeginConnect,
    isConnected,
    joinToServer,
    addChannelToServer,
    deleteChannel,
    getServerInvites,
    addInvite
  };
});
