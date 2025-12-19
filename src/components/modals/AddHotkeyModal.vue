<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "@/store/localeStore";
import { useHotkeys, availableActions } from "@/store/hotKeyStore";
import { native } from "@/lib/glue/nativeGlue";
import {
    HotkeyActionType,
    HotkeyDescriptor,
    HotkeyButton,
} from "@/lib/glue/argon.ipc";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectItem } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import SelectTrigger from "../ui/select/SelectTrigger.vue";
import SelectValue from "../ui/select/SelectValue.vue";
import SelectContent from "../ui/select/SelectContent.vue";
import SelectGroup from "../ui/select/SelectGroup.vue";
import { keyCodeToFormatterSymbolsOrNames, keyCodeToNames } from "@/lib/keyCodes";
import KbdGroup from "../kbd/KbdGroup.vue";
import Kbd from "../kbd/Kbd.vue";
import { audio } from "@/lib/audio/AudioManager";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useLocale();
const hotkeys = useHotkeys();

const selectedActionKey = ref<string | undefined>();
const selectedActionType = ref<HotkeyActionType>(HotkeyActionType.Trigger);

const recordedChord = ref<HotkeyButton[] | null>(null);
const captureError = ref<string | null>(null);
const isCapturing = ref(false);

const recordedKeys = computed(() => {
    if (!recordedChord.value) return [];
    return recordedChord.value
        .map(b => keyCodeToFormatterSymbolsOrNames(b.code)?.[0])
        .filter(Boolean);
});

const canSave = computed(
    () => !!selectedActionKey.value && !!recordedChord.value?.length
);

const modifierKeyCodes = new Set<number>([
    0x10, // Shift
    0x11, // Control
    0x12, // Alt (Menu)

    0xa0, // LShift
    0xa1, // RShift
    0xa2, // LControl
    0xa3, // RControl
    0xa4, // LAlt
    0xa5, // RAlt

    0x5b, // LWin
    0x5c, // RWin

    0x14, // CapsLock
    0x90, // NumLock
    0x91, // ScrollLock
]);

const mouseKeyCodesBlacklist = new Set<number>([
    0x0100,
    0x0101,
    0x0102,
    0x0104,
])

function hasNonModifier(buttons: readonly HotkeyButton[]): boolean {
    for (const btn of buttons) {
        if (!modifierKeyCodes.has(btn.code)) {
            return true;
        }
    }
    return false;
}

function hasBlacklistedMouse(buttons: readonly HotkeyButton[]): boolean {
    for (const btn of buttons) {
        if (!mouseKeyCodesBlacklist.has(btn.code)) {
            return true;
        }
    }
    return false;
}


async function startRecord() {
    captureError.value = null;
    recordedChord.value = null;

    if (!argon.isArgonHost) {
        captureError.value = "Hotkey capture available only in desktop app";
        return;
    }


    isCapturing.value = true;

    playUiBeep(720, 0.04, 0.02, null);

    try {
        const chord = await native.hostProc.hotkeyCaptureOnce();

        if (!chord || !chord.buttons.length) {
            captureError.value = "Empty hotkey";
            return;
        }

        if (!hasNonModifier(chord.buttons)) {
            captureError.value = "Hotkey must include a non-modifier key";
            playUiBeep(260, 0.07, 0.03, "down");
            return;
        }

        if (!hasBlacklistedMouse(chord.buttons)) {
            captureError.value = "Hotkey must include a non-master mouse key";
            playUiBeep(260, 0.07, 0.03, "down");
            return;
        }

        recordedChord.value = chord.buttons;
        playUiBeep(1280, 0.05, 0.025, "up");
    } catch (e: any) {
        captureError.value = String(e);
        playUiBeep(260, 0.07, 0.03, "down");
    } finally {
        isCapturing.value = false;
    }
}

