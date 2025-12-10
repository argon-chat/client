<template>
    <div class="flex flex-col items-center gap-4">
        <div class="grid grid-cols-3 gap-4">
            <div v-for="item in keys" :key="item.key" @click="handlePress(item.key)" class="w-20 h-20 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 
                 flex flex-col items-center justify-center cursor-pointer transition select-none">

                <span class="text-3xl font-semibold text-white leading-none">{{ item.key }}</span>
                <span v-if="item.label" class="text-xs text-gray-300 mt-1 tracking-wider">{{ item.label }}</span>
            </div>
        </div>

        <div class="flex items-center gap-8 mt-2">
            <!-- todo -->
            <button class="w-16 h-16 rounded-full bg-transparent flex items-center justify-center text-white text-3xl">
            </button>

            <button @click="$emit('call')" class="w-24 h-24 rounded-full bg-green-600 hover:bg-green-500 flex items-center justify-center 
                text-white text-4xl transition shadow-lg shadow-green-700/30">
                <PhoneIcon />
            </button>
            <button @pointerdown="startHold" @pointerup="stopHold" @pointerleave="stopHold"
                class="w-16 h-16 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-3xl">
                <DeleteIcon />
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { PhoneIcon, DeleteIcon } from "lucide-vue-next";
import { onMounted } from "vue";

const emit = defineEmits<{
    (e: "press", key: string): void;
    (e: "call"): void;
    (e: "backspace"): void;
    (e: "backspace-all"): void;
}>();

let audioCtx: AudioContext;

onMounted(() => {
    audioCtx = new AudioContext();
});

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
    if (isHolding) {
        emit("backspace");
    }

    isHolding = false;
};

const dtmfMap: Record<string, [number, number]> = {
    "1": [697, 1209],
    "2": [697, 1336],
    "3": [697, 1477],
    "4": [770, 1209],
    "5": [770, 1336],
    "6": [770, 1477],
    "7": [852, 1209],
    "8": [852, 1336],
    "9": [852, 1477],
    "*": [941, 1209],
    "0": [941, 1336],
    "#": [941, 1477],
};

const playDTMF = (key: string) => {
    const freqs = dtmfMap[key];
    if (!freqs) return;

    const duration = 0.12;

    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc1.frequency.value = freqs[0];
    osc2.frequency.value = freqs[1];

    gain.gain.value = 0.25;

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(audioCtx.destination);

    osc1.start();
    osc2.start();
    osc1.stop(audioCtx.currentTime + duration);
    osc2.stop(audioCtx.currentTime + duration);
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
