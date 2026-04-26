<template>
    <div class="flex flex-col h-full gap-3">
    <div ref="mediaChannelContainer" class="media-channel flex flex-col flex-1 min-h-0 transition-all duration-300 relative">
        <!-- Top Info Overlay -->
        <div class="media-info-bar">
            <div class="info-pill">
                <Users2 class="w-3.5 h-3.5" />
                <span>{{ allUsers.length }}</span>
            </div>
            <div v-if="isConnected" class="info-pill info-pill--clickable ping-pill-wrapper" :class="'quality-' + qualityConnection.toLowerCase()" @click.stop="openPingDetails = !openPingDetails">
                <Signal class="w-3.5 h-3.5" />
                <PingDetailsPopup
                    :is-open="openPingDetails"
                    :current-ping="voice.ping"
                    :average-ping="voice.averagePing"
                    :ping-history="voice.pingHistory"
                    :quality-connection="qualityConnection"
                />
            </div>
        </div>

        <!-- Content area -->
        <div class="media-content">
            <!-- Empty state: no one in the channel -->
            <div v-if="allUsers.length === 0" class="empty-state">
                <div class="empty-state-icon">
                    <Users2 class="w-10 h-10" />
                </div>
                <span class="empty-state-title">{{ t("empty_channel") }}</span>
                <span class="empty-state-sub">{{ t("empty_channel_hint") }}</span>
            </div>

            <!-- Activity Mode: Game + participants below -->
            <template v-else-if="activity.isActive">
                <PlayFramePanel class="flex-1 min-h-0" />
                
                <div class="flex flex-row gap-2 overflow-x-auto w-full shrink-0" style="max-height: 8rem;">
                    <ParticipantCard
                        v-for="[userId, user] in allUsers"
                        :key="userId"
                        :user-id="userId"
                        :display-name="user.User.displayName"
                        :is-speaking="isSpeaking(userId)"
                        :is-muted="isMuted(userId)"
                        :is-headphone-muted="isHeadphoneMuted(userId)"
                        :has-video="hasVideo(userId)"
                        :video-source="getPreferredSource(userId, 'camera')"
                        :is-screen-sharing="isScreenSharing(userId)"
                        :is-playing="isPlayingActivity(userId)"
                        :avatar-size="60"
                        :icon-size="16"
                        class-name="flex-shrink-0"
                        :custom-style="{ width: '10rem', height: '6rem' }"
                        name-class="text-xs"
                        icon-position="top-1 right-1"
                        @video-ref="setVideoRef" />
                </div>
            </template>
            
            <!-- Normal Voice Channel View -->
            <Transition v-else name="stream-layout" mode="out-in">
                <!-- Stream Mode: Main video + horizontal thumbnails -->
                <div v-if="hasActiveStream && mainStreamer" key="stream-mode" class="flex flex-col gap-3 flex-1 min-h-0 items-center justify-center">
                    <ParticipantCard
                        :user-id="mainStreamer.User.userId"
                        :display-name="mainStreamer.User.displayName"
                        :is-speaking="isSpeaking(mainStreamer.User.userId)"
                        :is-muted="isMuted(mainStreamer.User.userId)"
                        :is-headphone-muted="isHeadphoneMuted(mainStreamer.User.userId)"
                        :is-screen-sharing="isScreenSharing(mainStreamer.User.userId)"
                        :has-video="hasVideo(mainStreamer.User.userId)"
                        :video-source="getPreferredSource(mainStreamer.User.userId, 'screen_share')"
                        :avatar-size="180"
                        class="flex-1 min-h-0"
                        :custom-style="{ maxWidth: '100%', width: '100%' }"
                        name-class="text-base"
                        :centered="false"
                        icon-position="top-2 left-2"
                        @video-ref="setVideoRef" />

                    <div class="flex flex-row gap-3 overflow-x-auto w-full" style="max-height: 10rem;">
                        <ParticipantCard
                            v-for="[userId, user] in otherUsers"
                            :key="userId"
                            :user-id="userId"
                            :display-name="user.User.displayName"
                            :is-speaking="isSpeaking(userId)"
                            :is-muted="isMuted(userId)"
                            :is-headphone-muted="isHeadphoneMuted(userId)"
                            :has-video="hasVideo(userId)"
                            :video-source="getPreferredSource(userId, 'camera')"
                            :is-screen-sharing="isScreenSharing(userId)"
                            :avatar-size="90"
                            :icon-size="18"
                            class-name="flex-shrink-0"
                            :custom-style="{ width: '15rem', height: '8.5rem' }"
                            name-class="text-xs"
                            icon-position="top-1 right-1"
                            @click="toggleFocus"
                            @video-ref="setVideoRef" />
                    </div>
                </div>

                <!-- Grid Mode: All users in grid or vertical layout -->
                <div v-else key="grid-mode" class="flex-1 flex items-center justify-center">
                    <!-- 2 Users: Vertical Stack -->
                    <div v-if="allUsers.length === 2" class="flex gap-6 items-center justify-center" style="flex-direction: column;">
                        <ParticipantCard
                            v-for="[userId, user] in allUsers"
                            :key="userId"
                            :user-id="userId"
                            :display-name="user.User.displayName"
                            :is-speaking="isSpeaking(userId)"
                            :is-muted="isMuted(userId)"
                            :is-headphone-muted="isHeadphoneMuted(userId)"
                            :has-video="hasVideo(userId)"
                            :video-source="getPreferredSource(userId, 'camera')"
                            :is-screen-sharing="isScreenSharing(userId)"
                            class-name="flex-shrink-0"
                            :custom-style="{ width: '40rem', minWidth: '40rem', aspectRatio: '16/9' }"
                            @click="toggleFocus"
                            @video-ref="setVideoRef" />
                    </div>

                    <!-- Other: Grid Layout -->
                    <div v-else class="grid gap-4 place-items-center place-content-center" 
                        style="grid-auto-rows: minmax(min-content, max-content);"
                        :class="gridClasses">
                        <ParticipantCard
                            v-for="[userId, user] in allUsers"
                            :key="userId"
                            :user-id="userId"
                            :display-name="user.User.displayName"
                            :is-speaking="isSpeaking(userId)"
                            :is-muted="isMuted(userId)"
                            :is-headphone-muted="isHeadphoneMuted(userId)"
                            :has-video="hasVideo(userId)"
                            :video-source="getPreferredSource(userId, 'camera')"
                            :is-screen-sharing="isScreenSharing(userId)"
                            class-name="w-full"
                            :custom-style="gridCardStyle(allUsers.length)"
                            @click="toggleFocus"
                            @video-ref="setVideoRef" />
                    </div>
                </div>
            </Transition>
        </div>
    </div>

        <!-- Controls Block -->
        <Transition name="controls-reveal">
            <div v-if="isConnected || isConnecting" class="controls-block">
                <button class="ctrl-btn ctrl-btn--danger" @click="endActiveCall" :disabled="!isConnected">
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

                <button v-if="playframeActive" class="ctrl-btn" :class="{ 'ctrl-btn--active': activity.isActive }" @click="activity.openPicker()" :disabled="!isConnected">
                    <Gamepad2 class="w-[18px] h-[18px]" />
                </button>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import ParticipantCard from "./home/views/ParticipantCard.vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useSystemStore } from "@/store/system/systemStore";
