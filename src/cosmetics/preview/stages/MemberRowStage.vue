<script setup lang="ts">
import type { ArgonUserProfile } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import CosmeticNickname from "@/cosmetics/CosmeticNickname.vue";
import CosmeticSurface from "@/cosmetics/CosmeticSurface.vue";
import { PREVIEW_USER_ID } from "@/cosmetics/preview/previewProfile";

/**
 * A line in a member list — the busiest place a name is ever drawn.
 *
 * <b>Worth its own stage because it is where a name is smallest.</b> A treatment that reads on a
 * profile card at 15 pixels can be an illegible smear at 12 with a row highlight behind it, and the
 * card alone would never have shown that.
 *
 * The row around it is drawn here rather than borrowed from the member list, which is bound to a
 * space, a roster and a popover. What is borrowed is everything that is cosmetic: the backdrop
 * surface, the avatar with whatever it wears, and the name.
 */
withDefaults(
  defineProps<{
    profile: ArgonUserProfile | null;
    displayName: string;
    avatarFileId: string | null;

    /** Whose line it is. The preview default stands in when no real wearer is named. */
    userId?: string;
  }>(),
  { userId: PREVIEW_USER_ID },
);

/** The row's own backdrop takes pictures, not names: the name is drawn by the nickname below. */
const ROW_BACKGROUND = ["imageLayer", "videoLayer", "spriteSheet"] as const;

/** Somebody to sit beside, because a name is judged against the names around it. */
const NEIGHBOURS = ["Casper", "Nadia"];
</script>

<template>
  <div class="member-list">
    <div class="member-row">
      <div class="row-backdrop">
        <CosmeticSurface
          surface="memberListRow"
          :profile="profile"
          :primitives="ROW_BACKGROUND"
        />
      </div>

      <div class="row-avatar">
        <ArgonAvatar
          :profile="profile"
          :user-id="userId"
          :file-id="avatarFileId"
          :fallback="displayName"
          :overrided-size="34"
        />
        <span class="row-dot" />
      </div>

      <div class="row-text">
        <CosmeticNickname class="row-name" surface="memberListRow" :profile="profile">
          {{ displayName }}
        </CosmeticNickname>
        <span class="row-activity">Playing something</span>
      </div>
    </div>

    <!-- Two plain rows underneath, so the styled one is read against what it sits among. -->
    <div v-for="neighbour in NEIGHBOURS" :key="neighbour" class="member-row member-row--plain">
      <div class="row-avatar">
        <span class="row-face">{{ neighbour.slice(0, 1) }}</span>
      </div>
      <div class="row-text">
        <span class="row-name row-name--plain">{{ neighbour }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.member-list {
  width: 232px;
  padding: 6px;
  border-radius: 12px;
  background: hsl(var(--card) / 0.6);
  border: 1px solid hsl(var(--border) / 0.4);
}

.member-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 8px;
  overflow: hidden;
}

.member-row:first-child {
  background: hsl(var(--accent) / 0.35);
}

.member-row--plain {
  opacity: 0.45;
}

.row-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
}

.row-avatar {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  line-height: 0;
}

.row-face {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  font-weight: 600;
}

.row-dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4ade80;
  border: 2px solid hsl(var(--card));
}

.row-text {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.row-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-name--plain {
  color: hsl(var(--foreground) / 0.8);
}

.row-activity {
  font-size: 0.68rem;
  color: hsl(var(--muted-foreground));
}
</style>
