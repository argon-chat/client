<template>
    <CustomEmojiInline ref="inline" :media="media" :size="size" :alt="alt" :title="alt" />
</template>
<script setup lang="ts" generic="T extends MessageEntityCustomEmoji">
import { computed, inject, onMounted, ref, type ComponentPublicInstance } from "vue";
import type { MessageEntityCustomEmoji } from "@argon/glue";
import CustomEmojiInline from "@/components/expressions/CustomEmojiInline.vue";
import { useExpressionResolver } from "@/lib/expressions/resolver";
import { customEmojiSize } from "@/lib/expressions/sizes";
import { customEmojiAlt, customEmojiMedia } from "@/lib/chat/customEmoji";
import { CUSTOM_EMOJI_SIZE } from "./customEmojiSize";

/** A custom emoji in a message. The CustomEmojiOverlay around the message text draws it. */
const props = defineProps<{
  entity: T;
  text: string;
}>();

const resolver = useExpressionResolver();
const given = inject(CUSTOM_EMOJI_SIZE, null);
const inline = ref<ComponentPublicInstance | null>(null);
const fontPx = ref(0);

const media = computed(() => customEmojiMedia(props.entity, resolver.itemById(props.entity.itemId)));
const alt = computed(() => customEmojiAlt(props.entity.name));
const size = computed(() => given?.value ?? (fontPx.value ? customEmojiSize(fontPx.value) : undefined));

onMounted(() => {
  if (given?.value) return;
  const el = inline.value?.$el as HTMLElement | undefined;
  if (el?.parentElement) fontPx.value = parseFloat(getComputedStyle(el.parentElement).fontSize) || 0;
});
</script>
