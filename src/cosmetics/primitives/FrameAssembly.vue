<script setup lang="ts">
import { computed, onMounted } from "vue";
import { reduceMotion } from "@/composables/useReducedMotion";
import { cdnUrl } from "@/store/system/fileStorage";
import { installMotionKeyframes } from "@/cosmetics/frameMotion";
import { animationOf, paintOf, placementOf } from "@/cosmetics/primitives/frameGeometry";
import type { FramePart, ProfileFramePayload } from "@/cosmetics/kinds/profile-frame";
import type { ResolvedCosmetic } from "@/cosmetics/types";

/**
 * A frame around a profile card, drawn as the parts its row lists.
 *
 * <b>It renders a fragment, not a box.</b> Each part is a direct child of the card, which is what
 * lets one be positioned against the card's own edges — `bottom: 100%` means "the card's top" only
 * if there is nothing in between. A wrapper would also have to hold one z-index for parts that
 * deliberately sit on either side of the card's content.
 *
 * <b>Nothing about a frame's appearance is in this file.</b> Where each part goes, how far it hangs
 * outside, what it is painted with and how it moves are numbers in the row; this mounts them. That
 * is the point of the whole arrangement — a new frame is a row somebody creates, and this file does
 * not grow when one is added.
 */
const props = withDefaults(defineProps<{
  item: ResolvedCosmetic;

  /**
   * How big the card under this frame is, against the card it was authored for.
   *
   * A frame is drawn in pixels, so a picker tile a third of a card's width needs a frame a third as
   * thick — otherwise the band is the tile. Every measurement is multiplied by this, and 1 is the
   * real thing, which is what every surface that draws a whole profile passes.
   */
  scale?: number;
}>(), { scale: 1 });

// The keyframes every movement needs, put on the page once. Here rather than in this component's
// stylesheet because the rule that names them is an inline style, which cannot see a scoped one.
onMounted(installMotionKeyframes);

/**
 * Every part, already turned into the two style objects that draw it.
 *
 * Built once per change rather than called from the template, because a card is re-rendered
 * constantly and this arithmetic does not depend on anything that changes between those renders.
 */
const drawn = computed(() => {
  const payload = props.item.payload as ProfileFramePayload;
  const reduced = reduceMotion.value;

  return payload.parts.map((part, index) => ({
    index,
    placement: placementOf(part, props.scale),
    paint: paintWith(part, reduced),
  }));
});

function paintWith(part: FramePart, reduced: boolean) {
  const paint = paintOf(part, urlFor(part), reduced, props.scale);

  // A part with nothing to paint draws nothing. The ordinary case is an operator midway through
  // authoring: the row names a slot and the upload into it has not happened yet.
  if (paint === null) return null;

  return { ...paint, ...animationOf(part, reduced) };
}

function urlFor(part: FramePart): string | null {
  if (part.type === "ring") return null;

  const fileId = props.item.assets[part.slot];

  return fileId ? cdnUrl(fileId) : null;
}
</script>

<template>
  <div
    v-for="part in drawn"
    :key="part.index"
    class="cosmetic-frame-part"
    :style="part.placement"
    aria-hidden="true"
  >
    <div v-if="part.paint" class="cosmetic-frame-paint" :style="part.paint" />
  </div>
</template>

<style scoped>
.cosmetic-frame-part {
  /* A frame is the one cosmetic allowed outside the thing it decorates, so nothing here may clip. */
  overflow: visible;
  pointer-events: none;
  user-select: none;
}

.cosmetic-frame-paint {
  overflow: visible;
  pointer-events: none;

  /* The base stylesheet clamps things to their container's width; a band drawn deliberately outside
     one is exactly what that rule is aimed at, and exactly what must survive it. */
  max-width: none;
  max-height: none;
}
</style>

<style>
/*
 * Walking a strip of frames. Unscoped for the same reason the name treatments' keyframes are: the
 * rule that names an animation is an inline style, and an inline style cannot see a scoped one.
 *
 * Two animations rather than one because a strip is read as a grid — the columns cycle inside each
 * row and the rows step once per cycle. Both read a custom property, so one pair of rules serves
 * every strip whatever its shape; the step counts ride on the element as part of the shorthand,
 * which is the one thing `steps()` will not take from a variable.
 */
@keyframes cosmetic-frame-sprite-x {
  from { background-position-x: 0; }
  to   { background-position-x: var(--cf-sprite-x); }
}

@keyframes cosmetic-frame-sprite-y {
  from { background-position-y: 0; }
  to   { background-position-y: var(--cf-sprite-y); }
}
</style>
