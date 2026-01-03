<template>
    <div ref="mediaChannelContainer" class="media-channel flex flex-col h-full rounded-lg bg-neutral-900/90 backdrop-blur-sm p-6 transition-all duration-300">
        <Transition name="stream-layout" mode="out-in">
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
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { IRealtimeChannelUserWithData, usePoolStore } from "@/store/poolStore";
import type { Guid } from "@argon-chat/ion.webcore";
import ParticipantCard from "./home/views/ParticipantCard.vue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import { useSystemStore } from "@/store/systemStore";
import { useMe } from "@/store/meStore";

const pool = usePoolStore();
const voice = useUnifiedCall();
const sys = useSystemStore();
const me = useMe();

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

const shouldShowMiniVideo = computed(() => false); // Placeholder for future implementation

// Helper functions - reactive computed maps for mute states
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
    for (const [uid, participant] of voice.participants) {
        // Skip if already added as local user
        if (uid === myId) continue;
        
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

const toggleFocus = (userId: Guid) => {
    focusedUserId.value = focusedUserId.value === userId ? null : userId;
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
/* Transition animations */
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