async function save() {
    if (!selectedActionKey.value || !recordedChord.value) return;

    const hk: HotkeyDescriptor = {
        id: selectedActionKey.value,
        chord: { buttons: recordedChord.value },
        action: selectedActionType.value,
        suppress: false,
        triggerCooldownMs: 20,
    };

    hotkeys.allHotKeys.set(hk.id, {
        ...hk,
        errText: null,
    });

    await hotkeys.syncHotkey(hotkeys.allHotKeys.get(hk.id)!);
    emit("close");
}

function close() {
    reset();
    emit("close");
}

function reset() {
    selectedActionKey.value = undefined;
    selectedActionType.value = HotkeyActionType.Trigger;
    recordedChord.value = null;
    captureError.value = null;
    isCapturing.value = false;
}

watch(() => props.open, v => {
    if (!v) reset();
});

function playUiBeep(
    freq: number,
    duration = 0.05,
    volume = 0.025,
    pitchSlide: "up" | "down" | null = null
) {
    const audioCtx = audio.getCurrentAudioContext();
    const now = audioCtx.currentTime;

    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    const compressor = audioCtx.createDynamicsCompressor();

    osc1.type = "sine";
    osc2.type = "sine";

    const slideAmount = 0.02; // ±2%
    const slideTime = 0.02;   // 20 ms

    let startFreq = freq;
    let targetFreq = freq;

    if (pitchSlide === "up") {
        startFreq = freq * (1 - slideAmount);
        targetFreq = freq;
    } else if (pitchSlide === "down") {
        startFreq = freq * (1 + slideAmount);
        targetFreq = freq;
    }

    osc1.frequency.setValueAtTime(startFreq, now);
    osc2.frequency.setValueAtTime(startFreq * 1.006, now);

    osc1.frequency.exponentialRampToValueAtTime(
        targetFreq,
        now + slideTime
    );
    osc2.frequency.exponentialRampToValueAtTime(
        targetFreq * 1.006,
        now + slideTime
    );

    osc2.detune.value = -3;

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, now);
    filter.Q.setValueAtTime(0.7, now);

    compressor.threshold.setValueAtTime(-28, now);
    compressor.knee.setValueAtTime(18, now);
    compressor.ratio.setValueAtTime(2, now);
    compressor.attack.setValueAtTime(0.002, now);
    compressor.release.setValueAtTime(0.05, now);

    gain.gain.setValueAtTime(0.0001, now);

    gain.gain.exponentialRampToValueAtTime(
        volume,
        now + 0.01
    );

    gain.gain.setValueAtTime(
        volume * 0.9,
        now + duration * 0.6
    );

    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + duration
    );

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(compressor);
    compressor.connect(gain);
    gain.connect(audioCtx.destination);

    osc1.start(now);
    osc2.start(now);

    osc1.stop(now + duration + 0.03);
    osc2.stop(now + duration + 0.03);
}


</script>


