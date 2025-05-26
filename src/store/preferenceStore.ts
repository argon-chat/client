import { persistedValue } from "@/lib/persistedValue";
import { defineStore } from "pinia";
import { Subject } from "rxjs";
import { watch } from "vue";

export const usePreference = defineStore("preference", () => {
    const defaultAudioDevice = persistedValue<string>("defaultAudioDevice", "");
    const defaultVideoDevice = persistedValue<string>("defaultVideoDevice", "");
    const forceToMono = persistedValue<boolean>("forceToMono", false);

    
    const echoCancellation = persistedValue<boolean>("echoCancellation", false);
    const autoGainControl = persistedValue<boolean>("autoGainControl", false);
    const noiseSuppression = persistedValue<boolean>("noiseSuppression", false);
    const voiceIsolation = persistedValue<boolean>("voiceIsolation", false);


    const minimizeToTrayOnClose = persistedValue<boolean>("minimizeToTrayOnClose", true);



    const soundLevel = persistedValue<number>("soundLevel", 0.5);

    const onSoundLevelChanged = new Subject<number>();


    watch(soundLevel, (e) => {
      onSoundLevelChanged.next(e);
    });


    const isEnable_playSoftEnterSound = persistedValue<boolean>("sound_active_playSoftEnterSound", true);
    const isEnable_playReconnectSound = persistedValue<boolean>("sound_active_playReconnectSound", true);
    const isEnable_playSoftLeaveSound = persistedValue<boolean>("sound_active_playSoftLeaveSound", true);
    const isEnable_playMuteAllSound = persistedValue<boolean>("sound_active_playMuteAllSound", true);
    const isEnable_playUnmuteAllSound = persistedValue<boolean>("sound_active_playUnmuteAllSound", true);
    const isEnable_playNotificationSound = persistedValue<boolean>("sound_active_playNotificationSound", true);
    const isEnable_playRingSound = persistedValue<boolean>("sound_active_playRingSound", true);


    return {
        defaultAudioDevice,
        defaultVideoDevice,
        forceToMono,

        echoCancellation,
        autoGainControl,
        noiseSuppression,
        voiceIsolation,

        minimizeToTrayOnClose,
        soundLevel,
        onSoundLevelChanged,



        isEnable_playSoftEnterSound,
        isEnable_playReconnectSound,
        isEnable_playSoftLeaveSound,
        isEnable_playMuteAllSound,
        isEnable_playUnmuteAllSound,
        isEnable_playNotificationSound,
        isEnable_playRingSound
    };
  }
);
