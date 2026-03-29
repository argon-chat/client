<template>
    <div class="flex flex-col h-full gap-3">
    <div ref="mediaChannelContainer" class="media-channel flex flex-col flex-1 min-h-0 transition-all duration-300 relative">
        <!-- Top Info Overlay -->
        <div class="media-info-bar">
            <div class="info-pill">
                <Users2 class="w-3.5 h-3.5" />
                <span>{{ allUsers.length }}</span>
            </div>
            <div v-if="isConnected" class="info-pill" :class="'quality-' + qualityConnection.toLowerCase()">
                <Signal class="w-3.5 h-3.5" />
            </div>
        </div>

        <!-- Content area -->
        <div class="media-content">
            <!-- Activity Mode: Game + participants below -->
            <template v-if="activity.isActive">
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
                        :is-screen-sharing="mainStreamer.isScreenShare"
                        :has-video="hasVideo(mainStreamer.User.userId)"
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

                <button class="ctrl-btn" disabled>
                    <CameraIcon class="w-[18px] h-[18px]" />
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
import { IRealtimeChannelUserWithData, usePoolStore } from "@/store/poolStore";
import type { Guid } from "@argon-chat/ion.webcore";
import ParticipantCard from "./home/views/ParticipantCard.vue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import { useSystemStore } from "@/store/systemStore";
import { useMe } from "@/store/meStore";
import { useApi } from "@/store/apiStore";
import { usePlayFrameActivity } from "@/store/playframeStore";
import { useFeatureFlags } from "@/store/featureFlagsStore";
import PlayFramePanel from "./playframe/PlayFramePanel.vue";
import {
    Mic, MicOff, Headphones, HeadphoneOff,
    ScreenShare, ScreenShareOff, PhoneOffIcon,
    CameraIcon, Gamepad2, Signal, Users2,
} from "lucide-vue-next";

const pool = usePoolStore();
const voice = useUnifiedCall();
const sys = useSystemStore();
const me = useMe();
const api = useApi();
const activity = usePlayFrameActivity();
const { playframeActive } = useFeatureFlags();

const selectedChannelId = defineModel<string | null>("selectedChannelId", { type: String, required: true });

const videoRefs = ref<Map<Guid, HTMLVideoElement>>(new Map());
const focusedUserId = ref<Guid | null>(null);
const mediaChannelContainer = ref<HTMLElement | null>(null);

// Computed properties
const users = computed(() => {
    const ch = selectedChannelId.value ? pool.realtimeChannelUsers.get(selectedChannelId.value) : null;
    return ch?.Users ?? new Map<Guid, IRealtimeChannelUserWithData>();
});

const allUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() =>
    Array.from(users.value as Map<Guid, IRealtimeChannelUserWithData>)
);

const mainStreamer = computed<IRealtimeChannelUserWithData | null>(() => {
    // Priority: focusedUserId -> screencast -> first video
    if (focusedUserId.value) {
        const user = users.value.get(focusedUserId.value);
        if (user) return user as IRealtimeChannelUserWithData;
    }
    
    for (const [userId, user] of users.value) {
        if (user.isScreenShare) return user as IRealtimeChannelUserWithData;
    }
    
    for (const [userId] of voice.videoTracks) {
        const user = users.value.get(userId);
        if (user) return user as IRealtimeChannelUserWithData;
    }
    
    return null;
});

const otherUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() => {
    if (!mainStreamer.value) return allUsers.value;
    const mainId = mainStreamer.value.User.userId;
    return allUsers.value.filter(([id]) => id !== mainId);
});

const hasActiveStream = computed(() => !!mainStreamer.value);

const gridClasses = computed(() => ({
    'grid-cols-1': allUsers.value.length === 1,
    'grid-cols-2': allUsers.value.length >= 3 && allUsers.value.length <= 4,
    'grid-cols-3': allUsers.value.length > 4
}));

const gridCardStyle = (userCount: number) => ({
    aspectRatio: '16/9',
    maxHeight: userCount === 1 ? '25rem' : '19rem',
    minWidth: userCount === 1 ? '28rem' : '20rem',
    minHeight: userCount === 1 ? '15.75rem' : '11.25rem'
});

const muteStates = computed(() => {
    const states = new Map<Guid, { muted: boolean; headphoneMuted: boolean }>();
    
    const myId = me.me?.userId;
    
    // Explicitly read reactive values to ensure Vue tracks them
    const sysMicMuted = sys.microphoneMuted;
    const sysHeadMuted = sys.headphoneMuted;
    
    // First, add local participant with sys values (like in ChatPanel)
    if (myId) {
        states.set(myId, {
            muted: sysMicMuted,
            headphoneMuted: sysHeadMuted
        });
    }
    
    // Then add all remote participants from voice.participants
    for (const uid of Object.keys(voice.participants)) {
        // Skip if already added as local user
        if (uid === myId) continue;
        
        const participant = voice.participants[uid];
        states.set(uid, {
            muted: participant.muted,   
            headphoneMuted: participant.mutedAll
        });
    }
    
    return states;
});

const isSpeaking = (uid: Guid) => {
    // Explicitly track speaking.size to ensure Vue detects changes in the Set
    const _ = voice.speaking.size;
    return voice.speaking.has(uid);
};
const hasVideo = (uid: Guid) => voice.videoTracks.has(uid);

const isMuted = (uid: Guid) => {
    return muteStates.value.get(uid)?.muted ?? false;
};

const isHeadphoneMuted = (uid: Guid) => {
    return muteStates.value.get(uid)?.headphoneMuted ?? false;
};

const isPlayingActivity = (uid: Guid) => {
    if (!activity.isActive) return false;
    // Check if user is in activity participants
    return activity.participants.some(p => p.displayName === users.value.get(uid)?.User.displayName);
};

const toggleFocus = (userId: Guid) => {
    focusedUserId.value = focusedUserId.value === userId ? null : userId;
};

// Connection state
const isConnected = computed(() => voice.isConnected);
const isConnecting = computed(() => voice.isConnecting);

const qualityConnection = computed<"NONE" | "GREEN" | "ORANGE" | "RED">(() => {
    if (!isConnected.value) return "NONE";
    const ms = parseInt(String(voice.ping).replace("ms", "").trim(), 10);
    if (!ms || ms <= 0) return "NONE";
    if (ms < 50) return "GREEN";
    if (ms < 100) return "ORANGE";
    return "RED";
});

// Control actions
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
    } else {
        voice.startScreenShare({ deviceId: null, systemAudio: "exclude" });
    }
};

const setVideoRef = (el: Element | null | any, userId: Guid) => {
    if (el instanceof HTMLVideoElement) {
        videoRefs.value.set(userId, el);
        const track = voice.videoTracks.get(userId);
        if (track) track.attach(el);
    } else if (el === null) {
        const oldEl = videoRefs.value.get(userId);
        if (oldEl) {
            const track = voice.videoTracks.get(userId);
            if (track) track.detach(oldEl);
        }
        videoRefs.value.delete(userId);
    }
};

// Cleanup
onUnmounted(() => {
    voice.videoTracks.forEach((track, userId) => {
        const el = videoRefs.value.get(userId);
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

