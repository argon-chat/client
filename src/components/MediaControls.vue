<template>
    <Transition name="controls-reveal">
        <div v-if="isConnected || isConnecting" class="controls-block">
            <button class="ctrl-btn ctrl-btn--danger" @click="$emit('hangup')" :disabled="!isConnected">
                <PhoneOffIcon class="w-[18px] h-[18px]" />
            </button>

            <div class="ctrl-divider" />

            <!-- Microphone + device switch -->
            <div class="ctrl-split">
                <button class="ctrl-btn" :class="{ 'ctrl-btn--active': sys.microphoneMuted }" @click="sys.toggleMicrophoneMute()">
                    <MicOff v-if="sys.microphoneMuted" class="w-[18px] h-[18px]" />
                    <Mic v-else class="w-[18px] h-[18px]" />
                </button>
                <Popover v-model:open="micMenuOpen">
                    <PopoverTrigger as-child>
                        <button class="ctrl-chevron" :title="t('switch_microphone')"><ChevronUp class="w-3 h-3" /></button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" class="ctrl-popover">
                        <div class="ctrl-popover-title">{{ t('microphone') }}</div>
                        <div v-if="mics.length === 0" class="device-row device-row--empty">
                            {{ t('no_microphones_found') }}
                        </div>
                        <button
                            v-for="d in mics"
                            :key="d.deviceId"
                            class="device-row"
                            :class="{ active: d.deviceId === activeMicId }"
                            :disabled="micSwitching"
                            @click="pickMic(d.deviceId)">
                            <Mic class="w-3.5 h-3.5 shrink-0" />
                            <span class="device-name">{{ d.label || t('microphone') }}</span>
                            <Check v-if="d.deviceId === activeMicId" class="w-3.5 h-3.5 ml-auto shrink-0" />
                        </button>
                    </PopoverContent>
                </Popover>
            </div>

            <button class="ctrl-btn" :class="{ 'ctrl-btn--active': sys.headphoneMuted }" @click="sys.toggleHeadphoneMute()">
                <HeadphoneOff v-if="sys.headphoneMuted" class="w-[18px] h-[18px]" />
                <Headphones v-else class="w-[18px] h-[18px]" />
            </button>

            <div class="ctrl-divider" />

            <!-- Screen share + options menu (system audio / source / quality) -->
            <div class="ctrl-split">
                <button class="ctrl-btn" :class="{ 'ctrl-btn--active': voice.isSharing }" @click="toggleScreenCast" :disabled="!isConnected">
                    <ScreenShareOff v-if="voice.isSharing" class="w-[18px] h-[18px]" />
                    <ScreenShare v-else class="w-[18px] h-[18px]" />
                </button>
                <Popover v-model:open="shareMenuOpen">
                    <PopoverTrigger as-child>
                        <button class="ctrl-chevron" :title="t('screencast')" :disabled="!isConnected"><ChevronUp class="w-3 h-3" /></button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="end" class="ctrl-popover">
                        <!-- System / desktop audio -->
                        <button class="device-row" :class="{ active: voice.systemAudioEnabled }" @click="voice.toggleSystemAudio()">
                            <Volume2 v-if="voice.systemAudioEnabled" class="w-3.5 h-3.5 shrink-0" />
                            <VolumeX v-else class="w-3.5 h-3.5 shrink-0" />
                            <span class="device-name">{{ t('system_audio') }}</span>
                            <Check v-if="voice.systemAudioEnabled" class="w-3.5 h-3.5 ml-auto shrink-0" />
                        </button>

                        <div class="menu-sep" />

                        <!-- Change source (monitor / window) -->
                        <button class="device-row" @click="changeSource">
                            <Monitor class="w-3.5 h-3.5 shrink-0" />
                            <span class="device-name">{{ t('switch_monitor') }}</span>
                        </button>

                        <!-- Quality (only meaningful while live) -->
                        <template v-if="voice.isSharing">
                            <div class="menu-sep" />
                            <div class="ctrl-popover-title">{{ t('quality') }}</div>
                            <button
                                v-for="q in qualityPresets"
                                :key="q.label"
                                class="device-row"
                                :class="{ active: q.w === currentQualityWidth }"
                                @click="applyQuality(q)">
                                <span class="device-name">{{ q.label }}</span>
                                <Check v-if="q.w === currentQualityWidth" class="w-3.5 h-3.5 ml-auto shrink-0" />
                            </button>
                        </template>
                    </PopoverContent>
                </Popover>
            </div>

            <ScreenSharePicker ref="sharePicker" @start="goShare" />

            <!-- Camera + device switch -->
            <div class="ctrl-split">
                <button class="ctrl-btn" :class="{ 'ctrl-btn--active': voice.isCameraOn }" @click="voice.toggleCamera()" :disabled="!isConnected">
                    <CameraOff v-if="voice.isCameraOn" class="w-[18px] h-[18px]" />
                    <CameraIcon v-else class="w-[18px] h-[18px]" />
                </button>
                <Popover v-model:open="camMenuOpen">
                    <PopoverTrigger as-child>
                        <button class="ctrl-chevron" :title="t('switch_camera')" :disabled="!isConnected">
                            <ChevronUp class="w-3 h-3" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent side="top" align="end" class="ctrl-popover">
                        <div class="ctrl-popover-title">{{ t('camera') }}</div>
                        <div v-if="cams.length === 0" class="device-row device-row--empty">
                            {{ t('no_cameras_found') }}
                        </div>
                        <button
                            v-for="d in cams"
                            :key="d.deviceId"
                            class="device-row"
                            :class="{ active: d.deviceId === activeCamId }"
                            :disabled="switching"
                            @click="pickCam(d.deviceId)">
                            <CameraIcon class="w-3.5 h-3.5 shrink-0" />
                            <span class="device-name">{{ d.label || t('camera') }}</span>
                            <Check v-if="d.deviceId === activeCamId" class="w-3.5 h-3.5 ml-auto shrink-0" />
                        </button>
                    </PopoverContent>
                </Popover>
            </div>

            <button v-if="showPlayframe" class="ctrl-btn" :class="{ 'ctrl-btn--active': activity.isActive }" @click="activity.openPicker()" :disabled="!isConnected">
                <Gamepad2 class="w-[18px] h-[18px]" />
            </button>
        </div>
    </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useSystemStore } from "@/store/system/systemStore";
