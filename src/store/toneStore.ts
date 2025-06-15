import { defineStore, storeToRefs } from "pinia";
import { usePreference } from "./preferenceStore";
import { type Ref, ref } from "vue";
import { useSound } from "./../lib/sound";
import normalizedAtlas from "@/assets/sounds/normalized_atlas.wav";
import { audio } from "@/lib/audio/AudioManager";
import { logger } from "@/lib/logger";

export const useTone = defineStore("tone", () => {
  const prefs = usePreference();
  const _soundLevel = ref(prefs.soundLevel ** 2);

  const {
    isEnable_playSoftEnterSound,
    isEnable_playReconnectSound,
    isEnable_playSoftLeaveSound,
    isEnable_playMuteAllSound,
    isEnable_playUnmuteAllSound,
    isEnable_playNotificationSound,
    isEnable_playRingSound,
  } = storeToRefs(prefs);

  const { play } = useSound(normalizedAtlas, {
    volume: _soundLevel as any,
    sprite: {
      playMuteAllSound: [0, 1006],
      playUnmuteAllSound: [1022, 1876 - 1022],
      playSoftEnterSound: [1876, 2923 - 1876],
      playSoftLeaveSound: [2923, 4083 - 2923],
      playNotificationSound: [4083, 5335 - 4083],
      playRingSound: [5335, 8665 - 5335],
      playReconnectSound: [9879, 12046 - 9879],
    },
    audioContext: audio.getCurrentAudioContext(),
  });

  prefs.onSoundLevelChanged.subscribe((e) => {
    const perceptual = e ** 2;
    logger.info("changed sound level to", e, perceptual);
    _soundLevel.value = perceptual;
  });

  function init() {}

  function playSoftEnterSound() {
    play_id("playSoftEnterSound", isEnable_playSoftEnterSound);
  }
  function playReconnectSound() {
    play_id("playReconnectSound", isEnable_playReconnectSound);
  }
  function playSoftLeaveSound() {
    play_id("playSoftLeaveSound", isEnable_playSoftLeaveSound);
  }
  function playMuteAllSound() {
    play_id("playMuteAllSound", isEnable_playMuteAllSound);
  }
  function playUnmuteAllSound() {
    play_id("playUnmuteAllSound", isEnable_playUnmuteAllSound);
  }
  function playNotificationSound() {
    play_id("playNotificationSound", isEnable_playNotificationSound);
  }
  function playRingSound() {
    play_id("playRingSound", isEnable_playRingSound);
  }

  function play_id(id: string, isEnabled: Ref<boolean>) {
    if (!isEnabled.value) return;
    play({ id, forceSoundEnabled: true });
  }

  return {
    init,
    playSoftLeaveSound,
    playSoftEnterSound,
    playReconnectSound,
    playMuteAllSound,
    playUnmuteAllSound,
    playNotificationSound,
    playRingSound,
  };
});

(window as any).toneStore = useTone;
