<script setup lang="ts">
import type { ArgonUserProfile } from "@argon/glue";

import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { PREVIEW_USER_ID } from "@/cosmetics/preview/previewUserId";

/**
 * A face wearing its ornament, at the three sizes the product actually draws one.
 *
 * <b>All three, because an ornament is a different object at each.</b> The same ring that reads as
 * a wreath at 64 pixels is a fuzzy halo at 34 and a smudge at 22 — and the smallest is the one
 * drawn thousands of times in a member list.
 */
withDefaults(
  defineProps<{
    profile: Pick<ArgonUserProfile, "cosmetics"> | null;
    displayName: string;
    avatarFileId: string | null;

    /** Whose face it is. The preview's stand-in unless a real wearer is named. */
    userId?: string;
  }>(),
  { userId: PREVIEW_USER_ID },
);

const SIZES = [64, 34, 22];

/**
 * How much room to leave around each face for whatever is worn on it.
 *
 * <b>Measured from the widest thing an ornament is allowed to be, not from what looks tidy.</b> A
 * decoration is sized from an inset and reaches a little past the circle, and a room too small
 * crops the drawing, which reads as art drawn wrong.
 */
const ROOM = 2.4;
</script>

<template>
  <div class="avatar-stage">
    <div v-for="size in SIZES" :key="size" class="avatar-slot">
      <!--
        Room around the face for whatever the ornament hangs outside it. An avatar decoration is
        sized from its inset, so it is allowed past the circle by design.
      -->
      <div class="avatar-room" :style="{ width: `${size * ROOM}px`, height: `${size * ROOM}px` }">
        <ArgonAvatar
          :profile="profile"
          :user-id="userId"
          :file-id="avatarFileId"
          :fallback="displayName"
          :overrided-size="size"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.avatar-stage {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding: 8px 4px;
}

.avatar-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.avatar-room {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
