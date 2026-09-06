<template>
    <div ref="mediaChannelContainer" class="media-channel flex flex-col h-full min-h-0 overflow-hidden transition-all duration-300 relative">
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
                        v-bind="tileProps(userId, 'camera')"
                        @toggle-pin="toggleFocus"
                        @set-video-hidden="setVideoHidden"
                        @set-video-quality="setVideoQuality"
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
                <EmptyStateArt name="no-one-here" :size="164" />
                <span class="empty-state-title">{{ t("empty_channel") }}</span>
                <span class="empty-state-sub">{{ t("empty_channel_hint") }}</span>
            </div>

            <!-- Participants: the shared stage picks grid or main+strip. -->
            <CallGrid v-else :layout="layout" :activities="activityTiles" />
        </div>

        <!-- Controls Block: inside the card, under the stage — same placement as a DM call -->
        <MediaControls
            class="mx-3 mb-3"
            :is-connected="isConnected"
            :is-connecting="isConnecting"
            :show-playframe="playframeActive"
            @hangup="endActiveCall"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useElementSize } from "@vueuse/core";
import ParticipantCard from "./home/views/ParticipantCard.vue";
import CallGrid from "./calls/CallGrid.vue";
import { useResponsiveGrid, tileStyle } from "@/composables/useResponsiveGrid";
import { useVideoTrackAttach } from "@/composables/useVideoTrackAttach";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { usePlayFrameActivity } from "@/store/features/playframeStore";
import { useLocale } from "@/store/system/localeStore";
import { useMediaLayout } from "@/composables/useMediaLayout";
import PlayFramePanel from "./playframe/PlayFramePanel.vue";
import PingDetailsPopup from "./PingDetailsPopup.vue";
import MediaControls from "./MediaControls.vue";
import EmptyStateArt from "./shared/EmptyStateArt.vue";
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

const mediaChannelContainer = ref<HTMLElement | null>(null);
const openPingDetails = ref(false);

// One layout for the whole view: the header pills, the game-mode strip and the
// CallGrid stage all read the same participant list and focus state.
const layout = useMediaLayout(() => selectedChannelId.value);
const {
    allUsers,
    isSpeaking,
    hasVideo,
    tileProps,
    setVideoHidden,
    setVideoQuality,
    isScreenSharing,
    isMuted,
    isHeadphoneMuted,
    isPlayingActivity,
    toggleFocus,
    qualityConnection,
} = layout;
const { setVideoRef } = useVideoTrackAttach();

// Activities others started (shown as grid tiles until you join one).
const activityTiles = computed(() =>
    playframeActive && !activity.isActive ? activity.joinableActivities : [],
);

// Game mode keeps its own participant strip under the stage; it is measured and solved
// here the same way CallGrid sizes its regions.
const activityStripArea = ref<HTMLElement | null>(null);
const { width: aW, height: aH } = useElementSize(activityStripArea);
const activityStrip = useResponsiveGrid({ width: aW, height: aH, count: () => allUsers.value.length, gap: 8, singleRow: true });

const isConnected = computed(() => voice.isConnected);
const isConnecting = computed(() => voice.isConnecting);

async function endActiveCall() {
    if (voice.mode === "dm" && voice.callId) {
        try { await api.callInteraction.HangupCall(voice.callId); } catch {}
    }
    await voice.leave();
}
</script>

<style scoped>
.media-channel {
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: var(--radius);
    background: hsl(var(--card) / 0.5);
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
</style>

