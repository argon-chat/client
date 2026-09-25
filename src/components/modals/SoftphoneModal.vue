<template>
    <Dialog v-model:open="open">
        <DialogContent class="sm:max-w-[420px] rounded-2xl border
             bg-card/95
             backdrop-blur-2xl p-8 pt-12">
            <!-- Named for screen readers only: this dialog draws no heading of its own. -->
            <VisuallyHidden>
              <DialogTitle>{{ t("dial_pad") }}</DialogTitle>
            </VisuallyHidden>
            <div class="w-full text-center py-3 mb-3 select-none
               text-red-500 font-mono tracking-widest text-xl
               warning-cyber absolute -top-20">
                ⚠ NOT FOR EMERGENCY CALL ⚠
            </div>
            <div class="relative">
                <input v-model="number" readonly :class="[
                    'w-full bg-background/50 border rounded-xl px-4 py-4 text-3xl text-center font-mono tracking-widest text-foreground',
                    isUssd(number) ? 'border-green-500 text-green-400' : 'border-border'
                ]" />

                <div v-if="dialState === 'ussd-running' || ussdResult" class="absolute inset-0 rounded-xl
               bg-background/90 backdrop-blur-xl
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
            <SoftphoneKeyboard :dialState="dialState" @call="callOrUssd" @press="appendKey"
                @backspace="backspace" @backspace-all="backspaceAll" />
        </DialogContent>
    </Dialog>

    <!-- <UssdModal v-model:open="ussdOpen" v-model:loading="ussdLoading" v-model:result="ussdResult" /> -->
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch, provide } from "vue";
import { Dialog, DialogContent, DialogTitle } from "@argon/ui/dialog";
import { VisuallyHidden } from "@argon/ui/visually-hidden";
import { SoftphoneKeyboard } from "@argon/softphone";

import { ussdClient } from "@/lib/ussd";
import { useLocale } from "@/store/system/localeStore";
import { delay } from "@argon/core";
import { playBusyTone, playDTMF, dtmfPlayer } from "@/lib/audio/AudioManager";

// Provide DTMF player to keyboard component
provide('dtmfPlayer', dtmfPlayer);

const { t } = useLocale();

const open = defineModel<boolean>("open", { default: false });

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


watch(open, (v, oldV) => {
    if (!v) {
        resetDial();
        ussdLoading.value = false;
        backspaceAll();
    }
});


const ussdLoading = ref(false);
const ussdResult = ref("" as string | null);

type DialState =
    | "idle"
    | "checking"
    | "error"
    | "ussd-running";

type DialError = "number_not_available" | "unknown";

const dialState = ref<DialState>("idle");
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
        if (ch === " ") {
            delay(130);
            continue;
        }
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
    dialState.value = "checking";

    if (num == "000000") {
        await playNumberDTMF("#3#3#4#3#6#5  #3#3#4#3#7#6  #3#3#4#3#6#5#5#4 2  #3#3#4#3#6#5  #3#3#4#3#7#6  #3#3#4#3#6#5#5#4 2  5 5#6 5#4#3 5 5#6 5#4#3 5 5#6 5#4#3 3#4 5#6#7  #3#3#4#3#6#5  #3#3#4#3#7#6  #3#3#4#3#6#5#5  #4#4#7#6#5  #3#3#4#3#6#5  #3#3#4#3#7#6  #3#3#4#3#6#5#5  #4#4#7#6#5");
        await delay(1000);
        showDialError("unknown");
        return;
    }

    if (num.length < 5) { // in 99% cases special numbers e.g 991
        await playNumberDTMF(num);
        await delay(1000);
        await playNumberDTMF(num.split('').reverse().join(''));
        showDialError("number_not_available");
        return;
    }

    // Outgoing SIP calls are gone: every other number ends here.
    await playNumberDTMF(num);
    await delay(600);
    showDialError("number_not_available");
};

const showDialError = (reason: DialError) => {
    dialState.value = "error";
    dialError.value = reason === "number_not_available" ? "Number not available" : "Unknown error";
};

const resetDial = () => {
    dialState.value = "idle";
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
