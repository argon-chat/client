<script setup lang="ts">
import "./customEmoji.css";
import { computed, inject, ref, watch } from "vue";
import { decodeOutline } from "@/lib/expressions/outline";
import { ExpressionFormat, type ExpressionMedia } from "@/lib/expressions/types";
import { CUSTOM_EMOJI_GROUP } from "@/lib/expressions/customEmojiRegistry";
import { cdnUrl } from "@/store/system/fileStorage";
import { isSk } from "@/lib/sk";
import { useSkStickerPlay, SK_EMOJI_PLAY } from "./useSkStickerPlay";

/**
 * A custom emoji's placeholder in text. It holds only the outline; a `CustomEmojiOverlay` around it
 * fills it in (an image, a video canvas, or a Lottie frame drawn over it).
 *
 * Skathi: the placeholder fills itself with a `<sk-sticker>`, whatever the format, tinted with the
 * text colour when the emoji asks for it. The overlay around it only gives the play mode of its group
 * (Skathi client-gap.md §4, "stickers").
 */
const props = defineProps<{
  media: ExpressionMedia;
  /** CSS px; default: the text's font size + 4. */
  size?: number;
  alt?: string;
}>();

const outline = computed(() => (props.media.outline?.length ? decodeOutline(props.media.outline) : null));
const px = computed(() => (props.size ? Math.round(props.size) : undefined));
const style = computed(() => (px.value ? { "--ce-size": `${px.value}px` } : undefined));

// Skathi: drawn here rather than by the overlay.
const skMode = isSk
  ? (inject(SK_EMOJI_PLAY, null) ??
    useSkStickerPlay({ group: () => CUSTOM_EMOJI_GROUP, autoplay: () => undefined }).mode)
  : null;
const skKind = computed(() =>
  props.media.format === ExpressionFormat.Lottie ? "lottie" : props.media.format === ExpressionFormat.Video ? "video" : "image",
);
const skReady = ref(false);
const skFailed = ref(false);
watch(
  () => props.media.fileId,
  () => {
    skReady.value = false;
    skFailed.value = false;
  },
);
const skThumb = computed(() => (skFailed.value && props.media.thumbFileId ? cdnUrl(props.media.thumbFileId) : null));
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
    :data-ce-size="px"
    :style="style"
  >
    <svg v-if="outline && !skReady" class="ce-outline" viewBox="0 0 512 512" aria-hidden="true"><path :d="outline" /></svg>
    <template v-if="skMode">
      <sk-sticker
        v-if="!skFailed"
        class="ce-img"
        :src="cdnUrl(media.fileId)"
        :kind="skKind"
        :tint="media.textColor ? '' : undefined"
        :play="skMode"
        @load="skReady = true"
        @error="skFailed = true"
      />
      <!-- As the overlay's fallback does: the thumbnail stands in (tinted too, where the browser's is
           a CSS mask), and the outline goes once it shows. -->
      <sk-sticker
        v-else-if="skThumb && media.textColor"
        class="ce-img"
        :src="skThumb"
        kind="image"
        tint=""
        @load="skReady = true"
      />
      <img v-else-if="skThumb" class="ce-img" :src="skThumb" alt="" draggable="false" @load="skReady = true" />
    </template>
  </span>
</template>
