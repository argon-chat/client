import { defineStore } from "pinia";
import { logger } from "@/lib/logger";
import { useGlueStore } from "./glueStore";
import { useFirebase } from "./firebase";
import { useOnline } from "@vueuse/core";
import delay from "@/lib/delay";
import { ref } from "vue";
import { useTone } from "./toneStore";
import { useAuthStore } from "./authStore";
import { useServerStore } from "./serverStore";
import { useFileStorage } from "./fileStorage";

export const useAppState = defineStore("app", () => {
  const isOnline = useOnline();
  const isFailedLoad = ref(false);
  const isLoaded = ref(false);

  async function initializeArgonApp(): Promise<void> {
    while(!isOnline.value) {
        logger.info(`Waiting network online...`);
        await delay(1000);
    }
    logger.info(`Begin initialization glue runtime...`);
    await delay(1000);

    await useGlueStore().initializeGlueRuntime();

    logger.info(`Begin initialization firebase runtime...`);
    await delay(1000);

    await useFirebase().initCfg();

    logger.info(`Begin init tone audio engine...`);
    await delay(1000);

    useTone().init();

    logger.info(`Restoring session...`);
    await delay(1000);

    const auth = await useAuthStore();
    auth.restoreSession();


    logger.info(`Create buckets...`);
    await useFileStorage().initStorages();

    logger.info(`Fetch data...`);
    await delay(1000);

    if(auth.isAuthenticated)
      await useServerStore().init();
  }

  async function initApp() {
    logger.info(`Begin initialization argon application`);
    try {
        await initializeArgonApp();
        isLoaded.value = true;
        logger.success(`Complete initialization`);
    }
    catch (e) {
        isFailedLoad.value = true;
        logger.error(`Failed init argon app`, e);
    }
  }

  return { initApp, isFailedLoad, isLoaded };
});