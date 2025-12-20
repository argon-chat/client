<template>
    <Dialog v-model:open="open">
        <DialogContent class="sm:max-w-[420px] rounded-2xl border border-white/10
             bg-gradient-to-br from-black/60 via-zinc-900/70 to-black/60
             backdrop-blur-2xl p-8 pt-12">
            <div class="w-full text-center py-3 mb-3 select-none
               text-red-500 font-mono tracking-widest text-xl
               warning-cyber absolute -top-20">
                ⚠ NOT FOR EMERGENCY CALL ⚠
            </div>
            <div class="relative">
                <input v-model="number" readonly :class="[
                    'w-full bg-black/40 border rounded-xl px-4 py-4 text-3xl text-center font-mono tracking-widest',
                    isUssd(number) ? 'border-green-500 text-green-400' : 'border-white/10'
                ]" />

                <div v-if="dialState === 'ussd-running' || ussdResult" class="absolute inset-0 rounded-xl
               bg-black/80 backdrop-blur-xl
               border border-green-500/40
               flex items-center justify-center
               px-4 text-green-400 font-mono text-sm
               pointer-events-none ">
                    <div class="w-full text-center whitespace-pre-line">
                        <span v-if="ussdLoading" class="opacity-70">
                            Executing USSD<span class="animate-pulse">▌</span>
                        </span>

                        <span v-else v-html="ussdResult"></span>
                    </div>
                </div>
            </div>
            <div class="mt-3 text-center font-mono text-sm tracking-widest select-none min-h-5">
                <span v-if="dialError" class="text-red-500">
                    {{ dialError }}
                </span>
            </div>
            <SoftphoneKeyboard :dialState="dialState" :priceMin="dialPriceMin" @call="callOrUssd" @press="appendKey"
                @backspace="backspace" @backspace-all="backspaceAll" />
        </DialogContent>
    </Dialog>

    <!-- <UssdModal v-model:open="ussdOpen" v-model:loading="ussdLoading" v-model:result="ussdResult" /> -->
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import SoftphoneKeyboard from "../SoftphoneKeyboard.vue";
import UssdModal from "./UssdModal.vue";

import { ussdClient } from "@/lib/ussd";
import delay from "@/lib/delay";
import { useApi } from "@/store/apiStore";
import { DialCheckFailReason } from "@/lib/glue/argonChat";
import { playDTMF } from "@/lib/DTMF";
import { encodePhoneToGuid } from "@/lib/bcd";
import { Guid } from "@argon-chat/ion.webcore";
import { logger } from "@/lib/logger";

const api = useApi();

const open = defineModel<boolean>("open", { default: false });

const emit = defineEmits<{
    (e: "call", number: string): void;
    (e: "close"): void;
}>();

const number = ref("");
const appendKey = (k: string) => (number.value += k);
const backspace = () => {
    ussdResult.value = null;
    return (number.value = number.value.slice(0, -1));
};
const backspaceAll = () => {
    ussdResult.value = null;
    return (number.value = "");
};

const ussdOpen = ref(false);
const ussdLoading = ref(false);
const ussdResult = ref("" as string | null);

type DialState =
    | "idle"
    | "checking"
    | "ready"
    | "error"
    | "ussd-running";


const dialState = ref<DialState>("idle");
const dialPriceMin = ref<number | null>(null);
const dialCorlId = ref<Guid | null>(null);
const dialError = ref<string | null>(null);

watch(number, (newVal, oldVal) => {
    if (newVal !== oldVal && dialState.value == "idle" && newVal) {
        ussdResult.value = null;
    }
    if (dialState.value !== "idle" || dialError.value) {
        resetDial();
    }
});

const isUssd = (n: string) => n.startsWith("*") || n.startsWith("#");

const playNumberDTMF = async (num: string) => {
    for (const ch of num) {
        playDTMF(ch);
        await delay(130);
    }
};

const callOrUssd = async () => {
    const num = number.value;
    if (!num) return;

    if (isUssd(num)) {
        runUssd(num);
        return;
    }
    if (dialState.value === "ready") {
        emit("call", num);
        emit("close");
        resetDial();
        return;
    }
    dialState.value = "checking";
    dialPriceMin.value = null;
    dialCorlId.value = null;

    await playNumberDTMF(num);

    try {
        const phoneId = encodePhoneToGuid(num);
        const result = await api.callInteraction.BeginDialCheck(phoneId);

        logger.warn(result);

        if (result.isSuccessDialCheck()) {
            dialPriceMin.value = result.priceMin;
            dialCorlId.value = result.corlId;
            dialState.value = "ready";
        } else if (result.isFailedDialCheck()) {
            showDialError(result.reason);
        }
    } catch {
        showDialError("UNKNOWN");
    }
};

const showDialError = (reason: DialCheckFailReason | "UNKNOWN") => {
    dialState.value = "error";
    switch (reason) {
        case DialCheckFailReason.COUNTRY_NOT_SUPPORT:
            dialError.value = "Country not supported";
            break;
        case DialCheckFailReason.INVALID_NUMBER_COUNTRY:
            dialError.value = "Invalid country code";
            break;
        case DialCheckFailReason.INSUFFICIENT_BALANCE:
            dialError.value = "Insufficient balance";
            break;
        case DialCheckFailReason.NUMBER_NOT_AVAILABLE:
            dialError.value = "Number not available";
            break;
        case DialCheckFailReason.INSUFFICIENT_POOL:
            dialError.value = "No free lines, try later";
            break;
        default:
            dialError.value = "Unknown error";
    }
};

const resetDial = () => {
    dialState.value = "idle";
    dialPriceMin.value = null;
    dialCorlId.value = null;
    dialError.value = null;
};

const runUssd = async (cmd: string) => {
    dialState.value = "ussd-running";
    ussdLoading.value = true;
    ussdResult.value = null;
    try {
        const result = await ussdClient.run(cmd, 1500);
        backspaceAll();
        ussdResult.value = result.output;
    } catch {
        ussdResult.value = "USSD execution failed";
    } finally {
        ussdLoading.value = false;
        dialState.value = "idle";
    }
};
</script>

<style>
.warning-cyber {
    border-top: 1px solid #b91c1c;
    border-bottom: 1px solid #b91c1c;
    background: rgba(0, 0, 0, 0.35);
    overflow: hidden;
    animation: warning-glitch 2.4s infinite steps(2, end);
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
