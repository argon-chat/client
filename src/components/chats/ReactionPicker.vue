<template>
  <!-- The whole picker, opened from the quick row: unicode emoji and the space's own. -->
  <ExpressionPicker
    v-if="expanded"
    class="reaction-picker-full"
    mode="reaction"
    :space-id="spaceId"
    :height="360"
    :width="352"
    @select-emoji="$emit('select', $event)"
    @select-custom-emoji="$emit('select-custom', $event)"
    @close="$emit('close')"
  />
  <div v-else class="reaction-picker">
    <button
      v-for="emoji in emojis"
      :key="emoji"
      class="picker-emoji"
      @click="$emit('select', emoji)"
    >
      <EmojiSprite v-if="resolveEmoji(emoji)" :emoji="resolveEmoji(emoji)!" :size="18" render-mode="atlas" />
      <template v-else>{{ emoji }}</template>
    </button>
    <!-- Custom emoji the caller offers (recent ones, the space's): chosen through `select-custom`. -->
    <CustomEmojiOverlay v-if="customItems?.length" tag="div" class="flex gap-[2px]">
      <button
        v-for="item in customItems"
        :key="item.itemId"
        class="picker-emoji"
        :title="customEmojiAlt(item.name)"
        @click="$emit('select-custom', item)"
      >
        <CustomEmojiInline :media="itemMedia(item)" :size="18" :alt="customEmojiAlt(item.name)" />
      </button>
    </CustomEmojiOverlay>
    <button
      type="button"
      class="picker-emoji picker-more"
      data-testid="reaction-picker-more"
      :title="t('add_reaction')"
      :aria-label="t('add_reaction')"
      @click="expanded = true"
    >
      <SmilePlusIcon class="w-4 h-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { SmilePlusIcon } from "lucide-vue-next";
import type { ExpressionItem } from "@argon/glue";
import { DEFAULT_REACTIONS } from "@/composables/useMessageReactions";
import { EmojiSprite, emojiRegistry, stringToCodepoints, codepointsToHexcode } from "@argon-chat/emojix";
import type { EmojiEntry } from "@argon-chat/emojix";
import CustomEmojiInline from "@/components/expressions/CustomEmojiInline.vue";
import CustomEmojiOverlay from "@/components/expressions/CustomEmojiOverlay.vue";
import ExpressionPicker from "@/components/expressions/ExpressionPicker.vue";
import { customEmojiAlt, itemMedia } from "@/lib/chat/customEmoji";
import { useLocale } from "@/store/system/localeStore";

withDefaults(defineProps<{
  emojis?: string[];
  customItems?: ExpressionItem[];
  /** The message's space, for its custom emoji; null in a direct chat. */
  spaceId?: string | null;
}>(), {
  emojis: () => DEFAULT_REACTIONS,
  customItems: () => [],
  spaceId: null,
});

defineEmits<{
  (e: "select", emoji: string): void;
  (e: "select-custom", item: ExpressionItem): void;
  /** Esc in the full picker. */
  (e: "close"): void;
}>();

const { t } = useLocale();
const expanded = ref(false);

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

.reaction-picker-full {
  border: 1px solid hsl(var(--border) / 0.6);
  box-shadow: 0 4px 16px hsl(var(--background) / 0.5);
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

.picker-more {
  color: hsl(var(--muted-foreground));
}

.picker-more:hover {
  color: hsl(var(--foreground));
}
</style>
