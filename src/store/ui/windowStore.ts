import { defineStore } from "pinia";
import { ref } from "vue";

export const useWindow = defineStore("window", () => {
  const settingsOpen = ref(false);
  const serverSettingsOpen = ref(false);

  // Invite preview modal — opened from the join UI or an argon://invite/{code} deep link.
  const invitePreviewOpen = ref(false);
  const invitePreviewCode = ref("");

  function openInvitePreview(code: string) {
    if (!code) return;
    invitePreviewCode.value = code;
    invitePreviewOpen.value = true;
  }

  return { settingsOpen, serverSettingsOpen, invitePreviewOpen, invitePreviewCode, openInvitePreview };
});
