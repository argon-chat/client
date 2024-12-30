import { init, GlueRuntime } from "@/lib/glue";
import { defineStore } from "pinia";
import { ref } from "vue";
import { logger } from "@/lib/logger";

export const useGlueStore = defineStore("glue", () => {
  const dotnetRuntime = ref(null as GlueRuntime | null);
  const isInitialized = ref(false);

  async function initializeGlueRuntime() {
    try {
      if (!isInitialized.value) {
        dotnetRuntime.value = await init();
        (window as any).gluecode = dotnetRuntime.value;
        dotnetRuntime.value.getAssemblyExports("Argon.Glue").then(x => {
          console.log(x);
        });
        isInitialized.value = true;
      }
    } catch (error) {
      logger.error('Failed to initialize glueRuntime:', error);
    }
  }

  return { initializeGlueRuntime };
});
