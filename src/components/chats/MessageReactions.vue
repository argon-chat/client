<template>
  <div v-if="reactions && reactions.length > 0" class="flex flex-wrap gap-1 mt-1">
    <button
      v-for="reaction in reactions"
      :key="reaction.emoji"
      class="inline-flex items-center gap-1 py-0.5 px-2 rounded-full border text-[13px] leading-snug select-none transition-colors"
      :class="[
        isMine(reaction)
          ? 'bg-primary/15 border-primary/40 hover:bg-primary/25 hover:border-primary/60'
          : 'bg-muted/50 border-border/40 hover:bg-muted/80 hover:border-border/60',
        !canReact && 'opacity-70 !cursor-default',
      ]"
      :disabled="!canReact"
      @click="$emit('toggle', reaction.emoji)"
    >
      <span class="text-sm leading-none"><EmojiSprite v-if="resolveEmoji(reaction.emoji)" :emoji="resolveEmoji(reaction.emoji)!" :size="16" render-mode="noto" /><template v-else>{{ reaction.emoji }}</template></span>
      <span v-if="reaction.count > 3" class="text-xs font-medium min-w-[8px] text-center">
        {{ reaction.count }}
      </span>
      <span
        v-else
        class="relative inline-flex h-4 shrink-0"
        :style="{ width: avatarStackWidth(reaction.userIds.length) + 'px' }"
      >
        <ArgonAvatar
          v-for="(uid, i) in reaction.userIds.slice(0, 3)"
          :key="uid"
          :userId="uid"
          :overrided-size="14"
          class="absolute top-0 w-4 h-4 rounded-full border-[1.5px] border-card box-content"
          :style="{ left: i * 10 + 'px', zIndex: 3 - i }"
        />
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ReactionInfo } from "@argon/glue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
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

function isMine(reaction: ReactionInfo): boolean {
  return reaction.userIds?.includes(props.currentUserId) ?? false;
}

function avatarStackWidth(count: number): number {
  const n = Math.min(count, 3);
  return n > 0 ? 16 + (n - 1) * 10 : 0;
}

function resolveEmoji(text: string): EmojiEntry | undefined {
  const codepoints = stringToCodepoints(text);
  const hexcode = codepointsToHexcode(codepoints);
  return emojiRegistry.getByHexcode(hexcode);
}
</script>
