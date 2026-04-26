<template>
  <div class="reaction-picker">
    <button
      v-for="emoji in emojis"
      :key="emoji"
      class="picker-emoji"
      @click="$emit('select', emoji)"
    >
      <EmojiSprite v-if="resolveEmoji(emoji)" :emoji="resolveEmoji(emoji)!" :size="18" render-mode="noto" />
      <template v-else>{{ emoji }}</template>
    </button>
  </div>
</template>

<script setup lang="ts">
import { DEFAULT_REACTIONS } from "@/composables/useMessageReactions";
import { EmojiSprite, emojiRegistry, stringToCodepoints, codepointsToHexcode } from "@argon-chat/emojix";
import type { EmojiEntry } from "@argon-chat/emojix";

withDefaults(defineProps<{
  emojis?: string[];
}>(), {
  emojis: () => DEFAULT_REACTIONS,
});

defineEmits<{
  (e: "select", emoji: string): void;
}>();

function resolveEmoji(text: string): EmojiEntry | undefined {
  const codepoints = stringToCodepoints(text);
  const hexcode = codepointsToHexcode(codepoints);
  return emojiRegistry.getByHexcode(hexcode);
}
</script>

<style scoped>
.reaction-picker {
  display: flex;
  gap: 2px;
  padding: 4px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.4);
  border-radius: 10px;
  box-shadow: 0 2px 8px hsl(var(--background) / 0.4);
}

.picker-emoji {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: background 0.12s ease, transform 0.12s ease;
}

.picker-emoji:hover {
  background: hsl(var(--muted));
  transform: scale(1.15);
}

.picker-emoji:active {
  transform: scale(0.95);
}
</style>
