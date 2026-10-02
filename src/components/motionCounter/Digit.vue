<!--
  One place of the counter: a strip of digits that rolls to the new one.

  The roll is a Web Animation, not a script spring. A spring writes an inline style every frame, and
  while Sentry records a replay each of those writes becomes a new CSSStyleSheet — which Firefox with
  DevTools open could not keep up with during a call. Now the style changes once per tick and the
  browser plays the roll.
-->
<script lang="ts">
// Three runs of 0–9, resting on the middle one: a roll of up to five places either way, overshoot
// included, stays on the strip.
const CELLS = Array.from({ length: 30 }, (_, i) => i % 10);
const REST = 10;

const ROLL_MS = 900;
const ROLL_EASING = springEasing();

const reducedMotionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

function mod10(n: number): number {
    return ((n % 10) + 10) % 10;
}

// motion-v's default spring (stiffness 100, damping 10, mass 1), which this used to run, sampled
// into linear(). Where linear() is missing, a back-out curve with a similar overshoot.
function springEasing(): string {
    if (typeof CSS === "undefined" || !CSS.supports("animation-timing-function", "linear(0, 1)")) {
        return "cubic-bezier(0.34, 1.56, 0.64, 1)";
    }

    const omega = 10;
    const zeta = 0.5;
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const samples = 40;
    const points: string[] = [];

    for (let i = 0; i < samples; i++) {
        const t = ((i / samples) * ROLL_MS) / 1000;
        const x = 1 - Math.exp(-zeta * omega * t) * (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t));
        points.push(x.toFixed(4));
    }

    points.push("1");

    return `linear(${points.join(", ")})`;
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CSSProperties } from "vue";
import { reduceMotion } from "@/composables/useReducedMotion";

interface Props {
    place: number;
    value: number;
    height: number;
    digitStyle?: CSSProperties;
}

const props = defineProps<Props>();

const valueRoundedToPlace = computed(() => Math.floor(props.value / props.place));
const digit = computed(() => mod10(valueRoundedToPlace.value));

const strip = ref<HTMLElement | null>(null);
let rolling: Animation | null = null;

watch(valueRoundedToPlace, (next, prev) => {
    rolling?.cancel();
    rolling = null;

    const el = strip.value;
    if (!el || reduceMotion.value || reducedMotionQuery?.matches) return;

    // The short way round, so 9 → 0 rolls on rather than back through every digit; a tie follows
    // the value, so 5 → 0 on the tens of seconds rolls back.
    let step = mod10(next - prev);
    if (step > 5 || (step === 5 && next < prev)) step -= 10;
    if (step === 0) return;

    const from = REST + mod10(prev);

    rolling = el.animate([{ transform: offset(from) }, { transform: offset(from + step) }], {
        duration: ROLL_MS,
        easing: ROLL_EASING
    });
});

function offset(cell: number): string {
    return `translateY(${-cell * props.height}px)`;
}

const wrapperStyle = computed<CSSProperties>(() => ({
    height: props.height + "px",
    position: "relative",
    width: "1ch",
    overflow: "hidden",
    fontVariantNumeric: "tabular-nums",
    ...(props.digitStyle ?? {})
}));

const cellStyle = computed<CSSProperties>(() => ({
    height: props.height + "px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
}));
</script>

<template>
    <div :style="wrapperStyle">
        <div ref="strip" :style="{ position: 'absolute', top: 0, left: 0, right: 0, transform: offset(REST + digit) }">
            <span v-for="(n, i) in CELLS" :key="i" :style="cellStyle">{{ n }}</span>
        </div>
    </div>
</template>
