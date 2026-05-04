<template>
  <div v-if="reactions.length" class="reactions-row">
    <button
      v-for="r in reactions"
      :key="r.emoji"
      class="reaction-pill"
      :class="{
        'reaction-pill--mine': isMine(r),
        'reaction-pill--disabled': !canReact,
      }"
      :disabled="!canReact"
      @click="$emit('toggle', r.emoji)"
    >
      <span class="reaction-pill__emoji">
        <EmojiSprite
          v-if="resolveEmoji(r.emoji)"
          :emoji="resolveEmoji(r.emoji)!"
          :size="18"
          render-mode="noto"
        />
        <template v-else>{{ r.emoji }}</template>
      </span>
      <span class="reaction-pill__count">{{ r.count }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ReactionInfo } from "@argon/glue";
import { EmojiSprite, emojiRegistry, stringToCodepoints, codepointsToHexcode } from "@argon-chat/emojix";
import type { EmojiEntry } from "@argon-chat/emojix";

const props = defineProps<{
  reactions: ReactionInfo[];
  currentUserId: string;
  canReact: boolean;
}>();

defineEmits<{
  (e: "toggle", emoji: string): void;
}>();

function isMine(r: ReactionInfo): boolean {
  return r.userIds?.includes(props.currentUserId) ?? false;
}

function resolveEmoji(text: string): EmojiEntry | undefined {
  const codepoints = stringToCodepoints(text);
  const hexcode = codepointsToHexcode(codepoints);
  return emojiRegistry.getByHexcode(hexcode);
}
</script>

<style scoped>
.reactions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  /* Isolate stacking context so reactions never bleed into other messages */
  isolation: isolate;
  position: relative;
  z-index: 0;
}

.reaction-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: 14px;
  border: 1px solid hsl(var(--border) / 0.4);
  background: hsl(var(--muted) / 0.5);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.15s, border-color 0.15s, transform 0.1s;
}

.reaction-pill:hover:not(:disabled) {
  background: hsl(var(--muted) / 0.8);
  border-color: hsl(var(--border) / 0.7);
}

.reaction-pill:active:not(:disabled) {
  transform: scale(0.95);
}

.reaction-pill--mine {
  background: hsl(var(--primary) / 0.12);
  border-color: hsl(var(--primary) / 0.4);
}

.reaction-pill--mine:hover:not(:disabled) {
  background: hsl(var(--primary) / 0.2);
  border-color: hsl(var(--primary) / 0.6);
}

.reaction-pill--disabled {
  opacity: 0.7;
  cursor: default;
}

.reaction-pill__emoji {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 14px;
  line-height: 1;
}

.reaction-pill__count {
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  color: hsl(var(--foreground) / 0.75);
  min-width: 8px;
  text-align: center;
}

.reaction-pill--mine .reaction-pill__count {
  color: hsl(var(--primary));
}
</style>
