<template>
    <div class="flex flex-col h-full gap-3">
    <div ref="mediaChannelContainer" class="media-channel flex flex-col flex-1 min-h-0 transition-all duration-300 relative">
        <!-- Top Info Overlay (hidden while a game occupies the channel in-place,
             to avoid overlapping the PlayFrame panel header) -->
        <div v-show="!activity.isActive || activity.isPopout" class="media-info-bar">
            <div class="info-pill channel-title" :title="channelName">
                <Volume2 class="w-3.5 h-3.5 shrink-0" />
                <span class="channel-title-name">{{ channelName }}</span>
            </div>
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
            <!-- Activity Mode: Game stage + participants strip below -->
            <div v-if="playframeActive && activity.isActive" class="activity-mode">
                <div class="activity-stage">
                    <!-- PlayFramePanel teleports out to the overlay when popped -->
                    <PlayFramePanel />
                    <div v-if="activity.isPopout" class="popout-placeholder">
                        <Gamepad2 class="w-8 h-8" />
                        <span>{{ activity.currentGame?.title }} — playing in popout</span>
                        <button class="dock-btn" @click="activity.togglePopout()">Bring back</button>
                    </div>
                </div>

                <div ref="activityStripArea" class="flex flex-row gap-2 overflow-x-auto overflow-y-hidden w-full shrink-0" style="height: 6.5rem;">
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
                        :custom-style="tileStyle(activityStrip)"
                        name-class="text-xs"
                        icon-position="top-1 right-1"
                        @video-ref="setVideoRef" />
                </div>
            </div>

            <!-- Empty state: no one in the channel -->
            <div v-else-if="allUsers.length === 0" class="empty-state">
                <div class="empty-state-icon">
                    <Users2 class="w-10 h-10" />
                </div>
                <span class="empty-state-title">{{ t("empty_channel") }}</span>
                <span class="empty-state-sub">{{ t("empty_channel_hint") }}</span>
            </div>

            <!-- Normal Voice Channel View -->
            <Transition v-else name="stream-layout" mode="out-in">
                <!-- Stream Mode: Main video + horizontal thumbnails -->
                <div v-if="hasActiveStream && mainStreamer" key="stream-mode" class="flex flex-col gap-3 flex-1 min-h-0">
                    <div ref="mainArea" class="flex-1 min-h-0 w-full flex items-center justify-center">
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
                            :custom-style="tileStyle(mainTile)"
                            name-class="text-base"
                            :centered="false"
                            video-fit="contain"
                            icon-position="top-2 left-2"
                            @video-ref="setVideoRef" />
                    </div>

                    <div v-if="stripCount > 0" ref="stripArea" class="flex flex-row gap-3 overflow-x-auto overflow-y-hidden w-full shrink-0" style="height: clamp(6rem, 18%, 11rem);">
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
                            :custom-style="tileStyle(strip)"
                            name-class="text-xs"
                            icon-position="top-1 right-1"
                            @click="toggleFocus"
                            @video-ref="setVideoRef" />
                        <ActivityCard
                            v-for="a in activityTiles"
                            :key="a.sessionId"
                            :presence="a"
                            class-name="flex-shrink-0"
                            :custom-style="tileStyle(strip)" />
                    </div>
                </div>

                <!-- Grid Mode: fluid 16:9 tiles that fill the area for any count -->
                <div v-else key="grid-mode" ref="gridArea"
                    class="flex-1 w-full min-h-0 flex flex-wrap gap-4 items-center justify-center content-center overflow-y-auto">
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
                        :custom-style="tileStyle(grid)"
                        @click="toggleFocus"
                        @video-ref="setVideoRef" />
                    <ActivityCard
                        v-for="a in activityTiles"
                        :key="a.sessionId"
                        :presence="a"
                        class-name="flex-shrink-0"
                        :custom-style="tileStyle(grid)" />
                </div>
            </Transition>
        </div>
    </div>

        <!-- Controls Block -->
        <MediaControls
            :is-connected="isConnected"
            :is-connecting="isConnecting"
            :show-playframe="playframeActive"
            @hangup="endActiveCall"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import type { Guid } from "@argon-chat/ion.webcore";
