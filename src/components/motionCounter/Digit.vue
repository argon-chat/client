<script setup lang="ts">
import { MotionGlobalConfig, motionValue, useSpring } from "motion-v";
import { computed, watch } from "vue";
import type { CSSProperties } from "vue";
import type { MotionValue } from "motion-v";

import NumberDigit from "./NumberDigit.vue";

interface Props {
    place: number;
    value: number;
    height: number;
    digitStyle?: CSSProperties;
}

const props = defineProps<Props>();

const valueRoundedToPlace = computed(() => Math.floor(props.value / props.place));

const animatedValue: MotionValue<number> = MotionGlobalConfig.instantAnimations ?
    motionValue(valueRoundedToPlace.value) :
    useSpring(valueRoundedToPlace.value);

watch(
    () => valueRoundedToPlace.value,
    v => {
        animatedValue.set(v);
    }
);

const wrapperStyle = computed<CSSProperties>(() => ({
    height: props.height + "px",
    position: "relative",
    width: "1ch",
    fontVariantNumeric: "tabular-nums",
    ...(props.digitStyle ?? {})
}));

const digits = Array.from({ length: 10 }, (_, i) => i);
</script>

<template>
    <div :style="wrapperStyle">
        <NumberDigit v-for="n in digits" :key="n" :mv="animatedValue" :number="n" :height="height" />
    </div>
</template>
