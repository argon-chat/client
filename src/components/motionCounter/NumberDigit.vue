<script setup lang="ts">
import { motion, useTransform } from "motion-v";
import type { MotionValue } from "motion-v";

interface Props {
    mv: MotionValue<number>;
    number: number;
    height: number;
}

const props = defineProps<Props>();

const y = useTransform(props.mv, latest => {
    const placeValue = latest % 10;
    const offset = (10 + props.number - placeValue) % 10;
    let memo = offset * props.height;

    if (offset > 5) {
        memo -= 10 * props.height;
    }

    return memo;
});

const baseStyle = {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
} as const;
</script>

<template>
    <motion.span :style="{ ...baseStyle, y }">
        {{ props.number }}
    </motion.span>
</template>
