<script setup lang="ts">
import { computed } from "vue";

import type { CosmeticOptionChipProps } from "@/cosmetics/chips/types";
import { textEffect } from "@/cosmetics/kinds/option-text-effect";
import {
  lightenColour,
  shadeColour,
} from "@/cosmetics/primitives/colourMix";

/**
 * A treatment drawn on a sample, in the colour the wearer has actually chosen — a picker showing
 * every treatment in some neutral colour would be showing something nobody is going to get.
 */
const props = defineProps<CosmeticOptionChipProps>();

const style = computed(() => {
  const effect = textEffect(props.option.slug);

  if (!effect) {
    return {};
  }

  // What the person is actually carrying, else the readable stand-in.
  let stops: readonly string[] = [];

  if (props.stops && props.stops.length > 0) {
    stops = props.stops;
  } else if (props.tint) {
    stops = [props.tint];
  }

  return effect.style({
    stops,
    tint: stops[0] ?? null,
    lighten: lightenColour,
    shade: shadeColour,
    gradient: (...laid) => ({
      backgroundImage: `linear-gradient(90deg, ${laid.join(", ")})`,
      backgroundClip: "text",
      webkitBackgroundClip: "text",
      color: "transparent",
    }),
  }) ?? {};
});
</script>

<template>
  <span class="effect-chip" :style="style">{{ sample }}</span>
</template>

<style scoped>
.effect-chip {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
}
</style>
