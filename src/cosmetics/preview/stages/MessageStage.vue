<script setup lang="ts">
import type { ArgonUserProfile } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import CosmeticNickname from "@/cosmetics/CosmeticNickname.vue";
import { PREVIEW_USER_ID } from "@/cosmetics/preview/previewProfile";

/**
 * A name at the head of a message, on the surface that gets read rather than looked at.
 *
 * <b>The one place a cosmetic has to stay out of the way.</b> Everything else here is somebody's
 * words; a treatment that pulls the eye off them on a card is a nuisance, and in a conversation it
 * is a reason to turn cosmetics off. So the stage puts a real line of text under the name and a
 * plain message beside it, which is the comparison that decides it.
 */
withDefaults(
  defineProps<{
    profile: ArgonUserProfile | null;
    displayName: string;
    avatarFileId: string | null;

    /** Whose line it is. The preview default stands in when no real wearer is named. */
    userId?: string;

    /**
     * How wide the transcript is.
     *
     * Said by the host rather than fixed here: this is the widest of the small stages, so in a
     * column beside something else it is the one deciding how much room that column takes — and
     * the room it leaves is the list the dialog exists for.
     */
    width?: number;
  }>(),
  { userId: PREVIEW_USER_ID, width: 340 },
);

const ROLE_COLOR = "#7c9cf5";
</script>

<template>
  <div class="chat" :style="{ width: `${width}px` }">
    <div class="chat-message">
      <ArgonAvatar
        class="chat-avatar"
        :profile="profile"
        :user-id="userId"
        :file-id="avatarFileId"
        :fallback="displayName"
        :overrided-size="36"
      />

      <div class="chat-body">
        <div class="chat-head">
          <!--
            The role colour goes in as the fallback, exactly as the real message list hands it over:
            it is what gets painted when nothing is worn, and never over the top of what is.
          -->
          <CosmeticNickname
            class="chat-name"
            surface="nicknameInMessages"
            :profile="profile"
            :fallback-color="ROLE_COLOR"
          >
            {{ displayName }}
          </CosmeticNickname>
          <!-- No badges here on purpose: the real message list draws none, and a preview that -->
          <!-- added them would be showing the operator a place their badge never appears. -->
          <span class="chat-time">12:07</span>
        </div>
        <p class="chat-text">so is it shipping today or are we pretending again</p>
      </div>
    </div>

    <div class="chat-message chat-message--plain">
      <span class="chat-face">C</span>
      <div class="chat-body">
        <div class="chat-head">
          <span class="chat-name" :style="{ color: ROLE_COLOR }">Casper</span>
          <span class="chat-time">12:08</span>
        </div>
        <p class="chat-text">shipping. probably.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat {
  padding: 10px;
  border-radius: 12px;
  background: hsl(var(--card) / 0.6);
  border: 1px solid hsl(var(--border) / 0.4);
}

.chat-message {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px;
  border-radius: 8px;
}

.chat-message--plain {
  opacity: 0.5;
}

.chat-avatar {
  flex-shrink: 0;
}

.chat-face {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 0.78rem;
  font-weight: 600;
}

.chat-body {
  min-width: 0;
}

.chat-head {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1;
  margin-bottom: 3px;
}

.chat-name {
  font-size: 0.82rem;
  font-weight: 600;
}

.chat-time {
  font-size: 0.62rem;
  color: hsl(var(--muted-foreground));
}

.chat-text {
  margin: 0;
  font-size: 0.8rem;
  color: hsl(var(--foreground) / 0.85);
  line-height: 1.35;
}
</style>
