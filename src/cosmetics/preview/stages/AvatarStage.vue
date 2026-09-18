<script setup lang="ts">
import { computed } from "vue";
import type { ArgonUserProfile } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { PREVIEW_USER_ID } from "@/cosmetics/preview/previewProfile";

/**
 * A face wearing its ornament, at the three sizes the product actually draws one.
 *
 * <b>All three, because an ornament is a different object at each.</b> The same ring that reads as
 * a wreath at 96 pixels is a fuzzy halo at 34 and a smudge at 22 — and the smallest is the one
 * drawn thousands of times in a member list. An operator shown only the big one approves art that
 * only exists on a profile card.
 */
const props = withDefaults(
  defineProps<{
    profile: ArgonUserProfile | null;
    displayName: string;
    avatarFileId: string | null;

    /** Whose face it is. The preview's stand-in unless a real wearer is named. */
    userId?: string;

    /**
     * Smaller, and without the pixel counts under each.
     *
     * For the wardrobe, where the same stage is shown to the person wearing the thing rather than
     * to the operator publishing it: "34px" is a fact about the product, not about their face.
     */
    compact?: boolean;
  }>(),
  { userId: PREVIEW_USER_ID, compact: false },
);

const SIZES = [96, 34, 22];

const COMPACT_SIZES = [64, 34, 22];

/**
 * How much room to leave around each face for whatever is worn on it.
 *
 * <b>Measured from the widest thing an ornament is allowed to be, not from what looks tidy.</b> A
 * decoration is sized from an inset and reaches a little past the circle; a figure in orbit is
 * allowed a long way further out, and the page framing this one reports the size it measures — so a
 * room too small does not crop the drawing here, it tells the console to open a window that crops
 * it, which reads as art drawn wrong.
 */
const ROOM = 2.4;

const sizes = computed(() => (props.compact ? COMPACT_SIZES : SIZES));
</script>

<template>
  <div class="avatar-stage">
    <div v-for="size in sizes" :key="size" class="avatar-slot">
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
      <span v-if="!compact" class="avatar-caption">{{ size }}px</span>
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

.avatar-caption {
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  color: hsl(var(--muted-foreground));
}
</style>