<template>
    <Dialog :open="open" @update:open="close">
        <DialogContent class="w-[420px]">
            <DialogHeader>
                <DialogTitle>{{ t("add_hotkey") }}</DialogTitle>
            </DialogHeader>

            <Alert class="mb-6">
                <AlertDescription>
                    {{ t("hotkey_admin_warning") }}
                </AlertDescription>
            </Alert>

            <div class="mb-4 space-y-1">
                <div class="text-sm font-medium">
                    {{ t("hotkey_action") }}
                </div>

                <Select v-model="selectedActionKey">
                    <SelectTrigger class="w-full">
                        <SelectValue placeholder="Select action" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem v-for="a in availableActions" :key="a.actionKey" :value="a.actionKey"
                                :disabled="a.disabled">
                                {{ t(a.actionKey) }}
                            </SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>

            <div class="mb-6 space-y-1">
                <div class="text-sm font-medium">
                    {{ t("hotkey_mode") }}
                </div>

                <RadioGroup :model-value="String(selectedActionType)"
                    @update:model-value="v => selectedActionType = Number(v)" class="flex gap-4">
                    <label class="flex items-center gap-2">
                        <RadioGroupItem :value="String(HotkeyActionType.Trigger)" />
                        {{ t("hotkey.trigger") }}
                    </label>

                    <label class="flex items-center gap-2">
                        <RadioGroupItem :value="String(HotkeyActionType.Hold)" />
                        {{ t("hotkey.hold") }}
                    </label>

                    <label class="flex items-center gap-2">
                        <RadioGroupItem :value="String(HotkeyActionType.Toggle)" />
                        {{ t("hotkey.toggle") }}
                    </label>
                </RadioGroup>
            </div>

            <!-- HOTKEY (FOCUS AREA) -->
            <div class="mb-4 space-y-2">
                <div class="text-sm font-medium">
                    {{ t("hotkey") }}
                </div>

                <div class="
            relative
            rounded-md
            transition-all duration-200
          " :class="{
            'bg-muted/30 ring-1 ring-ring/20': !isCapturing && !recordedKeys.length,
            'bg-muted/50 ring-1 ring-ring/50 scale-[1.01]': isCapturing,
            'bg-background ring-1 ring-ring/70': recordedKeys.length && !isCapturing,
        }">
                    <Button variant="outline" class="
              w-full h-11 px-3
              flex items-center justify-between
              transition-all duration-200
              hover:bg-muted/40
              active:scale-[0.99]
            " :disabled="isCapturing" @click="startRecord">
                        <div class="flex items-center gap-2">
                            <span v-if="isCapturing" class="h-2 w-2 rounded-full bg-red-500 animate-pulse" />

                            <span class="text-sm font-medium transition-opacity duration-200" :class="{
                                'opacity-70': isCapturing,
                                'opacity-100': !isCapturing,
                            }">
                                <template v-if="isCapturing">
                                    {{ t("recording") }}
                                </template>
                                <template v-else-if="recordedKeys.length">
                                    {{ t("change_hotkey") }}
                                </template>
                                <template v-else>
                                    {{ t("record_hotkey") }}
                                </template>
                            </span>
                        </div>

                        <div class="min-w-[140px] flex justify-end">
                            <Transition enter-active-class="transition-all duration-200 ease-out"
                                enter-from-class="opacity-0 translate-y-0.5 scale-95"
                                enter-to-class="opacity-100 translate-y-0 scale-100"
                                leave-active-class="transition-all duration-150 ease-in"
                                leave-from-class="opacity-100 scale-100" leave-to-class="opacity-0 scale-95">
                                <KbdGroup v-if="recordedKeys.length && !isCapturing" class="flex items-center text-sm">
                                    <template v-for="(key, i) in recordedKeys" :key="i">
                                        <Kbd class="
                        px-2 py-1
                        transition-transform duration-150
                        hover:scale-105
                      ">
                                            {{ key }}
                                        </Kbd>
                                        <span v-if="i < recordedKeys.length - 1" class="mx-1 text-muted-foreground">
                                            +
                                        </span>
                                    </template>
                                </KbdGroup>
                            </Transition>
                        </div>
                    </Button>

                    <Transition enter-active-class="transition-opacity duration-150" enter-from-class="opacity-0"
                        enter-to-class="opacity-100" leave-active-class="transition-opacity duration-150"
                        leave-from-class="opacity-100" leave-to-class="opacity-0">
                        <div v-if="isCapturing" class="
                pointer-events-none
                absolute inset-0
                flex items-center justify-center
                text-xs text-muted-foreground
              ">
                            Press keys…
                        </div>
                    </Transition>
                </div>
                <div v-if="captureError" class="text-sm text-red-600">
                    {{ captureError }}
                </div>
            </div>
            <DialogFooter>
                <Button variant="ghost" @click="close">
                    {{ t("cancel") }}
                </Button>

                <Button :disabled="!canSave" @click="save">
                    {{ t("save") }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>
