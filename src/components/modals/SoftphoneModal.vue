<template>

    <Dialog v-model:open="open">
        <DialogContent
            class="sm:max-w-[420px] rounded-2xl border border-white/10 bg-gradient-to-br from-black/60 via-zinc-900/70 to-black/60 backdrop-blur-2xl p-8 space-y-8">
            <div class="w-full text-center py-3 mb-3 select-none
         text-red-500 font-mono tracking-widest text-sm text-xl
         warning-cyber absolute -top-20">
                ⚠ NOT FOR EMERGENCY CALL ⚠ 
            </div>

            <input v-model="number" readonly class="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-4 
               text-white text-3xl tracking-widest text-center outline-none" />

            <SoftphoneKeyboard @press="appendKey" @backspace="backspace" @backspace-all="backspaceAll"
                @call="callOrUssd" />
        </DialogContent>
    </Dialog>

    <UssdModal v-model:open="ussdOpen" v-model:loading="ussdLoading" v-model:result="ussdResult" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import UssdModal from "./UssdModal.vue";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import SoftphoneKeyboard from "../SoftphoneKeyboard.vue";
import { ussdClient } from "@/lib/ussd";
import delay from "@/lib/delay";

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{
    (e: "call", number: string): void;
    (e: "close"): void;
}>();

const number = ref("");

const appendKey = (k: string) => number.value += k;
const backspace = () => number.value = number.value.slice(0, -1);
const backspaceAll = () => number.value = '';

const ussdOpen = ref(false);
const ussdLoading = ref(false);
const ussdResult = ref("");

const isUssd = (num: string) => {
    return num.startsWith("*") && num.endsWith("#");
};

const callOrUssd = async () => {
    const num = number.value;

    if (!num) return;

    if (isUssd(num)) {
        runUssd(num);
        return;
    }

    ussdOpen.value = true;
    ussdResult.value = "."

    await delay(500);

    ussdResult.value = ".."

    await delay(500);

    ussdResult.value = "..."

    await delay(500);

    ussdOpen.value = true;
    ussdResult.value = "Failed to connect, reason: Абонент пидорас"
    ussdLoading.value = false;

    emit("call", num);
    emit("close");
};

const runUssd = (cmd: string) => {
    ussdOpen.value = true;
    ussdLoading.value = true;

    setTimeout(async () => {
        const result = await ussdClient.run(cmd, 1500);
        ussdResult.value = result.output;
        ussdLoading.value = false;
        backspaceAll();
    }, 1500);
};
</script>
<style lang="css">
.warning-cyber {
    border-top: 1px solid #b91c1c;
    border-bottom: 1px solid #b91c1c;
    background: rgba(0, 0, 0, 0.35);
    overflow: hidden;
}

.warning-cyber::before,
.warning-cyber::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    width: 14px;
    border-top: 1px solid #b91c1c;
    border-bottom: 1px solid #b91c1c;
}

.warning-cyber::before {
    left: -14px;
    border-left: 1px solid #b91c1c;
}

.warning-cyber::after {
    right: -14px;
    border-right: 1px solid #b91c1c;
}

.warning-cyber {
    animation: warning-glitch 2.4s infinite steps(2, end);
}

@keyframes warning-glitch {
    0% {
        transform: translateX(0);
    }

    10% {
        transform: translateX(-1px);
    }

    20% {
        transform: translateX(1px);
    }

    30% {
        transform: translateX(0);
    }

    100% {
        transform: translateX(0);
    }
}
</style>