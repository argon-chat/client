import { logger } from "@sentry/vue";
import { defineStore } from "pinia";
import { useApi } from "./apiStore";
import { ref } from "vue";

export const useActivity = defineStore("activity", () => {
  const api = useApi();
  const activeActivity = ref(null as null | number);

  async function init() {
    if (!argon.isArgonHost) return;
    const populatePinnedFn = native.createPinnedObject(onActivityDetected);
    if (!argon.onGameActivityDetected(populatePinnedFn))
      logger.error("failed to bind activity manager 1");
    const terminatedPinnedFn = native.createPinnedObject(onActivityTerminated);
    if (!argon.onGameActivityTerminated(terminatedPinnedFn))
        logger.error("failed to bind activity manager 2");
  }

  function onActivityDetected(str: string) {
    const process: { name: string; pid: number; hash: string } =
      JSON.parse(str);

    api.userInteraction.BroadcastPresenceAsync({
        Kind: "GAME",
        StartTimestampSeconds: 0,
        TitleName: process.name
    });
    activeActivity.value = process.pid;
  }

  function onActivityTerminated(pid: number) {
    if (activeActivity.value == pid) {
        api.userInteraction.RemoveBroadcastPresenceAsync();
        activeActivity.value = null;
    }
  }

  return {
    init,
  };
});
