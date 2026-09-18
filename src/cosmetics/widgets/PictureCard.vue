<script setup lang="ts">
import { computed } from "vue";
import { IconPhoto } from "@tabler/icons-vue";
import { reduceMotion } from "@/composables/useReducedMotion";
import { cdnUrl } from "@/store/system/fileStorage";
import type { PictureContent } from "@/cosmetics/kinds/widget-picture";
import type { ResolvedCosmetic } from "@/cosmetics/types";

/**
 * Somebody's picture, filling the cell they gave it.
 *
 * The card is the picture: no padding of its own, no frame inside a frame. A caption sits over the
 * foot of it rather than under it, because a strip of text below would make the picture shorter
 * than the space its owner set aside for it.
 */
const props = defineProps<{ item: ResolvedCosmetic }>();

const content = computed(() => props.item.content as PictureContent | null);

const src = computed(() => {
  const fileId = content.value?.fileId;

  return fileId ? cdnUrl(fileId) : null;
});

const moving = computed(() => content.value?.kind === "video");
</script>

<template>
  <div class="picture-card">
    <!--
      Muted and inline, and it loops: a card is decoration on somebody's profile, not something that
      asked to be played. Whether it runs at all is the viewer's, through prefers-reduced-motion.
    -->
    <video
      v-if="src && moving"
      :src="src"
      class="picture-image"
      :style="{ objectFit: content?.fit ?? 'cover' }"
      :autoplay="!reduceMotion"
      loop
      muted
      playsinline
    />

    <img
      v-else-if="src"
      :src="src"
      class="picture-image"
      :style="{ objectFit: content?.fit ?? 'cover' }"
      alt=""
      draggable="false"
      loading="lazy"
    />

    <!-- An empty card still says what it is for, or it reads as something that failed to load. -->
    <div v-else class="picture-empty">
      <IconPhoto class="w-5 h-5" />
    </div>

    <div v-if="content?.caption" class="picture-caption">{{ content.caption }}</div>
  </div>
</template>

<style scoped>
.picture-card {
  position: relative;
  flex: 1;
  min-height: 0;

  /* Cancels the padding the board puts on a card: this one's content goes to its edges. */
  margin: -9px -11px;
  border-radius: inherit;
  overflow: hidden;
}

.picture-image {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
}

.picture-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: hsl(var(--muted-foreground) / 0.5);
}

.picture-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 10px 7px;
  font-size: 0.72rem;
  font-weight: 500;
  color: #fff;
  background: linear-gradient(transparent, hsl(0 0% 0% / 0.62));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