import { usePlayFrameActivity } from "@/store/features/playframeStore";
import { usePreference } from "@/store/ui/preferenceStore";
import { useLocale } from "@/store/system/localeStore";
import { audio } from "@/lib/audio/AudioManager";
import ScreenSharePicker from "./ScreenSharePicker.vue";
import { qualityPresets } from "@/composables/useScreenShareSources";
import { Popover, PopoverTrigger, PopoverContent } from "@argon/ui/popover";
import {
    Mic, MicOff, Headphones, HeadphoneOff,
    ScreenShare, ScreenShareOff, PhoneOffIcon,
    CameraIcon, CameraOff, Gamepad2,
    ChevronUp, Check, Volume2, VolumeX, Monitor,
} from "lucide-vue-next";

const voice = useUnifiedCall();
const sys = useSystemStore();
const activity = usePlayFrameActivity();
const pref = usePreference();
const { t } = useLocale();

defineProps<{
    isConnected: boolean;
    isConnecting: boolean;
    showPlayframe?: boolean;
}>();

defineEmits<{
    (e: "hangup"): void;
}>();

const sharePicker = ref<InstanceType<typeof ScreenSharePicker> | null>(null);

const openSharePicker = () => {
    if (sharePicker.value) sharePicker.value.open = true;
};

const toggleScreenCast = () => {
    if (voice.isSharing) {
        voice.stopScreenShare();
    } else {
        openSharePicker();
    }
};

async function goShare(opts: {
    deviceId: string;
    systemAudio: "include" | "exclude";
    width: number;
    height: number;
    frameRate: number;
    maxBitrate: number;
}) {
    // Picker is also used to switch the source mid-share → swap, don't re-prompt-toggle.
    if (voice.isSharing) {
        await voice.switchScreenShare(opts);
    } else {
        await voice.startScreenShare(opts);
    }
}

// --- Screen-share options menu ---
const shareMenuOpen = ref(false);
const currentQualityWidth = computed(() => voice.lastShareOpts?.width);

const changeSource = () => {
    shareMenuOpen.value = false;
    openSharePicker();
};

async function applyQuality(q: (typeof qualityPresets)[number]) {
    shareMenuOpen.value = false;
    if (!voice.isSharing || !voice.lastShareOpts) return;
    await voice.switchScreenShare({
        ...voice.lastShareOpts,
        width: q.w,
        height: q.h,
        maxBitrate: q.maxBitrate,
    });
}

