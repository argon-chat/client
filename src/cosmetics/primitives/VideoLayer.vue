<script setup lang="ts">
import { computed } from "vue";
import { cdnUrl } from "@/store/system/fileStorage";
import { reduceMotion } from "@/composables/useReducedMotion";
import { argbToRgba } from "@/lib/profileCustomization";
import type { ProfileBackgroundPayload } from "@/cosmetics/kinds/profile-background";
import type { ResolvedCosmetic } from "@/cosmetics/types";

const props = defineProps<{ item: ResolvedCosmetic; tintColor?: number | null }>();

const payload = computed(() => props.item.payload as Partial<ProfileBackgroundPayload>);

const src = computed(() => {
  const fileId = props.item.assets.Primary;
  return fileId ? cdnUrl(fileId) : null;
});

/**
 * The still frame, used on its own when motion is off.
 *
 * Without a poster there is nothing to show a person who asked not to be shown movement, and the
 * alternative — playing it anyway — is the thing they switched off.
 */
const poster = computed(() => {
  const fileId = props.item.assets.Poster;
  return fileId ? cdnUrl(fileId) : undefined;
});

const tint = computed(() => {
  const opacity = payload.value.tintOpacity ?? 0.35;

  if (opacity <= 0 || props.tintColor === null || props.tintColor === undefined) return null;

  return { background: argbToRgba(props.tintColor), opacity: String(opacity) };
});
</script>

<template>
  <div v-if="src" class="cosmetic-video-layer" aria-hidden="true">
    <img v-if="reduceMotion" class="cosmetic-video-frame" :src="poster ?? src" alt="" draggable="false" />
    <video
      v-else
      class="cosmetic-video-frame"
      :src="src"
      :poster="poster"
      :loop="payload.loop !== false"
      autoplay
      muted
      playsinline
      preload="metadata"
      disablepictureinpicture
    />
    <div v-if="tint" class="cosmetic-video-tint" :style="tint" />
  </div>
</template>

<style scoped>
.cosmetic-video-layer {
  position: absolute;
  inset: 0;

  /* Its own, now that a host may be unclipped so a frame can draw outside it. */
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
}

.cosmetic-video-frame {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cosmetic-video-tint {
  position: absolute;
  inset: 0;
}
</style>
