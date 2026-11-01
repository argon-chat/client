<script setup lang="ts">
import "./customEmoji.css";
import { computed, inject, ref, watch } from "vue";
import { decodeOutline } from "@/lib/expressions/outline";
import { ExpressionFormat, type ExpressionMedia } from "@/lib/expressions/types";
import { CUSTOM_EMOJI_GROUP } from "@/lib/expressions/customEmojiRegistry";
import { cdnUrl } from "@/store/system/fileStorage";
import { isVn } from "@/lib/vn";
import { useVnStickerPlay, VN_EMOJI_PLAY } from "./useVnStickerPlay";

/**
 * A custom emoji's placeholder in text. It holds only the outline; a `CustomEmojiOverlay` around it
 * fills it in (an image, a video canvas, or a Lottie frame drawn over it).
 *
 * vue-native: the placeholder fills itself with a `<vn-sticker>`, whatever the format, tinted with the
 * text colour when the emoji asks for it. The overlay around it only gives the play mode of its group
 * (vue-native client-gap.md §4, "stickers").
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

// vue-native: drawn here rather than by the overlay.
const vnMode = isVn
  ? (inject(VN_EMOJI_PLAY, null) ??
    useVnStickerPlay({ group: () => CUSTOM_EMOJI_GROUP, autoplay: () => undefined }).mode)
  : null;
const vnKind = computed(() =>
  props.media.format === ExpressionFormat.Lottie ? "lottie" : props.media.format === ExpressionFormat.Video ? "video" : "image",
);
const vnReady = ref(false);
const vnFailed = ref(false);
watch(
  () => props.media.fileId,
  () => {
    vnReady.value = false;
    vnFailed.value = false;
  },
);
const vnThumb = computed(() => (vnFailed.value && props.media.thumbFileId ? cdnUrl(props.media.thumbFileId) : null));
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
    <svg v-if="outline && !vnReady" class="ce-outline" viewBox="0 0 512 512" aria-hidden="true"><path :d="outline" /></svg>
    <template v-if="vnMode">
      <vn-sticker
        v-if="!vnFailed"
        class="ce-img"
        :src="cdnUrl(media.fileId)"
        :kind="vnKind"
        :tint="media.textColor ? '' : undefined"
        :play="vnMode"
        @load="vnReady = true"
        @error="vnFailed = true"
      />
      <!-- As the overlay's fallback does: the thumbnail stands in (tinted too, where the browser's is
           a CSS mask), and the outline goes once it shows. -->
      <vn-sticker
        v-else-if="vnThumb && media.textColor"
        class="ce-img"
        :src="vnThumb"
        kind="image"
        tint=""
        @load="vnReady = true"
      />
      <img v-else-if="vnThumb" class="ce-img" :src="vnThumb" alt="" draggable="false" @load="vnReady = true" />
    </template>
  </span>
</template>
