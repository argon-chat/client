import { persistedValue } from "@/lib/persistedValue";
import { defineStore } from "pinia";

export const usePreference = defineStore("preference", () => {
    const defaultAudioDevice = persistedValue("defaultAudioDevice", "");
    const defaultVideoDevice = persistedValue("defaultVideoDevice", "");


    const echoCancellation = persistedValue("echoCancellation", false);
    const autoGainControl = persistedValue("autoGainControl", false);
    const noiseSuppression = persistedValue("noiseSuppression", false);
    const voiceIsolation = persistedValue("voiceIsolation", false);


    const minimizeToTrayOnClose = persistedValue("minimizeToTrayOnClose", true);


    return {
        defaultAudioDevice,
        defaultVideoDevice,

        echoCancellation,
        autoGainControl,
        noiseSuppression,
        voiceIsolation,

        minimizeToTrayOnClose
    };
  }
);
