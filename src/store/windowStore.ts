import { defineStore } from "pinia";
import { ref } from "vue";

export const useWindow = defineStore("window", () => {
  const settingsOpen = ref(false);

  return { settingsOpen };
});