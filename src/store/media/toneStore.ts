import { defineStore, storeToRefs } from "pinia";
import { usePreference } from "@/store/ui/preferenceStore";
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
          // Decoded on the first sound rather than at boot: the decoded PCM stays resident for the
          // whole session, so it is only paid for by sessions that actually play something.
          preload: false,
        },
      });
    }
    return atlas;
  }

  /** The atlas, decoded. Instant after the first call. */
  async function ready(): Promise<AudioAtlas> {
    const a = ensureAtlas();
    if (!a.isLoaded.value) await a.load();
    return a;
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
    void ready()
      .then((a) => a.play(sprite, { forceSoundEnabled: true, loop }))
      .catch((err) => logger.warn("[tone] sound unavailable:", err));
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

  // Whether a ring is wanted right now: a stop that lands while the atlas is still decoding must
  // win over the play that is about to start.
  let ringWanted = false;

  const playRingSound = () => {
    if (!isEnable_playRingSound.value) return;
    ringWanted = true;
    void ready()
      .then((a) => {
        if (!ringWanted) return;
        ringInstanceId = a.play("ring", { forceSoundEnabled: true, loop: true });
      })
      .catch((err) => logger.warn("[tone] ring unavailable:", err));
  };

  const stopPlayRingSound = () => {
    ringWanted = false;
    if (ringInstanceId !== null && ringInstanceId !== -1) {
      atlas?.stop("ring", ringInstanceId);
    } else {
      atlas?.stop("ring");
    }
    ringInstanceId = null;
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
