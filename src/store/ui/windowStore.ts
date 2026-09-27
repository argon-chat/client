import { defineStore } from "pinia";
import { ref } from "vue";
import { extractInviteCode } from "@/lib/inviteCode";

export const useWindow = defineStore("window", () => {
  const settingsOpen = ref(false);
  const serverSettingsOpen = ref(false);
  /** The section the server settings should land on; taken by the window once it can show it. */
  const serverSettingsCategory = ref<ServerSettingsCategory | null>(null);

  function openServerSettings(category: ServerSettingsCategory | null = null) {
    serverSettingsCategory.value = category;
    serverSettingsOpen.value = true;
  }

  // Invite preview modal — opened from the join UI or an argon://invite/{code} deep link.
  const invitePreviewOpen = ref(false);
  const invitePreviewCode = ref("");

  function openInvitePreview(code: string) {
    // Normalised here rather than at each caller: the join box, the quick-join widget and the
    // argon:// handler all receive whatever was pasted, and a full invite URL sent to the server as
    // if it were a code comes back as "invite not found" — which blames the invite for a paste.
    const normalized = extractInviteCode(code);
    if (!normalized) return;
    invitePreviewCode.value = normalized;
    invitePreviewOpen.value = true;
  }

  // Channel settings drawer — one instance for the whole app (like the server settings), told
  // which channel to edit and which tab to land on when it opens.
  const channelSettingsOpen = ref(false);
  const channelSettingsSpaceId = ref<string | null>(null);
  const channelSettingsChannelId = ref<string | null>(null);
  const channelSettingsTab = ref<ChannelSettingsTab>("overview");

  function openChannelSettings(spaceId: string, channelId: string, tab: ChannelSettingsTab = "overview") {
    channelSettingsSpaceId.value = spaceId;
    channelSettingsChannelId.value = channelId;
    channelSettingsTab.value = tab;
    channelSettingsOpen.value = true;
  }

  function closeChannelSettings() {
    channelSettingsOpen.value = false;
  }

  return {
    settingsOpen,
    serverSettingsOpen,
    serverSettingsCategory,
    openServerSettings,
    invitePreviewOpen,
    invitePreviewCode,
    openInvitePreview,
    channelSettingsOpen,
    channelSettingsSpaceId,
    channelSettingsChannelId,
    channelSettingsTab,
    openChannelSettings,
    closeChannelSettings,
  };
});

export type ServerSettingsCategory = "profile" | "invites" | "archetypes" | "expressions" | "bots";

export type ChannelSettingsTab ="overview" | "permissions" | "broadcast" | "announcement" | "follows" | "integrations";
