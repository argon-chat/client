<script setup lang="ts">
import { computed } from "vue";
import { cdnUrl } from "@/store/system/fileStorage";
import type { AvatarDecorationPayload } from "@/cosmetics/kinds/avatar-decoration";
import type { ResolvedCosmetic } from "@/cosmetics/types";

const props = defineProps<{ item: ResolvedCosmetic }>();

const payload = computed(() => props.item.payload as Partial<AvatarDecorationPayload>);

const src = computed(() => {
  const fileId = props.item.assets.Primary;
  return fileId ? cdnUrl(fileId) : null;
});

/**
 * Centred on the avatar and sized from the inset, rather than positioned by one.
 *
 * <b>Insets do not size a replaced element.</b> An <c>&lt;img&gt;</c> with <c>width: auto</c> takes
 * its own intrinsic width, and the box is then over-constrained, so the browser keeps top and left
 * and throws right and bottom away — the decoration landed up and to the left of the avatar at
 * whatever size the file happened to be. Giving it a width makes the file's own dimensions
 * irrelevant, which is what a frame needs: it is a ring around something, not a picture at a size.
 */
const style = computed(() => {
  const inset = payload.value.insetPct ?? 0;
  const size = `calc(100% + ${inset * 2}%)`;

  return {
    width: size,
    height: size,
    zIndex: payload.value.beneath === true ? 0 : 2,
  };
});
</script>

<template>
  <img
    v-if="src"
    class="cosmetic-image-layer"
    :src="src"
    :style="style"
    alt=""
    aria-hidden="true"
    draggable="false"
    loading="lazy"
  />
</template>

<style scoped>
.cosmetic-image-layer {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);

  /*
   * A decoration is meant to be bigger than what it decorates, and the base stylesheet's
   * max-width on images clamped exactly that away: the height grew past the avatar and the width
   * did not, so the ring came out an oval.
   */
  max-width: none;
  max-height: none;

  object-fit: contain;
  pointer-events: none;
  user-select: none;
}
</style>
