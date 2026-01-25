import { defineStore, storeToRefs } from "pinia";
import { usePreference } from "./preferenceStore";
import { ref } from "vue";
import { createAudioAtlas, type AudioAtlas } from "@argon/soundfx";
import normalizedAtlas from "@argon/assets/sounds/normalized_atlas.wav";
import { audio } from "@/lib/audio/AudioManager";
import { logger } from "@argon/core";

// Sprite definitions: [startMs, durationMs]
const SPRITES = {
  mute: [0, 1006],
  unmute: [1022, 854],
  enter: [1876, 1047],
  leave: [2923, 1160],
  notification: [4083, 1252],
  ring: [5335, 3330],
  reconnect: [9879, 2167],
} as const satisfies Record<string, [number, number]>;

type SpriteId = keyof typeof SPRITES;

export const useTone = defineStore("tone", () => {
  const prefs = usePreference();
  const volume = ref(prefs.soundLevel ** 2);

  const {
    isEnable_playSoftEnterSound,
    isEnable_playReconnectSound,
    isEnable_playSoftLeaveSound,
    isEnable_playMuteAllSound,
    isEnable_playUnmuteAllSound,
    isEnable_playNotificationSound,
    isEnable_playRingSound,
  } = storeToRefs(prefs);

  // Map of sprite IDs to their preference refs
  const spritePrefs: Record<SpriteId, { value: boolean }> = {
    mute: isEnable_playMuteAllSound,
    unmute: isEnable_playUnmuteAllSound,
    enter: isEnable_playSoftEnterSound,
    leave: isEnable_playSoftLeaveSound,
    notification: isEnable_playNotificationSound,
    ring: isEnable_playRingSound,
    reconnect: isEnable_playReconnectSound,
  };

  let atlas: AudioAtlas | null = null;
  let ringInstanceId: number | null = null;

  function ensureAtlas(): AudioAtlas {
    if (!atlas) {
      atlas = createAudioAtlas({
        src: normalizedAtlas,
        sprites: SPRITES,
        defaultOptions: {
          volume: volume.value,
          audioContext: audio.getCurrentAudioContext(),
          destination: audio.getOutputDestination(),
        },
      });
    }
    return atlas;
  }

  // Subscribe to sound level changes
  prefs.onSoundLevelChanged.subscribe((level) => {
    const perceptual = level ** 2;
    logger.info("Sound level changed:", level, "→", perceptual);
    volume.value = perceptual;
    atlas?.setVolume(perceptual);
  });

  function play(sprite: SpriteId, loop = false): void {
    if (!spritePrefs[sprite].value) return;
    ensureAtlas().play(sprite, { forceSoundEnabled: true, loop });
  }

  function init() {
    ensureAtlas();
  }

  // Public API - individual sound methods for backward compatibility
  const playSoftEnterSound = () => play("enter");
  const playSoftLeaveSound = () => play("leave");
  const playReconnectSound = () => play("reconnect");
  const playMuteAllSound = () => play("mute");
  const playUnmuteAllSound = () => play("unmute");
  const playNotificationSound = () => play("notification");
  
  const playRingSound = () => {
    if (!isEnable_playRingSound.value) return;
    ringInstanceId = ensureAtlas().play("ring", { forceSoundEnabled: true, loop: true });
  };
  
  const stopPlayRingSound = () => {
    if (ringInstanceId !== null) {
      atlas?.stop("ring", ringInstanceId);
      ringInstanceId = null;
    } else {
      atlas?.stop("ring");
    }
  };

  return {
    init,
    playSoftEnterSound,
    playSoftLeaveSound,
    playReconnectSound,
    playMuteAllSound,
    playUnmuteAllSound,
    playNotificationSound,
    playRingSound,
    stopPlayRingSound,
  };
});

(window as any).toneStore = useTone;
