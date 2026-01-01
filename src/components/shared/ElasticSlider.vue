<script setup lang="ts">
import { ref, watch, computed } from "vue";
import {
    motion,
    animate,
    useMotionValue,
    useMotionValueEvent,
    useTransform
} from "motion-v";

const MAX_OVERFLOW = 50;

interface Props {
    defaultValue?: number;
    startingValue?: number;
    maxValue?: number;
    className?: string;
    isStepped?: boolean;
    stepSize?: number;
    leftIcon?: any;
    rightIcon?: any;
}

const props = withDefaults(defineProps<Props>(), {
    defaultValue: 50,
    startingValue: 0,
    maxValue: 100,
    className: "",
    isStepped: false,
    stepSize: 1,
    leftIcon: "-",
    rightIcon: "+"
});

// ---------------- Slider state ----------------

const value = ref(props.defaultValue);
watch(() => props.defaultValue, v => value.value = v);

const sliderRef = ref<HTMLElement | null>(null);
const region = ref<"left" | "middle" | "right">("middle");

const clientX = useMotionValue(0);
const overflow = useMotionValue(0);
const scale = useMotionValue(1);

// track overflow region
useMotionValueEvent(clientX, "change", latest => {
    if (!sliderRef.value) return;

    const { left, right } = sliderRef.value.getBoundingClientRect();
    let newValue = 0;

    if (latest < left) {
        region.value = "left";
        newValue = left - latest;
    } else if (latest > right) {
        region.value = "right";
        newValue = latest - right;
    } else {
        region.value = "middle";
        newValue = 0;
    }

    overflow.set(decay(newValue, MAX_OVERFLOW));
});

// handle slide move
function handlePointerMove(e: PointerEvent) {
    if (e.buttons === 0 || !sliderRef.value) return;

    const { left, width } = sliderRef.value.getBoundingClientRect();
    let newValue =
        props.startingValue +
        ((e.clientX - left) / width) * (props.maxValue - props.startingValue);

    if (props.isStepped) {
        newValue = Math.round(newValue / props.stepSize) * props.stepSize;
    }

    newValue = Math.min(Math.max(newValue, props.startingValue), props.maxValue);
    value.value = newValue;

    clientX.set(e.clientX);
}

function handlePointerDown(e: PointerEvent) {
    handlePointerMove(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerUp() {
    animate(overflow, 0, { type: "spring", bounce: 0.5 });
}

// -- transforms --
const opacity = useTransform(scale, [1, 1.2], [0.7, 1]);
const barHeight = useTransform(scale, [1, 1.2], [6, 12]);
const barMarginTop = useTransform(scale, [1, 1.2], [0, -3]);
const barMarginBottom = useTransform(scale, [1, 1.2], [0, -3]);

const leftX = useTransform(() =>
    region.value === "left" ? -overflow.get() / scale.get() : 0
);

const rightX = useTransform(() =>
    region.value === "right" ? overflow.get() / scale.get() : 0
);

const rangePercent = computed(() => {
    const total = props.maxValue - props.startingValue;
    if (total === 0) return 0;
    return ((value.value - props.startingValue) / total) * 100;
});

// dynamic bar scale / pivot
const barScaleX = useTransform(() => {
    if (!sliderRef.value) return 1;
    const { width } = sliderRef.value.getBoundingClientRect();
    return 1 + overflow.get() / width;
});

const barScaleY = useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.8]);

const barOrigin = useTransform(() => {
    if (!sliderRef.value) return "center";
    const { left, width } = sliderRef.value.getBoundingClientRect();
    return clientX.get() < left + width / 2 ? "right" : "left";
});

// --- utils ---
function decay(value: number, max: number): number {
    if (max === 0) return 0;
    const entry = value / max;
    const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
    return sigmoid * max;
}
</script>

<template>
    <div class="flex flex-col items-center justify-center gap-4 w-48" :class="props.className">
        <motion.div class="flex w-full touch-none select-none items-center justify-center gap-4"
            :style="{ scale, opacity }" @hoverstart="animate(scale, 1.2)" @hoverend="animate(scale, 1)"
            @touchstart="animate(scale, 1.2)" @touchend="animate(scale, 1)">
            <!-- LEFT ICON -->
            <motion.div :animate="{
                scale: region === 'left' ? [1, 1.4, 1] : 1,
                transition: { duration: 0.25 }
            }" :style="{ x: leftX }">
                <slot name="leftIcon">{{ props.leftIcon }}</slot>
            </motion.div>

            <!-- SLIDER BAR -->
            <div ref="sliderRef"
                class="relative flex w-full max-w-xs flex-grow cursor-grab touch-none select-none items-center py-4"
                @pointermove="handlePointerMove" @pointerdown="handlePointerDown" @pointerup="handlePointerUp">
                <motion.div class="flex flex-grow" :style="{
                    scaleX: barScaleX,
                    scaleY: barScaleY,
                    transformOrigin: barOrigin,
                    height: barHeight + 'px',
                    marginTop: barMarginTop + 'px',
                    marginBottom: barMarginBottom + 'px'
                }">
                    <div class="relative h-full flex-grow overflow-hidden rounded-full bg-gray-400">
                        <div class="absolute h-full bg-gray-500 rounded-full" :style="{ width: rangePercent + '%' }" />
                    </div>
                </motion.div>
            </div>

            <!-- RIGHT ICON -->
            <motion.div :animate="{
                scale: region === 'right' ? [1, 1.4, 1] : 1,
                transition: { duration: 0.25 }
            }" :style="{ x: rightX }">
                <slot name="rightIcon">{{ props.rightIcon }}</slot>
            </motion.div>
        </motion.div>

        <!-- VALUE -->
        <p class="absolute text-gray-400 transform -translate-y-4 text-xs font-medium tracking-wide">
            {{ Math.round(value) }}
        </p>
    </div>
</template>
