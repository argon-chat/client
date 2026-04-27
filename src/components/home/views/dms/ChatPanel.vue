<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import ParticipantCard from "@/components/home/views/ParticipantCard.vue";
import MediaControls from "@/components/MediaControls.vue";
import PingDetailsPopup from "@/components/PingDetailsPopup.vue";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useMediaLayout } from "@/composables/useMediaLayout";
import { Signal, Users2 } from "lucide-vue-next";

const emit = defineEmits<{ (e: "end"): void }>();

const voice = useUnifiedCall();

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
    toggleFocus,
    qualityConnection,
} = useMediaLayout(() => null, "dm");

const isConnected = computed(() => voice.isConnected);
const isConnecting = computed(() => voice.isConnecting);

const videoRefs = ref<Map<Guid, HTMLVideoElement>>(new Map());
const openPingDetails = ref(false);

const setVideoRef = (el: Element | null | any, userId: Guid, source: string = 'camera') => {
    const trackKey = voice.videoTrackKey(userId, source);

    if (el instanceof HTMLVideoElement) {
        videoRefs.value.set(trackKey, el);
        const track = voice.videoTracks.get(trackKey);
        if (track) track.attach(el);
    } else if (el === null) {
        const oldEl = videoRefs.value.get(trackKey);
        if (oldEl) {
            const track = voice.videoTracks.get(trackKey);
            if (track) track.detach(oldEl);
        }
        videoRefs.value.delete(trackKey);
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

<template>
    <div class="dm-call-panel flex flex-col h-full overflow-hidden relative">
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
            <!-- Empty state -->
            <div v-if="allUsers.length === 0" class="empty-state">
                <div class="empty-state-icon">
                    <Users2 class="w-10 h-10" />
                </div>
                <span class="empty-state-title">Waiting for connection...</span>
            </div>

            <!-- Voice Call View -->
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

                    <div class="flex flex-row gap-3 overflow-x-auto w-full shrink-0" style="max-height: 9rem;">
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
                            :avatar-size="80"
                            :icon-size="16"
                            class-name="flex-shrink-0"
                            :custom-style="{ width: '14rem', height: '8rem' }"
                            name-class="text-xs"
                            icon-position="top-1 right-1"
                            @click="toggleFocus"
                            @video-ref="setVideoRef" />
                    </div>
                </div>

                <!-- Grid / 2-user -->
                <div v-else key="grid-mode" class="flex-1 flex items-center justify-center min-h-0">
                    <!-- 2 Users: side by side -->
                    <div v-if="allUsers.length === 2" class="flex gap-4 items-center justify-center w-full h-full p-4">
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
                            class-name="flex-1 min-w-0"
                            :custom-style="{ height: '100%', maxHeight: '20rem' }"
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

        <!-- Controls Block -->
        <MediaControls
            class="mx-3 mb-3"
            :is-connected="isConnected"
            :is-connecting="isConnecting"
            @hangup="$emit('end')"
        />
    </div>
</template>

<style scoped>
.dm-call-panel {
    background: hsl(var(--card) / 0.6);
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
