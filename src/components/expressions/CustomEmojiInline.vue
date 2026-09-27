<script setup lang="ts">
import "./customEmoji.css";
import { computed } from "vue";
import { decodeOutline } from "@/lib/expressions/outline";
import type { ExpressionMedia } from "@/lib/expressions/types";

/**
 * A custom emoji's placeholder in text. It holds only the outline; a `CustomEmojiOverlay` around it
 * fills it in (an image, a video canvas, or a Lottie frame drawn over it).
 */
const props = defineProps<{
  media: ExpressionMedia;
  /** CSS px; default: the text's font size + 4. */
  size?: number;
  alt?: string;
}>();

const outline = computed(() => (props.media.outline?.length ? decodeOutline(props.media.outline) : null));
const style = computed(() => (props.size ? { "--ce-size": `${Math.round(props.size)}px` } : undefined));
</script>

<template>
  <span
    class="ce"
    role="img"
    :aria-label="alt"
    :data-ce-file="media.fileId"
    :data-ce-format="media.format"
    :data-ce-text-color="media.textColor ? '' : undefined"
    :data-ce-thumb="media.thumbFileId || undefined"
    :style="style"
  >
    <svg v-if="outline" class="ce-outline" viewBox="0 0 512 512" aria-hidden="true"><path :d="outline" /></svg>
  </span>
</template>
