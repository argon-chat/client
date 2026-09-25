<template>
    <div v-if="me.me" class="control-bar">
        <div class="controls">
            <button :disabled="!isConnected" @click="endActiveCall" class="active icon-motion icon-motion--lift">
                <PhoneOffIcon class="w-5 h-5" />
            </button>

            <button @click="toggleMic" class="icon-motion icon-motion--lift"
                :class="{ active: isMicMuted, locked: sys.microphoneLocked, forbidden: !sys.microphoneLocked && !canSpeak }"
                :aria-disabled="micLocked || undefined"
                :title="micLockReason">
                <span class="relative inline-flex">
                    <MicOff v-if="isMicMuted" class="w-5 h-5 icon-appear" />
                    <Mic v-else class="w-5 h-5 icon-appear" />
                    <ShieldIcon v-if="sys.microphoneLocked" class="lock-badge" />
                    <LockIcon v-else-if="!canSpeak" class="lock-badge lock-badge--muted" />
                </span>
            </button>

            <button @click="toggleHeadphones" class="icon-motion icon-motion--lift"
                :class="{ active: sys.headphoneMuted, locked: sys.headphonesLocked }"
                :aria-disabled="sys.headphonesLocked || undefined"
                :title="sys.headphonesLocked ? t('voice_member_server_deafened') : undefined">
                <span class="relative inline-flex">
                    <HeadphoneOff v-if="sys.headphoneMuted" class="w-5 h-5 icon-appear" />
                    <Headphones v-else class="w-5 h-5 icon-appear" />
                    <ShieldIcon v-if="sys.headphonesLocked" class="lock-badge" />
                </span>
            </button>

            <button @click="toggleScreenCast" class="icon-motion icon-motion--lift"
                :class="{ active: voice.isSharing, forbidden: !canStream }" :disabled="!isConnected"
                :aria-disabled="!canStream || undefined"
                :title="canStream ? undefined : t('voice_no_stream_permission')">
                <span class="relative inline-flex">
                    <ScreenShareOff v-if="voice.isSharing" class="w-5 h-5 icon-appear" />
                    <ScreenShare v-else class="w-5 h-5 icon-appear" />
                    <LockIcon v-if="!canStream" class="lock-badge lock-badge--muted" />
                </span>
            </button>

            <ScreenSharePicker ref="sharePicker" @start="goShare" />

                <button @click="toggleCamera" class="icon-motion icon-motion--lift"
                    :class="{ active: voice.isCameraOn, forbidden: !canVideo }" :disabled="!isConnected"
                    :aria-disabled="!canVideo || undefined"
                    :title="canVideo ? undefined : t('voice_no_video_permission')">
                    <span class="relative inline-flex">
                        <CameraOff v-if="voice.isCameraOn" class="w-5 h-5 icon-appear" />
                        <CameraIcon v-else class="w-5 h-5 icon-appear" />
                        <LockIcon v-if="!canVideo" class="lock-badge lock-badge--muted" />
                    </span>
                </button>

                <button v-if="playframeActive"
                    class="icon-motion icon-motion--lift"
                    @click="activity.openPicker()" 
                    :disabled="!isConnected"
                    :class="{ active: activity.isActive }"
                    :title="isConnected ? 'Start Activity' : 'Join voice to start activity'"
                >
                    <Gamepad2 class="w-5 h-5" />
                </button>

                <button @click="toggleDoNotDistrurb" class="icon-motion icon-motion--lift">
                    <OctagonMinusIcon v-if="status == UserStatus.DoNotDisturb" class="w-5 h-5 text-red-600 icon-appear" />
                    <OctagonMinusIcon v-else class="w-5 h-5 icon-appear" />
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
    ShieldIcon,
    LockIcon,
} from "lucide-vue-next";
import { useCallPermissions } from "@/composables/useCallPermissions";
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

const { canSpeak, canVideo, canStream } = useCallPermissions();

// Locked while a moderator holds the mute/deafen, or when the channel does not let us speak.
const micLocked = computed(() => sys.microphoneLocked || !canSpeak.value);
const micLockReason = computed(() => {
    if (sys.microphoneLocked) return t('voice_member_server_muted');
    return canSpeak.value ? undefined : t('voice_no_speak_permission');
});

function toggleMic() {
    if (micLocked.value) return;
    sys.toggleMicrophoneMute();
}

// Turning it off is always allowed: the right may have been taken away while it was on.
function toggleCamera() {
    if (!voice.isCameraOn && !canVideo.value) return;
    voice.toggleCamera();
}

function toggleHeadphones() {
    if (sys.headphonesLocked) return;
    sys.toggleHeadphoneMute();
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
    } else if (sharePicker.value && canStream.value) {
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
    background-color: hsl(var(--card) / var(--card-alpha));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: var(--radius);
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

/* Held by a moderator: still red, but visibly not the user's to change. */
.controls button.locked,
.controls button.locked:hover {
    color: hsl(0 84% 55%);
    cursor: not-allowed;
}

/* Not granted in this channel: greyed rather than red. */
.controls button.forbidden,
.controls button.forbidden:hover {
    color: hsl(var(--muted-foreground) / 0.55);
    cursor: not-allowed;
}

.lock-badge {
    position: absolute;
    right: -4px;
    bottom: -4px;
    width: 11px;
    height: 11px;
    color: hsl(0 84% 55%);
    fill: hsl(var(--card));
    stroke-width: 3;
}

.lock-badge--muted {
    color: hsl(var(--muted-foreground));
}
</style>