<template>
    <div v-if="me.me" class="control-bar">
        <div class="controls">
            <button :disabled="!isConnected" @click="endActiveCall" class="active">
                <PhoneOffIcon class="w-5 h-5" />
            </button>

            <button @click="toggleMic" :class="{ active: isMicMuted }">
                <MicOff v-if="isMicMuted" class="w-5 h-5" />
                <Mic v-else class="w-5 h-5" />
            </button>

            <button @click="sys.toggleHeadphoneMute" :class="{ active: sys.headphoneMuted }">
                <HeadphoneOff v-if="sys.headphoneMuted" class="w-5 h-5" />
                <Headphones v-else class="w-5 h-5" />
            </button>

            <button @click="toggleScreenCast" :class="{ active: voice.isSharing }" :disabled="!isConnected">
                <ScreenShareOff v-if="voice.isSharing" class="w-5 h-5" />
                <ScreenShare v-else class="w-5 h-5" />
            </button>

            <ScreenSharePicker ref="sharePicker" @start="goShare" />

                <button @click="voice.toggleCamera()" :class="{ active: voice.isCameraOn }" :disabled="!isConnected">
                    <CameraOff v-if="voice.isCameraOn" class="w-5 h-5" />
                    <CameraIcon v-else class="w-5 h-5" />
                </button>

                <button v-if="playframeActive"
                    @click="activity.openPicker()" 
                    :disabled="!isConnected"
                    :class="{ active: activity.isActive }"
                    :title="isConnected ? 'Start Activity' : 'Join voice to start activity'"
                >
                    <Gamepad2 class="w-5 h-5" />
                </button>

                <button @click="toggleDoNotDistrurb">
                    <OctagonMinusIcon v-if="status == UserStatus.DoNotDisturb" class="w-5 h-5 text-red-600" />
                    <OctagonMinusIcon v-else class="w-5 h-5" />
                </button>
            </div>
    </div>
</template>

<script setup lang="ts">
import {
    Mic,
    MicOff,
    HeadphoneOff,
    Headphones,
    PhoneOffIcon,
    ScreenShareOff,
    ScreenShare,
    CameraIcon,
    CameraOff,
    OctagonMinusIcon,
    Gamepad2,
} from "lucide-vue-next";
import { useMe } from "@/store/auth/meStore";
import { useSystemStore } from "@/store/system/systemStore";
import { computed, ref, watch } from "vue";
import { useLocale } from "@/store/system/localeStore";
import { UserStatus } from "@argon/glue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useApi } from "@/store/system/apiStore";
import { usePlayFrameActivity } from "@/store/features/playframeStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import ScreenSharePicker from "./ScreenSharePicker.vue";

const voice = useUnifiedCall();
const api = useApi();
const activity = usePlayFrameActivity();
const { playframeActive } = useFeatureFlags();

const { t } = useLocale();
const me = useMe();
const sys = useSystemStore();

const sharePicker = ref<InstanceType<typeof ScreenSharePicker> | null>(null);

const status = ref(me.me?.currentStatus);
watch(status, (newStatus) => me.changeStatusTo(newStatus!));

const toggleDoNotDistrurb = () => {
    status.value =
        status.value === UserStatus.DoNotDisturb
            ? UserStatus.Online
            : UserStatus.DoNotDisturb;
};

const isConnected = computed(() => voice.isConnected);

const isMicMuted = computed(() => sys.microphoneMuted);

function toggleMic() {
    sys.toggleMicrophoneMute();
}

async function endActiveCall() {
    if (voice.mode === "dm" && voice.callId) {
        try {
            await api.callInteraction.HangupCall(voice.callId);
        } catch (e) {
            console.warn("HangupCall failed", e);
        }
    }
    await voice.leave();
}

const toggleScreenCast = () => {
    if (!isConnected.value) return;

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
    if (!isConnected.value) return;

    if (voice.isSharing) {
        await voice.stopScreenShare();
        return;
    }

    await voice.startScreenShare(opts);
}
</script>

<style scoped>
.control-bar {
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    padding: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.controls {
    justify-content: center;
    display: flex;
    gap: 6px;
    flex: auto;
}

.controls button {
    background: none;
    border: none;
    color: hsl(var(--foreground));
    font-size: 16px;
    cursor: pointer;
    transition: color 0.2s;
    padding: 5px;
}

.controls button:hover {
    color: hsl(var(--primary));
}

.controls button.active {
    color: hsl(var(--destructive));
}

.controls button:disabled {
    color: hsl(var(--muted-foreground) / 0.35);
    cursor: not-allowed;
}
</style>