import { useApi } from "@/store/system/apiStore";
import { usePlayFrameActivity } from "@/store/features/playframeStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { useLocale } from "@/store/system/localeStore";
import { useMediaLayout } from "@/composables/useMediaLayout";
import PlayFramePanel from "./playframe/PlayFramePanel.vue";
import PingDetailsPopup from "./PingDetailsPopup.vue";
import ScreenSharePicker from "./ScreenSharePicker.vue";
import {
    Mic, MicOff, Headphones, HeadphoneOff,
    ScreenShare, ScreenShareOff, PhoneOffIcon,
    CameraIcon, CameraOff, Gamepad2, Signal, Users2,
} from "lucide-vue-next";

const voice = useUnifiedCall();
const sys = useSystemStore();
const api = useApi();
const activity = usePlayFrameActivity();
const { playframeActive } = useFeatureFlags();
const { t } = useLocale();

const selectedChannelId = defineModel<string | null>("selectedChannelId", { type: String, required: true });

const videoRefs = ref<Map<Guid, HTMLVideoElement>>(new Map());
const mediaChannelContainer = ref<HTMLElement | null>(null);
const openPingDetails = ref(false);
const sharePicker = ref<InstanceType<typeof ScreenSharePicker> | null>(null);

const {
    allUsers,
    mainStreamer,
    otherUsers,
    hasActiveStream,
    gridClasses,
    gridCardStyle,
    isSpeaking,
    hasVideo,
    getPreferredSource,
    isScreenSharing,
    isMuted,
    isHeadphoneMuted,
    isPlayingActivity,
    toggleFocus,
    qualityConnection,
} = useMediaLayout(() => selectedChannelId.value);

