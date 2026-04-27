<template>
    <Transition name="controls-reveal">
        <div v-if="isConnected || isConnecting" class="controls-block">
            <button class="ctrl-btn ctrl-btn--danger" @click="$emit('hangup')" :disabled="!isConnected">
                <PhoneOffIcon class="w-[18px] h-[18px]" />
            </button>

            <div class="ctrl-divider" />

            <button class="ctrl-btn" :class="{ 'ctrl-btn--active': sys.microphoneMuted }" @click="sys.toggleMicrophoneMute()">
                <MicOff v-if="sys.microphoneMuted" class="w-[18px] h-[18px]" />
                <Mic v-else class="w-[18px] h-[18px]" />
            </button>

            <button class="ctrl-btn" :class="{ 'ctrl-btn--active': sys.headphoneMuted }" @click="sys.toggleHeadphoneMute()">
                <HeadphoneOff v-if="sys.headphoneMuted" class="w-[18px] h-[18px]" />
                <Headphones v-else class="w-[18px] h-[18px]" />
            </button>

            <div class="ctrl-divider" />

            <button class="ctrl-btn" :class="{ 'ctrl-btn--active': voice.isSharing }" @click="toggleScreenCast" :disabled="!isConnected">
                <ScreenShareOff v-if="voice.isSharing" class="w-[18px] h-[18px]" />
                <ScreenShare v-else class="w-[18px] h-[18px]" />
            </button>

            <ScreenSharePicker ref="sharePicker" @start="goShare" />

            <button class="ctrl-btn" :class="{ 'ctrl-btn--active': voice.isCameraOn }" @click="voice.toggleCamera()" :disabled="!isConnected">
                <CameraOff v-if="voice.isCameraOn" class="w-[18px] h-[18px]" />
                <CameraIcon v-else class="w-[18px] h-[18px]" />
            </button>

            <button v-if="showPlayframe" class="ctrl-btn" :class="{ 'ctrl-btn--active': activity.isActive }" @click="activity.openPicker()" :disabled="!isConnected">
                <Gamepad2 class="w-[18px] h-[18px]" />
            </button>
        </div>
    </Transition>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useSystemStore } from "@/store/system/systemStore";
import { usePlayFrameActivity } from "@/store/features/playframeStore";
import ScreenSharePicker from "./ScreenSharePicker.vue";
import {
    Mic, MicOff, Headphones, HeadphoneOff,
    ScreenShare, ScreenShareOff, PhoneOffIcon,
    CameraIcon, CameraOff, Gamepad2,
} from "lucide-vue-next";

const voice = useUnifiedCall();
const sys = useSystemStore();
const activity = usePlayFrameActivity();

defineProps<{
    isConnected: boolean;
    isConnecting: boolean;
    showPlayframe?: boolean;
}>();

defineEmits<{
    (e: "hangup"): void;
}>();

const sharePicker = ref<InstanceType<typeof ScreenSharePicker> | null>(null);

const toggleScreenCast = () => {
    if (voice.isSharing) {
        voice.stopScreenShare();
    } else if (sharePicker.value) {
        sharePicker.value.open = true;
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
    if (voice.isSharing) {
        await voice.stopScreenShare();
        return;
    }
    await voice.startScreenShare(opts);
}
</script>

<style scoped>
.controls-block {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 10px 14px;
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
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
