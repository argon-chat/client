<template>
    <ExpressionInfoPopover v-model:open="infoOpen" :target="target" :media="media">
        <span
            class="ce-trigger"
            role="button"
            tabindex="0"
            :aria-label="alt"
            @keydown.enter.prevent="infoOpen = !infoOpen"
            @keydown.space.prevent="infoOpen = !infoOpen"
        >
            <CustomEmojiInline ref="inline" :media="media" :size="size" :alt="alt" :title="alt" />
        </span>
    </ExpressionInfoPopover>
</template>
<script setup lang="ts" generic="T extends MessageEntityCustomEmoji">
import { computed, inject, onMounted, ref, type ComponentPublicInstance } from "vue";
import type { MessageEntityCustomEmoji } from "@argon/glue";
import CustomEmojiInline from "@/components/expressions/CustomEmojiInline.vue";
import ExpressionInfoPopover from "@/components/expressions/ExpressionInfoPopover.vue";
import { useExpressionResolver } from "@/lib/expressions/resolver";
import { customEmojiSize } from "@/lib/expressions/sizes";
import type { ExpressionInfoTarget } from "@/lib/expressions/expressionInfo";
import { customEmojiAlt, customEmojiMedia } from "@/lib/chat/customEmoji";
import { CUSTOM_EMOJI_SIZE } from "./customEmojiSize";

/**
 * A custom emoji in a message. The CustomEmojiOverlay around the message text draws it; a click (or
 * Enter / Space) opens where it comes from.
 */
const props = defineProps<{
  entity: T;
  text: string;
}>();

const resolver = useExpressionResolver();
const given = inject(CUSTOM_EMOJI_SIZE, null);
const inline = ref<ComponentPublicInstance | null>(null);
const fontPx = ref(0);
const infoOpen = ref(false);

const media = computed(() => customEmojiMedia(props.entity, resolver.itemById(props.entity.itemId)));
const alt = computed(() => customEmojiAlt(props.entity.name));
const size = computed(() => given?.value ?? (fontPx.value ? customEmojiSize(fontPx.value) : undefined));
const target = computed<ExpressionInfoTarget>(() => ({
  kind: "emoji",
  itemId: props.entity.itemId,
  spaceId: props.entity.spaceId,
  name: props.entity.name,
}));

onMounted(() => {
  if (given?.value) return;
  const el = inline.value?.$el as HTMLElement | undefined;
  if (el?.parentElement) fontPx.value = parseFloat(getComputedStyle(el.parentElement).fontSize) || 0;
});
</script>

<style scoped>
.ce-trigger {
    cursor: pointer;
    border-radius: 4px;
    outline: none;
}

.ce-trigger:focus-visible {
    box-shadow: 0 0 0 2px hsl(var(--ring));
}
</style>
