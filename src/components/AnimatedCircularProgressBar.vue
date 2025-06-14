<template>
    <div class="progress-circle-base" :class="cn('relative size-40', props.class)">
        <svg fill="none" class="size-full animate-spin" stroke-width="2" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" :stroke-width="circleStrokeWidth" stroke-linecap="round"
                stroke-linejoin="round" class="gauge-secondary-stroke opacity-100" />
            <path :stroke-width="circleStrokeWidth" stroke-linecap="round" stroke-linejoin="round" stroke="currentColor"
                class="gauge-primary-stroke" d="M50,5
             a45,45 0 1,1 0,90
             a45,45 0 1,1 0,-90" />
        </svg>
    </div>
</template>

<script setup lang="ts">
import { cn } from "@/lib/utils";

interface Props {
  gaugePrimaryColor?: string;
  gaugeSecondaryColor?: string;
  class?: string;
  circleStrokeWidth?: number;
}

const props = withDefaults(defineProps<Props>(), {
  gaugePrimaryColor: "rgb(79 70 229)", // indigo-600
  gaugeSecondaryColor: "rgba(0, 0, 0, 0.1)",
  circleStrokeWidth: 10,
});
</script>

<style scoped lang="css">
.progress-circle-base {
    --circle-size: 100px;
    transform: translateZ(0);
}

.progress-circle-base {
  --circle-size: 100px;
  --gap-percent: 5;
  --offset-factor: 0;
  --transition-step: 200ms;
  --percent-to-deg: 3.6deg;
  transform: translateZ(0);
}
.gauge-primary-stroke {
  stroke: v-bind(gaugePrimaryColor);
  --stroke-percent: 15;
  stroke-dasharray: calc(var(--stroke-percent) * var(--percent-to-px)) var(--circumference);
  transition:
  3.0s ease,
    stroke 3.0s ease;
  transition-property: stroke-dasharray, transform;
  transform: rotate(
    calc(-90deg + var(--gap-percent) * var(--offset-factor) * var(--percent-to-deg))
  );
  transform-origin: calc(var(--circle-size) / 2) calc(var(--circle-size) / 2);
}
.gauge-secondary-stroke {
  stroke: v-bind(gaugeSecondaryColor);
  --stroke-percent: 90 - 15;
  --offset-factor-secondary: calc(1 - var(--offset-factor));
  stroke-dasharray: calc(var(--stroke-percent) * var(--percent-to-px)) var(--circumference);
  transform: rotate(
      calc(
        1turn - 90deg -
          (var(--gap-percent) * var(--percent-to-deg) * var(--offset-factor-secondary))
      )
    )
    scaleY(-1);
  transition: all 3.0s ease;
  transform-origin: calc(var(--circle-size) / 2) calc(var(--circle-size) / 2);
}
</style>