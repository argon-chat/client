import { computed, shallowRef, type WritableComputedRef } from "vue";
import { persisted, type PersistedRef } from "@argon/storage";
import { userScopedKey } from "@/lib/userScopedStorage";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { VIDEO_LADDER, type VideoQuality } from "./plan";

// Per user. `auto` sends up to 1080p.

export const VIDEO_UPLOAD_QUALITY_KEY = "argon_video_upload_quality";
export const DEFAULT_VIDEO_UPLOAD_QUALITY: VideoQuality = "auto";

export function isVideoQuality(value: unknown): value is VideoQuality {
  return value === "auto" || value === "original" || (VIDEO_LADDER as readonly unknown[]).includes(value);
}

const open = (): PersistedRef<VideoQuality> => persisted<VideoQuality>(userScopedKey(VIDEO_UPLOAD_QUALITY_KEY), DEFAULT_VIDEO_UPLOAD_QUALITY);

const store = shallowRef(open());
onSessionReset(() => {
  store.value = open();
});

/** The quality videos are prepared at: `auto` (up to 1080p), a rung of the ladder, or `original`. */
export const videoUploadQuality: WritableComputedRef<VideoQuality> = computed({
  get: () => {
    const value = store.value.value;
    return isVideoQuality(value) ? value : DEFAULT_VIDEO_UPLOAD_QUALITY;
  },
  set: (value) => {
    if (isVideoQuality(value)) store.value.set(value);
  },
});
