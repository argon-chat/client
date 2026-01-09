<template>
    <MotionConfig :transition="{
        duration: 0.7,
        type: 'spring',
        bounce: 0.5,
    }">
        <div :class="cn(
            'fixed top-5 -translate-x-1/2 left-1/2 z-[999] backdrop-blur-lg border-radius',
            'rainbow-button',
            'rounded-xl border-0 bg-[length:200%] font-medium text-primary-foreground transition-colors [background-clip:padding-box,border-box,border-box] [background-origin:border-box] [border:calc(0.08*1rem)_solid_transparent] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
            'before:absolute before:bottom-[-20%] before:left-1/2 before:z-0 before:h-1/5 before:w-3/5 before:-translate-x-1/2 before:bg-[linear-gradient(90deg,var(--color-1),var(--color-5),var(--color-3),var(--color-4),var(--color-2))] before:bg-[length:200%] before:[filter:blur(calc(0.8*1rem))]',
            'bg-[linear-gradient(#121213,#121213),linear-gradient(#121213_50%,rgba(18,18,19,0.6)_80%,rgba(18,18,19,0)),linear-gradient(90deg,var(--color-1),var(--color-5),var(--color-3),var(--color-4),var(--color-2))]',
            props.class,
            $props.class,
        )
            " @click="() => (open = !open)">
            <motion.div id="motion-id" layout :initial="{
                height: props.height,
                width: 0,
            }" :animate="{
                height: open && isSlotAvailable ? 'auto' : props.height,
                width: open && isSlotAvailable ? 320 : 260,
            }" class="bg-natural-900 relative cursor-pointer overflow-hidden text-secondary">
                <header class="gray- flex h-11 cursor-pointer items-center gap-2 px-4">
                    <VueSpinnerRadio size="20" color="wheat" />
                    <h1 class="grow text-center font-bold" style="color: wheat;">{{ titleRef }}</h1>
                </header>
                <motion.div v-if="isSlotAvailable"
                    class="mb-2 flex h-full max-h-60 flex-col gap-1 overflow-y-auto px-4 text-sm">
                    <slot />
                </motion.div>
            </motion.div>
        </div>
    </MotionConfig>
</template>

<script lang="ts" setup>
import delay from "@/lib/delay";
import { cn } from "@argon/core";
import { useColorMode } from "@vueuse/core";
import { motion, MotionConfig } from "motion-v";
import { computed, onMounted, onUnmounted, ref, useSlots } from "vue";
import { VueSpinnerRadio } from "vue3-spinners";

interface Props {
  class?: string;
  title?: string;
  height?: number;
  speed?: number;
}

const props = withDefaults(defineProps<Props>(), {
  class: "",
  title: "Progress",
  height: 44,
  speed: 2,
});
const speedInSeconds = computed(() => `${props.speed}s`);
const open = ref(false);
const slots = useSlots();
const titleRef = ref(props.title);

const isDark = computed(() => useColorMode().value === "dark");
const isSlotAvailable = computed(() => !!slots.default);
const borderRadius = computed(() => `${props.height / 2}px`);
</script>
<style scoped>
.border-radius {
    border-radius: v-bind(borderRadius);
}

.rainbow-button {
    --color-1: hsl(0 100% 63%);
    --color-2: hsl(270 100% 63%);
    --color-3: hsl(210 100% 63%);
    --color-4: hsl(195 100% 63%);
    --color-5: hsl(90 100% 63%);
    --speed: v-bind(speedInSeconds);
    animation: rainbow var(--speed) infinite linear;
}

.rainbow-button:before {
    animation: rainbow var(--speed) infinite linear;
}

@keyframes rainbow {
    0% {
        background-position: 0;
    }

    100% {
        background-position: 200%;
    }
}
</style>