const isConnected = computed(() => voice.isConnected);
const isConnecting = computed(() => voice.isConnecting);

async function endActiveCall() {
    if (voice.mode === "dm" && voice.callId) {
        try { await api.callInteraction.HangupCall(voice.callId); } catch {}
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

const setVideoRef = (el: Element | null | any, userId: Guid, source: string = 'camera') => {
    const trackKey = voice.videoTrackKey(userId, source);
    const refKey = trackKey;

    if (el instanceof HTMLVideoElement) {
        videoRefs.value.set(refKey, el);
        const track = voice.videoTracks.get(trackKey);
        if (track) track.attach(el);
    } else if (el === null) {
        const oldEl = videoRefs.value.get(refKey);
        if (oldEl) {
            const track = voice.videoTracks.get(trackKey);
            if (track) track.detach(oldEl);
        }
        videoRefs.value.delete(refKey);
    }
};

onUnmounted(() => {
    voice.videoTracks.forEach((track, key) => {
        const el = videoRefs.value.get(key);
        if (track && el) track.detach(el);
    });
    videoRefs.value.clear();
});
</script>

<style scoped>
.media-channel {
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    background: hsl(var(--card) / 0.6);
    backdrop-filter: blur(8px);
}

.media-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 1rem;
    gap: 0.75rem;
}

/* Empty state */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 8px;
    user-select: none;
}

.empty-state-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: hsl(var(--muted) / 0.5);
    color: hsl(var(--muted-foreground) / 0.5);
    margin-bottom: 4px;
}

.empty-state-title {
    font-size: 15px;
    font-weight: 600;
    color: hsl(var(--foreground) / 0.6);
}

.empty-state-sub {
    font-size: 12px;
    color: hsl(var(--muted-foreground) / 0.6);
    text-align: center;
    max-width: 220px;
    line-height: 1.4;
}

/* Top info bar */
.media-info-bar {
    position: absolute;
    top: 10px;
    left: 12px;
    display: flex;
    gap: 6px;
    z-index: 10;
}

.info-pill {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 8px;
    background: hsl(var(--card) / 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid hsl(var(--border) / 0.3);
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
}

.info-pill--clickable {
    cursor: pointer;
    transition: background 0.15s ease;
}

.info-pill--clickable:hover {
    background: hsl(var(--card));
}

.ping-pill-wrapper {
    position: relative;
}

.ping-pill-wrapper :deep(.ping-popup) {
    bottom: auto;
    top: calc(100% + 8px);
    left: 0;
    transform: none;
}

.info-pill.quality-green { color: #22c55e; }
.info-pill.quality-orange { color: #f97316; }
.info-pill.quality-red { color: #ef4444; }
.info-pill.quality-none { color: hsl(var(--muted-foreground)); }

/* Controls block — separate card */
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

/* Stream layout transition */
.stream-layout-enter-active,
.stream-layout-leave-active {
    transition: all 0.25s ease-in-out;
}

.stream-layout-enter-from {
    opacity: 0;
    transform: translateY(-20px) scale(0.95);
}

.stream-layout-leave-to {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
}

.stream-layout-enter-to,
.stream-layout-leave-from {
    opacity: 1;
    transform: translateY(0) scale(1);
}
</style>

