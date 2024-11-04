import { init, GlueRuntime } from "@/lib/glue";
import { defineStore } from "pinia";
import { ref } from "vue";

export interface IGlueLayout {
  FusionCore: { BeginConnect(url: string): Promise<void> };
  UserAuthorization: IUserAuthorization;
  UserInteraction: IUserInteraction;
}

export const useGlueStore = defineStore("glue", () => {
  const dotnetRuntime = ref(null as GlueRuntime | null);
  const isInitialized = ref(false);
  const transport = ref({} as IGlueLayout);

  async function initializeGlueRuntime() {
    try {
      if (!isInitialized.value) {
        dotnetRuntime.value = await init();
        (window as any).gluecode = dotnetRuntime.value;
        dotnetRuntime.value.getAssemblyExports("Argon.Glue").then(x => {
          console.log(x);
          (window as any).glue = x.Argon.Glue;
          transport.value = x.Argon.Glue;
        });
        isInitialized.value = true;
      }
    } catch (error) {
      console.error('Failed to initialize glueRuntime:', error);
    }
  }

  return { initializeGlueRuntime, transport };
});
