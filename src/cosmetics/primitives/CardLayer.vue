<script setup lang="ts">
import { computed } from "vue";
import { reduceMotion } from "@/composables/useReducedMotion";
import { cdnUrl } from "@/store/system/fileStorage";
import type { CardLayerPayload } from "@/cosmetics/kinds/profile-effect";
import type { ResolvedCosmetic } from "@/cosmetics/types";

/**
 * A picture laid over a whole profile card: the frame around it, or the weather across it.
 *
 * <b>Filling the card, not fitted inside it.</b> An avatar's ornament is sized against the thing it
 * decorates and centred on it; a frame's corners have to land on the card's corners whatever width
 * the card happens to be — a popover and a settings preview are different sizes — so this stretches
 * by default and crops only when asked.
 *
 * It never takes a click. Everything underneath is somebody's name, their words and the buttons on
 * their card, and a layer over all of that which swallowed a press would make the card unusable.
 */
const props = defineProps<{ item: ResolvedCosmetic }>();

const payload = computed(() => props.item.payload as Partial<CardLayerPayload>);

const src = computed(() => {
  const fileId = props.item.assets.Primary;

  return fileId ? cdnUrl(fileId) : null;
});

const style = computed(() => ({
  objectFit: payload.value.fit === "cover" ? "cover" as const : "fill" as const,
  opacity: String(payload.value.opacity ?? 1),

  // An effect that moves is still a picture: stopping it means showing its first frame, which is
  // what an animated SVG does when animations are off.
  animationPlayState: reduceMotion.value ? "paused" : "running",
}));
</script>

<template>
  <img
    v-if="src"
    class="cosmetic-card-layer"
    :src="src"
    :style="style"
    alt=""
    aria-hidden="true"
    draggable="false"
    loading="lazy"
  />
</template>

<style scoped>
.cosmetic-card-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;

  /*
   * Above the card's own contents.
   *
   * The host renders a fragment, so a class the surface is given never reaches this element and the
   * lift cannot be asked for from outside — without it the layer paints in document order and every
   * opaque thing after it in the card covers it, which looked like a frame drawn only around the
   * top of the card.
   */
  z-index: 4;

  /* The base stylesheet clamps images to their container's width, which for a stretched layer is the
     one thing that must not happen at a size larger than the art. */
  max-width: none;
  max-height: none;

  border-radius: inherit;
  pointer-events: none;
  user-select: none;
}
</style>
