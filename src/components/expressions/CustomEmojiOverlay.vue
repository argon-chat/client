<script setup lang="ts">
import "./customEmoji.css";
import { ref } from "vue";
import { useCustomEmojiOverlay } from "./useCustomEmojiOverlay";

/**
 * Wraps a block of text holding custom emoji placeholders (`CustomEmojiInline`, or the same markup
 * rendered elsewhere) and draws the animated ones on one canvas laid over it.
 */
const props = withDefaults(
  defineProps<{
    tag?: string;
    group?: string;
    resolveUrl?: (fileId: string) => string;
    resolveFetchUrl?: (fileId: string) => string | null;
  }>(),
  { tag: "div" },
);

const container = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

const overlay = useCustomEmojiOverlay(container, canvas, {
  group: props.group,
  resolveUrl: props.resolveUrl,
  resolveFetchUrl: props.resolveFetchUrl,
});

defineExpose({ rescan: overlay.rescan, redraw: overlay.redraw, stats: overlay.stats, canvas });
</script>

<template>
  <component :is="tag" ref="container" class="ce-container">
    <slot />
    <canvas ref="canvas" class="ce-overlay" aria-hidden="true" />
  </component>
</template>
