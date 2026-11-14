<script setup lang="ts">
import "./customEmoji.css";
import { provide, ref } from "vue";
import { CUSTOM_EMOJI_GROUP } from "@/lib/expressions/customEmojiRegistry";
import { isSk } from "@/lib/sk";
import { useCustomEmojiOverlay } from "./useCustomEmojiOverlay";
import { useSkStickerPlay, SK_EMOJI_PLAY } from "./useSkStickerPlay";

/**
 * Wraps a block of text holding custom emoji placeholders (`CustomEmojiInline`, or the same markup
 * rendered elsewhere) and draws the animated ones on one canvas laid over it.
 *
 * Skathi: each placeholder draws itself with a `<sk-sticker>`; the overlay only gives them the play
 * mode of its group. There is no canvas, and nothing to rescan or redraw.
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

const overlay = isSk
  ? null
  : useCustomEmojiOverlay(container, canvas, {
      group: props.group,
      resolveUrl: props.resolveUrl,
      resolveFetchUrl: props.resolveFetchUrl,
    });
if (isSk) {
  provide(
    SK_EMOJI_PLAY,
    useSkStickerPlay({ group: () => props.group ?? CUSTOM_EMOJI_GROUP, autoplay: () => undefined }).mode,
  );
}

const none = { placeholders: 0, lottie: 0, video: 0, static: 0, visibleLottie: 0 };
defineExpose({
  rescan: overlay ? overlay.rescan : () => {},
  redraw: overlay ? overlay.redraw : () => {},
  stats: overlay ? overlay.stats : () => none,
  canvas,
});
</script>

<template>
  <component :is="tag" ref="container" class="ce-container">
    <slot />
    <canvas v-if="!isSk" ref="canvas" class="ce-overlay" aria-hidden="true" />
  </component>
</template>
