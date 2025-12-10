import { defineStore } from "pinia";
import { logger } from "@/lib/logger";
import { useOnline } from "@vueuse/core";
import delay from "@/lib/delay";
import { ref } from "vue";
import { useTone } from "./toneStore";
import { useAuthStore } from "./authStore";
import { useFileStorage } from "./fileStorage";
import { useMe } from "./meStore";
import { usePoolStore } from "./poolStore";
import { usePredictor } from "./predictorStore";
import { useIdleStore } from "./idleStore";
import { useActivity } from "./activityStore";
import { worklets } from "@/lib/audio/WorkletBase";
import router from "@/router";

export const useAppState = defineStore("app", () => {
  const isOnline = useOnline();
  const isFailedLoad = ref(false);
  const isLoaded = ref(false);

  async function initializeArgonApp(): Promise<boolean> {
    while (!isOnline.value) {
      logger.info("Waiting network online...");
      await delay(1000);
    }

    logger.info("Begin init tone audio engine...");

    useTone().init();

    logger.info("Restoring session...");

    const auth = await useAuthStore();
    auth.restoreSession();

    logger.info("Load wasm predictor...");

    const predictor = usePredictor();

    await predictor.init();

    logger.info("Load audio manager...");

    await worklets.init();

    logger.info("Create buckets...");
    await useFileStorage().initStorages();

    logger.info("Fetch data...");

    const poolStore = usePoolStore();

    await poolStore.init();

    if (auth.isAuthenticated) {
      const me = useMe();

      const continueNext = await me.init();

      if (!continueNext) {
        router.push({ path: "/blocked.pg" });
        return false;
      }

      poolStore.loadServerDetails();

      await me.completeInit();
      
      await useIdleStore().init();
      await useActivity().init();
    }

    return true;
  }

  async function initApp() {
    logger.info("Begin initialization argon application");
    try {
      const success = await initializeArgonApp();
      isLoaded.value = true;
      if (success)
        router.push({ path: "/master.pg" });
      logger.success("Complete initialization");
    } catch (e) {
      isFailedLoad.value = true;
      logger.error("Failed init argon app", e);
    }
  }

  return { initApp, isFailedLoad, isLoaded };
});