import ParticipantCard from "./home/views/ParticipantCard.vue";
import { useResponsiveGrid } from "@/composables/useResponsiveGrid";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { usePlayFrameActivity } from "@/store/features/playframeStore";
import { useLocale } from "@/store/system/localeStore";
import { useMediaLayout } from "@/composables/useMediaLayout";
import PlayFramePanel from "./playframe/PlayFramePanel.vue";
import ActivityCard from "./playframe/ActivityCard.vue";
import PingDetailsPopup from "./PingDetailsPopup.vue";
import MediaControls from "./MediaControls.vue";
import {
    Signal, Users2, Volume2, Gamepad2,
} from "lucide-vue-next";

const voice = useUnifiedCall();
const api = useApi();
const pool = usePoolStore();
const { playframeActive } = useFeatureFlags();
const activity = usePlayFrameActivity();
const { t } = useLocale();

const selectedChannelId = defineModel<string | null>("selectedChannelId", { type: String, required: true });

// Channel name for the header (follows the selected voice channel).
const channelName = ref("");
watch(selectedChannelId, async (id) => {
    channelName.value = id ? (await pool.getChannel(id))?.name ?? "" : "";
}, { immediate: true });

const videoRefs = ref<Map<Guid, HTMLVideoElement>>(new Map());
const mediaChannelContainer = ref<HTMLElement | null>(null);
const openPingDetails = ref(false);

const {
    allUsers,
    mainStreamer,
    otherUsers,
    hasActiveStream,
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

// Activities others started (shown as grid tiles until you join one).
const activityTiles = computed(() =>
    playframeActive && !activity.isActive ? activity.joinableActivities : [],
);
// --- Fluid tile sizing: measure each region and let the solver pick the
// optimal column count for a 16:9 grid that fills the space without overflow. ---
const gridArea = ref<HTMLElement | null>(null);
const stripArea = ref<HTMLElement | null>(null);
const mainArea = ref<HTMLElement | null>(null);
const activityStripArea = ref<HTMLElement | null>(null);
const { width: gW, height: gH } = useElementSize(gridArea);
const { width: sW, height: sH } = useElementSize(stripArea);
const { width: mW, height: mH } = useElementSize(mainArea);
const { width: aW, height: aH } = useElementSize(activityStripArea);

// Participant tiles + activity tiles drive the grid; only non-main tiles fill the strip.
const gridCount = computed(() => allUsers.value.length + activityTiles.value.length);
const stripCount = computed(() => otherUsers.value.length + activityTiles.value.length);

const grid = useResponsiveGrid({ width: gW, height: gH, count: gridCount, gap: 16, maxTileWidth: 720, minTileWidth: 150 });
const strip = useResponsiveGrid({ width: sW, height: sH, count: stripCount, gap: 12, singleRow: true });
const mainTile = useResponsiveGrid({ width: mW, height: mH, count: 1 });
const activityStrip = useResponsiveGrid({ width: aW, height: aH, count: () => allUsers.value.length, gap: 8, singleRow: true });

const tileStyle = (g: { tileWidth: number; tileHeight: number }) => ({
    width: g.tileWidth ? `${g.tileWidth}px` : undefined,
    height: g.tileHeight ? `${g.tileHeight}px` : undefined,
    aspectRatio: "16 / 9",
    flex: "0 0 auto",
});

const isConnected = computed(() => voice.isConnected);
const isConnecting = computed(() => voice.isConnecting);

async function endActiveCall() {
    if (voice.mode === "dm" && voice.callId) {
        try { await api.callInteraction.HangupCall(voice.callId); } catch {}
    }
    await voice.leave();
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
    border-radius: var(--radius);
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

/* Activity (PlayFrame) mode */
.activity-mode {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: 0.5rem;
}

.activity-stage {
    position: relative;
    flex: 1;
    min-height: 0;
}

.popout-placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px dashed hsl(var(--border));
    border-radius: var(--radius);
    background: hsl(var(--muted) / 0.3);
    color: hsl(var(--muted-foreground));
    font-size: 13px;
}

.dock-btn {
    padding: 6px 14px;
    border-radius: calc(var(--radius) - 4px);
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
}

.dock-btn:hover {
    opacity: 0.9;
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
    border-radius: calc(var(--radius) - 4px);
    background: hsl(var(--card) / 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid hsl(var(--border) / 0.3);
    color: hsl(var(--muted-foreground));
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
}

.channel-title {
    color: hsl(var(--foreground));
    font-weight: 600;
    max-width: 240px;
}

.channel-title-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

