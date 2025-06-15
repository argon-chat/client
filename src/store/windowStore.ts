import { defineStore } from "pinia";
import { ref } from "vue";

export const useWindow = defineStore("window", () => {
  const settingsOpen = ref(false);
  const serverSettingsOpen = ref(false);
  const streamSettingOpen = ref(false);

  return { settingsOpen, serverSettingsOpen };
});