// --- Microphone device switcher ---
const mics = ref<MediaDeviceInfo[]>([]);
const micMenuOpen = ref(false);
const micSwitching = ref(false);
const activeMicId = computed(() => audio.getInputDevice().value);

watch(micMenuOpen, async (open) => {
    if (open) mics.value = await audio.enumerateDevicesByKind("audioinput");
});

async function pickMic(deviceId: string) {
    if (micSwitching.value) return;
    micSwitching.value = true;
    micMenuOpen.value = false;
    try {
        await audio.setInputDevice(deviceId);
    } finally {
        micSwitching.value = false;
    }
}

// --- Camera device switcher ---
const cams = ref<MediaDeviceInfo[]>([]);
const camMenuOpen = ref(false);
const switching = ref(false);
const activeCamId = computed(() => pref.defaultVideoDevice);

watch(camMenuOpen, async (open) => {
    // Enumerate lazily on open — labels populate after camera permission is granted once.
    if (open) cams.value = await audio.enumerateDevicesByKind("videoinput");
});

async function pickCam(deviceId: string) {
    if (switching.value) return;
    switching.value = true;
    camMenuOpen.value = false;
    try {
        await voice.switchCamera(deviceId);
    } finally {
        switching.value = false;
    }
}
</script>

<style scoped>
.controls-block {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 10px 14px;
    background-color: hsl(var(--card) / 0.8) ;
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: var(--radius);
    flex-shrink: 0;
}

.ctrl-divider {
    width: 1px;
    height: 20px;
    background: hsl(var(--border) / 0.4);
    margin: 0 4px;
}

.ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    border: none;
    background: transparent;
    color: hsl(var(--foreground) / 0.75);
    cursor: pointer;
    transition: all 0.15s ease;
}

.ctrl-btn:hover {
    background: hsl(var(--foreground) / 0.08);
    color: hsl(var(--foreground));
}

.ctrl-btn--active {
    color: hsl(var(--destructive));
}

.ctrl-btn--active:hover {
    background: hsl(var(--destructive) / 0.12);
    color: hsl(var(--destructive));
}

.ctrl-btn--danger {
    color: hsl(var(--destructive-foreground));
    background: hsl(var(--destructive));
}

.ctrl-btn--danger:hover {
    background: hsl(var(--destructive) / 0.85);
}

.ctrl-btn:disabled {
    color: hsl(var(--muted-foreground) / 0.35);
    cursor: not-allowed;
}

.ctrl-btn:disabled:hover {
    background: transparent;
}

/* Split control: primary button + flush chevron sub-button */
.ctrl-split {
    display: flex;
    align-items: center;
    gap: 1px;
}

.ctrl-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 38px;
    border: none;
    background: transparent;
    color: hsl(var(--foreground) / 0.55);
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.15s ease;
}

.ctrl-chevron:hover {
    background: hsl(var(--foreground) / 0.08);
    color: hsl(var(--foreground));
}

.ctrl-chevron:disabled {
    color: hsl(var(--muted-foreground) / 0.35);
    cursor: not-allowed;
}

.ctrl-chevron:disabled:hover {
    background: transparent;
}

/* Device / options popover */
.ctrl-popover {
    width: auto;
    min-width: 220px;
    max-width: 300px;
    padding: 6px;
    border-radius: var(--radius);
}

.ctrl-popover-title {
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: hsl(var(--muted-foreground));
    padding: 4px 8px 6px;
}

.menu-sep {
    height: 1px;
    background: hsl(var(--border) / 0.5);
    margin: 4px 6px;
}

.device-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    border-radius: calc(var(--radius) - 4px);
    font-size: 12px;
    color: hsl(var(--foreground) / 0.85);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    text-align: left;
}

.device-row:hover {
    background: hsl(var(--foreground) / 0.08);
    color: hsl(var(--foreground));
}

.device-row.active {
    color: hsl(var(--foreground));
    background: hsl(var(--primary) / 0.12);
}

.device-row:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.device-row--empty {
    color: hsl(var(--muted-foreground));
    cursor: default;
}

.device-row--empty:hover {
    background: transparent;
}

.device-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Controls reveal transition */
.controls-reveal-enter-active {
    transition: all 0.2s ease-out;
}
.controls-reveal-leave-active {
    transition: all 0.15s ease-in;
}
.controls-reveal-enter-from {
    opacity: 0;
    transform: translateY(8px);
}
.controls-reveal-leave-to {
    opacity: 0;
    transform: translateY(8px);
}
</style>
