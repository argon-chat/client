<script setup lang="ts">
import { computed } from "vue";
import { textEffect } from "@/cosmetics/kinds/option-text-effect";
import { mixToward } from "@/cosmetics/chips/types";
import type { CosmeticOptionChipProps } from "@/cosmetics/chips/types";

/**
 * A treatment drawn on a sample, in the colour the wearer has actually chosen — a picker showing
 * every treatment in some neutral colour would be showing something nobody is going to get.
 */
const props = defineProps<CosmeticOptionChipProps>();

const style = computed(() => {
  const effect = textEffect(props.slug);

  if (!effect) return {};

  // What the person is actually carrying, else the one colour chosen on the axis beside this one.
  const stops = props.stops && props.stops.length > 0
    ? props.stops
    : props.tint ? [props.tint] : [];

  return effect.style({
    stops,
    tint: stops[0] ?? null,
    lighten: (hex, amount) => mixToward(hex, 255, amount),
    shade: (hex, amount) => mixToward(hex, 0, amount),
    gradient: (...stops) => ({
      backgroundImage: `linear-gradient(90deg, ${stops.join(", ")})`,
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
