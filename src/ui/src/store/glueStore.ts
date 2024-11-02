import { init, GlueRuntime } from "@/lib/glue";
import { defineStore } from "pinia";
import { ref } from "vue";

export const useGlueStore = defineStore("glue", () => {
  const dotnetRuntime = ref(null as GlueRuntime | null);
  const isInitialized = ref(false);

  async function initializeGlueRuntime() {
    try {
      if (!isInitialized.value) {
        dotnetRuntime.value = await init();
        dotnetRuntime.value.getAssemblyExports("argo.glue").then(x => {
          (window as any).glue = x.argo.glue;
          console.log(x);
        });
        isInitialized.value = true;
      }
    } catch (error) {
      console.error('Failed to initialize glueRuntime:', error);
    }
  }

  return { initializeGlueRuntime };
});
