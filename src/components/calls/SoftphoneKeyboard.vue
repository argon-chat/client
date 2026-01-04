<template>
    <div class="flex flex-col items-center gap-4">
        <div class="grid grid-cols-3 gap-4">
            <div v-for="item in keys" :key="item.key" class="dial-key w-20 h-20 rounded-full bg-accent/50 hover:bg-accent/70
         backdrop-blur-md border border-border
         flex flex-col items-center justify-center
         cursor-pointer transition select-none" :class="{ 'is-pressed': pressed.has(item.key) }"
                @pointerdown.prevent="onPointerDown(item.key)" @pointerup.prevent="onPointerUp(item.key)"
                @pointercancel.prevent="onPointerUp(item.key)" @pointerleave="onPointerUp(item.key)">
                <span class="text-3xl font-semibold text-foreground leading-none">
                    {{ item.key }}
                </span>
                <span v-if="item.label" class="text-xs text-muted-foreground mt-1 tracking-wider">
                    {{ item.label }}
                </span>
            </div>
        </div>

        <div class="w-full h-24 mt-2 grid grid-cols-3 items-center">
            <div class="flex justify-center">
            </div>

            <div class="flex justify-center">
                <button class="call-btn" :class="dialState"
                    :disabled="dialState === 'checking' || dialState === 'error'" @click="$emit('call')">
                    <Transition name="fade" mode="out-in">
                        <PhoneIcon v-if="dialState === 'idle'" key="idle" class="w-10 h-10" />
                        <div v-else-if="dialState === 'checking'" key="checking" class="checking">
                            <div class="dots"><span></span><span></span><span></span></div>
                        </div>
                        <PhoneMissedIcon v-else-if="dialState === 'error'" key="error" class="w-10 h-10" />
                        <div v-else-if="dialState === 'ussd-running'" key="ussd-running" class="checking">
                            <div class="dots"><span></span><span></span><span></span></div>
                        </div>
                        <div v-else key="ready" class="confirm">
                            <span class="price">{{ price }}</span>
                            <span class="confirm-text">CONFIRM</span>
                        </div>
                    </Transition>
                </button>
            </div>

            <div class="flex justify-center">
                <button class="w-16 h-16 rounded-full
                   bg-accent/50 hover:bg-accent/70
                   flex items-center justify-center
                   text-foreground text-3xl select-none" @pointerdown="startHold" @pointerup="stopHold"
                    @pointerleave="stopHold">
                    <DeleteIcon />
                </button>
            </div>
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
const pressed = ref(new Set<string>());


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

    // важно: автоповтор при удержании (repeat) — не нажимаем заново, только держим анимацию
    // (анимация уже будет зажата, т.к. pressed.has(k) true)
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
    if (!k) return;

    e.preventDefault();

    // Если это повтор (удержание), pressKey сам ничего не сделает, т.к. уже pressed
    if (!e.repeat) pressKey(k);
    else setPressed(k, true); // на всякий случай удерживаем визуально (обычно и так уже true)
});

useEventListener(window, "keyup", (e: KeyboardEvent) => {
    if (!isActive.value) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const k = mapCodeToDialKey(e.code);
    if (!k) return;

    e.preventDefault();
    releaseKey(k);
});

// если окно потеряло фокус — отпускаем всё (иначе “залипнет”)
useEventListener(window, "blur", () => clearAllPressed());
useEventListener(document, "visibilitychange", () => {
    if (document.hidden) clearAllPressed();
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


function setPressed(k: string, value: boolean) {
    const next = new Set(pressed.value);
    if (value) next.add(k);
    else next.delete(k);
    pressed.value = next;
}

function pressKey(k: string) {
    // защита от повторного "keydown" (repeat) и двойных событий
    if (pressed.value.has(k)) return;

    setPressed(k, true);
    handlePress(k);
}

function releaseKey(k: string) {
    if (!pressed.value.has(k)) return;
    setPressed(k, false);
}

function clearAllPressed() {
    if (pressed.value.size === 0) return;
    pressed.value = new Set();
}

function onPointerDown(k: string) {
    pressKey(k);

    // чтобы pointerup гарантированно пришёл именно сюда (особенно на таче)
    // @ts-ignore - у PointerEvent есть currentTarget как EventTarget
    // но типы DOM иногда мешают, поэтому можно без строгой типизации:
    // (e.currentTarget as Element)?.setPointerCapture?.(e.pointerId)
}

function onPointerUp(k: string) {
    releaseKey(k);
}
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

.dial-key {
    transition: transform 120ms ease, background-color 120ms ease, box-shadow 120ms ease;
    transform: translateZ(0);
    will-change: transform;
}

.dial-key.is-pressed {
    transform: scale(0.92);
    background: hsl(var(--accent) / 0.8);
    box-shadow: 0 0 0 6px hsl(var(--accent) / 0.2);
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
