<template>
    <div class="flex flex-col items-center gap-4">
        <div class="grid grid-cols-3 gap-4">
            <div v-for="item in keys" :key="item.key" @click="handlePress(item.key)" class="w-20 h-20 rounded-full bg-white/10 hover:bg-white/20
               backdrop-blur-md border border-white/10
               flex flex-col items-center justify-center
               cursor-pointer transition select-none">

                <span class="text-3xl font-semibold text-white leading-none">
                    {{ item.key }}
                </span>
                <span v-if="item.label" class="text-xs text-gray-300 mt-1 tracking-wider">
                    {{ item.label }}
                </span>
            </div>
        </div>

        <div class="relative w-full h-24 mt-2 flex items-center justify-center">
            <div class="absolute left-0 w-16 h-16"></div>

            <button class="call-btn" :class="dialState" :disabled="dialState === 'checking' || dialState === 'error'"
                @click="$emit('call')">
                <Transition name="fade" mode="out-in">
                    <PhoneIcon v-if="dialState === 'idle'" key="idle" class="w-10 h-10" />

                    <div v-else-if="dialState === 'checking'" key="checking" class="checking">
                        <div class="dots">
                            <span></span><span></span><span></span>
                        </div>
                    </div>

                    <PhoneMissedIcon v-else-if="dialState === 'error'" key="error" class="w-10 h-10" />

                    <div v-else-if="dialState === 'ussd-running'" key="ussd-running" class="checking">
                        <div class="dots">
                            <span></span><span></span><span></span>
                        </div>
                    </div>

                    <div v-else key="ready" class="confirm">
                        <span class="price">{{ price }}</span>
                        <span class="confirm-text">CONFIRM</span>
                    </div>
                </Transition>
            </button>

            <button class="absolute right-0 w-16 h-16 rounded-full
               bg-white/10 hover:bg-white/20
               flex items-center justify-center
               text-white text-3xl select-none" @pointerdown="startHold" @pointerup="stopHold"
                @pointerleave="stopHold">
                <DeleteIcon />
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { PhoneIcon, DeleteIcon, PhoneMissedIcon } from "lucide-vue-next";
import { playDTMF } from "@/lib/DTMF";
import { ref } from "vue";
import { useEventListener } from "@vueuse/core";
import { logger } from "@/lib/logger";

const isActive = ref(false);


onMounted(() => {
    isActive.value = true;
})
onUnmounted(() => {
    isActive.value = false;
})

const emit = defineEmits<{
    (e: "press", key: string): void;
    (e: "call"): void;
    (e: "backspace"): void;
    (e: "backspace-all"): void;
}>();


const numpadMap: Record<string, string> = {
    Numpad0: "0",
    Numpad1: "1",
    Numpad2: "2",
    Numpad3: "3",
    Numpad4: "4",
    Numpad5: "5",
    Numpad6: "6",
    Numpad7: "7",
    Numpad8: "8",
    Numpad9: "9",
    NumpadMultiply: "*",
    NumpadDivide: "#",
    NumpadDecimal: "#",
};

function mapCodeToDialKey(code: string): string | null {
    if (code.startsWith("Digit") && code.length === 6) {
        const d = code.slice(5);
        if (d >= "0" && d <= "9") return d;
    }
    if (code.startsWith("Numpad")) {
        const tail = code.slice("Numpad".length);

        if (tail.length === 1 && tail >= "0" && tail <= "9") return tail;
        if (code === "NumpadMultiply") return "*";
        if (code === "NumpadDivide") return "#";
        if (code === "NumpadDecimal") return "#";
    }
    return null;
}
useEventListener(window, "keydown", (e: KeyboardEvent) => {
  if (!isActive.value) return;

  if (e.ctrlKey || e.altKey || e.metaKey) return;

  if (e.code === "Backspace") {
    e.preventDefault();
    emit("backspace");
    return;
  }

  if (e.code === "Enter" || e.code === "NumpadEnter") {
    e.preventDefault();
    emit("call");
    return;
  }

  const k = mapCodeToDialKey(e.code);
  if (k) {
    e.preventDefault();
    handlePress(k);
  }
});

const props = withDefaults(
    defineProps<{
        dialState?: "idle" | "checking" | "ready" | "error" | "ussd-running";
        priceMin?: number | null;
    }>(),
    { dialState: "idle" }
);

const price = computed(() =>
    props.priceMin == null ? "" : `$${(props.priceMin / 100).toFixed(2)}/min`
);

let holdTimer: number | null = null;
let isHolding = false;

const startHold = () => {
    isHolding = true;
    holdTimer = window.setTimeout(() => {
        if (isHolding) emit("backspace-all");
    }, 500);
};

const stopHold = () => {
    if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
    }
    if (isHolding) emit("backspace");
    isHolding = false;
};

const handlePress = (k: string) => {
    playDTMF(k);
    emit("press", k);
};

const keys = [
    { key: "1", label: "" },
    { key: "2", label: "ABC" },
    { key: "3", label: "DEF" },
    { key: "4", label: "GHI" },
    { key: "5", label: "JKL" },
    { key: "6", label: "MNO" },
    { key: "7", label: "PQRS" },
    { key: "8", label: "TUV" },
    { key: "9", label: "WXYZ" },
    { key: "*", label: "" },
    { key: "0", label: "+" },
    { key: "#", label: "" },
];
</script>

<style scoped>
.call-btn {
    width: 88px;
    height: 88px;
    border-radius: 9999px;
    background: #16a34a;
    color: white;

    display: flex;
    align-items: center;
    justify-content: center;

    transition:
        width .25s ease,
        border-radius .25s ease,
        background-color .2s ease,
        box-shadow .2s ease;
}

.call-btn.ready {
    width: 120px;
    height: 84px;
    border-radius: 45px;
}

.checking {
    display: flex;
    align-items: center;
    gap: 10px;

    font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    font-size: 14px;
    font-weight: 500;

    opacity: 0.9;
}

.checking-label {
    letter-spacing: 0.02em;
}

.call-btn.checking {
    background: #ca8a04;
    box-shadow: 0 0 28px rgba(234, 179, 8, .45);
    cursor: not-allowed;
}

.call-btn.error {
    background: #68150f;
    box-shadow: 0 0 28px rgba(234, 8, 8, 0.45);
    color: #a7a7a7;
    cursor: not-allowed;
}

.call-btn.ussd-preview {
    background: #2563eb;
    box-shadow: 0 0 28px rgba(37, 99, 235, .45);
}

.call-btn.ussd-running {
    background: #1e40af;
    cursor: not-allowed;
}

.confirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
    gap: 4px;

    font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}

.price {
    font-size: 12px;
    font-weight: 500;
    opacity: 0.85;
}

.confirm-text {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.01em;
}

.fade-enter-active,
.fade-leave-active {
    transition: all .15s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    transform: translateY(6px);
}

.dots span {
    display: inline-block;
    width: 6px;
    height: 6px;
    background: white;
    border-radius: 50%;
    margin: 0 2px;
    animation: blink 1.2s infinite both;
}

.dots span:nth-child(2) {
    animation-delay: .2s
}

.dots span:nth-child(3) {
    animation-delay: .4s
}

@keyframes blink {
    0% {
        opacity: .2
    }

    20% {
        opacity: 1
    }

    100% {
        opacity: .2
    }
}
</style>
