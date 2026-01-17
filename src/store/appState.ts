import { defineStore } from "pinia";
import { logger } from "@argon/core";
import { useOnline } from "@vueuse/core";
import { delay } from "@argon/core";
import { ref } from "vue";
import { useTone } from "./toneStore";
import { useAuthStore } from "./authStore";
import { useFileStorage } from "./fileStorage";
import { useMe } from "./meStore";
import { usePredictor } from "./predictorStore";
import { useIdleStore } from "./idleStore";
import { useActivity } from "./activityStore";
import { worklets, initWorklets } from "@/lib/audio/WorkletBase";
import { audio } from "@/lib/audio/AudioManager";
import router from "@/router";
import { useConfigStore } from "./configStore";
import { usePoolStore } from "./poolStore";

// Initialize worklets with audio getter to break circular dependency
initWorklets(() => audio);

export const useAppState = defineStore("app", () => {
  const isOnline = useOnline();
  const isFailedLoad = ref(false);
  const isLoaded = ref(false);
  const isInitializing = ref(false);
  const loadingStep = ref("");
  const loadingProgress = ref(0);
  const totalSteps = 10;
  const hasInitError = ref(false);
  const initError = ref("");

  async function initializeArgonApp(): Promise<boolean> {
    loadingStep.value = "Checking network...";
    loadingProgress.value = 0;

    while (!isOnline.value) {
      logger.info("Waiting network online...");
      await delay(1000);
    }

    loadingStep.value = "Initializing audio engine...";
    loadingProgress.value = 1;
    logger.info("Begin init tone audio engine...");
    useTone().init();
    await delay(100);

    loadingStep.value = "Restoring session...";
    loadingProgress.value = 2;
    logger.info("Restoring session...");
    const auth = await useAuthStore();
    auth.restoreSession();
    await delay(100);

    loadingStep.value = "Loading AI predictor...";
    loadingProgress.value = 3;
    logger.info("Load wasm predictor...");
    const predictor = usePredictor();
    await predictor.init();
    await delay(100);

    loadingStep.value = "Initializing audio worklets...";
    loadingProgress.value = 4;
    logger.info("Load audio manager...");
    await worklets.init();
    await delay(100);

    loadingStep.value = "Creating file storage...";
    loadingProgress.value = 5;
    logger.info("Create buckets...");
    await useFileStorage().initStorages();
    await delay(100);

    loadingStep.value = "Loading configurations...";
    loadingProgress.value = 6;
    logger.info("Load configurations...");
    await useConfigStore().load();
    await delay(100);

    loadingStep.value = "Initializing data store...";
    loadingProgress.value = 7;
    logger.info("Fetch data...");
    const poolStore = usePoolStore();
    await poolStore.init();
    await delay(100);

    if (auth.isAuthenticated) {
      loadingStep.value = "Loading user profile...";
      loadingProgress.value = 8;
      const me = useMe();
      const continueNext = await me.init();
      await delay(100);

      if (!continueNext) {
        router.push({ path: "/blocked.pg" });
        return false;
      }

      loadingStep.value = "Loading spaces and channels...";
      loadingProgress.value = 9;
      await poolStore.loadServerDetails();
      await delay(100);

      await me.completeInit();

      await useIdleStore().init();
      await useActivity().init();
    }

    loadingStep.value = "Finalizing...";
    loadingProgress.value = 10;

    return true;
  }

  async function initApp() {
    logger.info("Begin initialization argon application");
    isInitializing.value = true;
    hasInitError.value = false;
    initError.value = "";
    try {
      const success = await initializeArgonApp();
      isLoaded.value = true;
      if (success) router.push({ path: "/master.pg" });
      logger.success("Complete initialization");
    } catch (e) {
      isFailedLoad.value = true;
      hasInitError.value = true;
      initError.value = e instanceof Error ? e.message : String(e);
      logger.error("Failed init argon app", e);
    } finally {
      // Don't set isInitializing to false if there's an error - keep overlay visible
      if (!hasInitError.value) {
        isInitializing.value = false;
      }
    }
  }

  return {
    initApp,
    isFailedLoad,
    isLoaded,
    isInitializing,
    loadingStep,
    loadingProgress,
    totalSteps,
    hasInitError,
    initError,
  };
});
