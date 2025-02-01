import { defineStore } from "pinia";
import { ref } from "vue";

export const usePreference = defineStore("preference", () => {
    const defaultAudioDevice = ref("");
    const defaultVideoDevice = ref("");


    const echoCancellation = ref(false);
    const autoGainControl = ref(false);
    const noiseSuppression = ref(false);
    const voiceIsolation = ref(false);


    return {
        defaultAudioDevice,
        defaultVideoDevice,

        echoCancellation,
        autoGainControl,
        noiseSuppression,
        voiceIsolation
    };
  },
  {
    persist: true,
  }
);
