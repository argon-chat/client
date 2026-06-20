import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { userScopedKey } from "@/lib/userScopedStorage";

export const useUserVolumeStore = defineStore("userVolume", () => {
  const volumes = useLocalStorage<Record<string, number>>(userScopedKey("userVolumes_v2"), {}, {
    mergeDefaults: true,
  });

  function getUserVolume(userId: string): number {
    return volumes.value[userId] ?? 100;
  }

  function setUserVolume(userId: string, volume: number) {
    volumes.value[userId] = volume;
  }

  return {
    getUserVolume,
    setUserVolume,
  };
});
