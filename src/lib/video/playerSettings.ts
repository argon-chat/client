import { computed, shallowRef, type ComputedRef, type WritableComputedRef } from "vue";
import { persisted } from "@argon/storage";
import { userScopedKey } from "@/lib/userScopedStorage";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { animationsDefault } from "@/lib/expressions/settings";
import { powerSaveActive } from "@/lib/powerSaver";
import { clampPlaybackRate } from "./playerMath";

// Per user. The player's volume, mute and speed are remembered across videos, like tweb's
// playback controller.

export const VIDEO_AUTOPLAY_KEY = "argon_video_autoplay";
export const VIDEO_AUTOPLAY_MAX_BYTES_KEY = "argon_video_autoplay_max_bytes";
export const VIDEO_LOOP_SHORT_KEY = "argon_video_loop_short";
export const PLAYER_VOLUME_KEY = "argon_video_volume";
export const PLAYER_MUTED_KEY = "argon_video_muted";
export const PLAYER_RATE_KEY = "argon_video_rate";

/** Telegram's line: a video above this does not play by itself in the chat. */
export const DEFAULT_AUTOPLAY_MAX_BYTES = 50 * 1024 * 1024;
/** Shorter than this loops in the viewer (when the switch is on). */
export const SHORT_VIDEO_MS = 60_000;

const open = () => ({
  autoplay: persisted<boolean | null>(userScopedKey(VIDEO_AUTOPLAY_KEY), null),
  autoplayMaxBytes: persisted<number>(userScopedKey(VIDEO_AUTOPLAY_MAX_BYTES_KEY), DEFAULT_AUTOPLAY_MAX_BYTES),
  loopShort: persisted<boolean>(userScopedKey(VIDEO_LOOP_SHORT_KEY), true),
  volume: persisted<number>(userScopedKey(PLAYER_VOLUME_KEY), 1),
  muted: persisted<boolean>(userScopedKey(PLAYER_MUTED_KEY), false),
  rate: persisted<number>(userScopedKey(PLAYER_RATE_KEY), 1),
});

const stores = shallowRef(open());
onSessionReset(() => {
  stores.value = open();
});

/**
 * "Autoplay videos in chat" as the user left it: their choice, or until they make one, on unless
 * the OS or the app's "reduce motion" asks for less — the same default as animated stickers.
 */
export const videoAutoplayInChat: WritableComputedRef<boolean> = computed({
  get: () => stores.value.autoplay.value ?? animationsDefault.value,
  set: (value) => stores.value.autoplay.set(value),
});

/** Whether chat videos play by themselves now: the switch, unless power saving holds everything still. */
export const videoAutoplayActive: ComputedRef<boolean> = computed(() => !powerSaveActive.value && videoAutoplayInChat.value);

/** The largest file that autoplays in the chat. Not in the UI. */
export const videoAutoplayMaxBytes: ComputedRef<number> = computed(() => {
  const value = stores.value.autoplayMaxBytes.value;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_AUTOPLAY_MAX_BYTES;
});

/** "Loop short videos in the viewer". */
export const videoLoopShort: WritableComputedRef<boolean> = computed({
  get: () => stores.value.loopShort.value !== false,
  set: (value) => stores.value.loopShort.set(value),
});

export const playerVolume: WritableComputedRef<number> = computed({
  get: () => {
    const value = stores.value.volume.value;
    return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  },
  set: (value) => stores.value.volume.set(Math.min(1, Math.max(0, value))),
});

export const playerMuted: WritableComputedRef<boolean> = computed({
  get: () => stores.value.muted.value === true,
  set: (value) => stores.value.muted.set(value),
});

export const playerPlaybackRate: WritableComputedRef<number> = computed({
  get: () => clampPlaybackRate(Number(stores.value.rate.value)),
  set: (value) => stores.value.rate.set(clampPlaybackRate(value)),
});

/** Appearance's "reset": autoplay follows its default again and short videos loop. The player's volume and speed stay. */
export function resetVideoChatChoices(): void {
  stores.value.autoplay.set(null);
  stores.value.loopShort.set(true);
}

/** Whether a file of this size may autoplay in the chat right now. */
export function fitsChatAutoplay(fileSize: number | bigint | null | undefined): boolean {
  const size = Number(fileSize ?? 0);
  return videoAutoplayActive.value && Number.isFinite(size) && size >= 0 && size <= videoAutoplayMaxBytes.value;
}

/** Whether the viewer loops this clip. */
export function loopsInViewer(durationMs: number | null | undefined): boolean {
  return videoLoopShort.value && !!durationMs && durationMs > 0 && durationMs < SHORT_VIDEO_MS;
}
