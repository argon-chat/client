<template>
  <div v-if="reactions && reactions.length > 0" class="reactions-row">
    <button
      v-for="reaction in reactions"
      :key="reaction.emoji"
      class="reaction-pill"
      :class="{ 'is-mine': isMine(reaction) }"
      :disabled="!canReact"
      @click="$emit('toggle', reaction.emoji)"
    >
      <span class="reaction-emoji">{{ reaction.emoji }}</span>
      <!-- ≤3 users: stacked avatars, >3: count -->
      <span v-if="reaction.count > 3" class="reaction-count">{{ reaction.count }}</span>
      <span v-else class="reaction-avatars" :style="{ width: avatarStackWidth(reaction.userIds.length) + 'px' }">
        <ArgonAvatar
          v-for="(uid, i) in reaction.userIds.slice(0, 3)"
          :key="uid"
          :userId="uid"
          :overrided-size="16"
          class="reaction-avatar"
          :style="{ left: i * 10 + 'px', zIndex: 3 - i }"
        />
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ReactionInfo } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";

const props = defineProps<{
  reactions: ReactionInfo[];
  currentUserId: string;
  canReact: boolean;
}>();

defineEmits<{
  (e: "toggle", emoji: string): void;
}>();

function isMine(reaction: ReactionInfo): boolean {
  return reaction.userIds?.includes(props.currentUserId) ?? false;
}

function avatarStackWidth(count: number): number {
  const n = Math.min(count, 3);
  // first avatar 16px, each subsequent overlaps by 6px
  return n > 0 ? 16 + (n - 1) * 10 : 0;
}
</script>

<style scoped>
.reactions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.reaction-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--muted) / 0.5);
  color: hsl(var(--foreground));
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  user-select: none;
}

.reaction-pill:hover:not(:disabled) {
  background: hsl(var(--muted) / 0.8);
  border-color: hsl(var(--border) / 0.6);
}

.reaction-pill:disabled {
  cursor: default;
  opacity: 0.7;
}

.reaction-pill.is-mine {
  background: hsl(var(--primary) / 0.15);
  border-color: hsl(var(--primary) / 0.4);
}

.reaction-pill.is-mine:hover:not(:disabled) {
  background: hsl(var(--primary) / 0.25);
  border-color: hsl(var(--primary) / 0.6);
}

.reaction-emoji {
  font-size: 14px;
  line-height: 1;
}

.reaction-count {
  font-size: 12px;
  font-weight: 500;
  min-width: 8px;
  text-align: center;
}

.reaction-avatars {
  position: relative;
  display: inline-flex;
  height: 16px;
  flex-shrink: 0;
}

.reaction-avatar {
  position: absolute;
  top: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1.5px solid hsl(var(--card));
  box-sizing: content-box;
}
</style>
