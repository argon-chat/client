<template>
    <div ref="mediaChannelContainer" class="media-channel flex flex-col h-full rounded-lg bg-neutral-900/90 backdrop-blur-sm p-6 transition-all duration-300">
        <Transition name="stream-layout" mode="out-in">
            <div v-if="hasActiveStream && mainStreamer" key="stream-mode" class="flex flex-col gap-3 flex-1 min-h-0 items-center justify-center">
                <div class="relative rounded-xl overflow-hidden bg-black/60 flex items-center justify-center group transition-all duration-300" 
                    :style="{ maxHeight: isFullscreen ? '100%' : '31rem', maxWidth: '100%', width: '100%', flex: isFullscreen ? '1' : 'none' }">
                    <video v-if="mainUserId && hasVideo(mainUserId)" 
                        :ref="(el) => mainUserId && setVideoRef(el, mainUserId)"
                        autoplay playsinline muted class="w-full h-full object-contain" />

                    <SmartArgonAvatar v-else-if="mainStreamer" :user-id="mainStreamer.User.userId" :overrided-size="180"
                        class="transition-transform duration-200 group-hover:scale-110" />

                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent py-2 px-3">
                        <span class="text-white font-semibold">
                            {{ mainStreamer.User.displayName }}
                            <span v-if="mainStreamer.isScreenShare" class="text-xs text-lime-400 ml-2">📺 Sharing screen</span>
                        </span>
                    </div>

                    <div class="absolute top-2 left-2 flex gap-2">
                        <MicOffIcon v-if="mainStreamer.isMuted" :width="24" :height="24" :class="mutedIconClass" />
                    </div>
                </div>

                <div class="flex flex-row gap-3 overflow-x-auto w-full" style="max-height: 10rem;">
                    <div v-for="[userId, user] in otherUsers" :key="userId"
                        class="relative rounded-xl overflow-hidden bg-black/60 flex items-center justify-center group transition-all duration-300 cursor-pointer flex-shrink-0"
                        style="width: 15rem; height: 8.5rem;"
                        :class="{ [speakingRingClass]: isSpeaking(userId) }" 
                        @click="toggleFocus(userId)">
                        <video v-if="hasVideo(userId)" 
                            :ref="el => setVideoRef(el, userId)" 
                            autoplay playsinline muted
                            class="w-full h-full object-cover" />

                        <SmartArgonAvatar v-else :user-id="userId" :overrided-size="90"
                            class="transition-transform duration-200 group-hover:scale-110" />

                        <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent py-1 px-2">
                            <span class="text-white font-semibold text-xs truncate block">{{ user.User.displayName }}</span>
                        </div>

                        <div class="absolute top-1 right-1 flex gap-1">
                            <MicOffIcon v-if="user.isMuted" :width="18" :height="18" :class="mutedIconClass" />
                        </div>
                    </div>
                </div>
            </div>

            <div v-else key="grid-mode" class="flex-1 flex items-center justify-center">
                <div v-if="allUsers.length === 2" class="flex gap-6 items-center justify-center" style="flex-direction: column;">
                    <div v-for="[userId, user] in allUsers" :key="userId"
                        class="relative rounded-xl overflow-hidden bg-black/60 flex items-center justify-center group transition-all duration-300 cursor-pointer flex-shrink-0"
                        style="width: 40rem; min-width: 40rem; aspect-ratio: 16/9;"
                        :class="{ 'ring-2 ring-lime-400/80 shadow-[0_0_20px_rgba(132,255,90,0.3)]': isSpeaking(userId) }" 
                        @click="toggleFocus(userId)">
                        <video v-if="hasVideo(userId)" 
                            :ref="el => setVideoRef(el, userId)" 
                            autoplay playsinline muted
                            class="w-full h-full object-cover" />

                        <SmartArgonAvatar v-else :user-id="userId" :overrided-size="120"
                            class="transition-transform duration-200 group-hover:scale-110" />

                        <div class="absolute bottom-0 left-0 right-0 text-center bg-gradient-to-t from-black/70 to-transparent py-1">
                            <span class="text-white font-semibold text-sm">{{ user.User.displayName }}</span>
                        </div>

                        <div class="absolute top-2 right-2 flex gap-2">
                            <MicOffIcon v-if="user.isMuted" :width="24" :height="24" :class="mutedIconClass" />
                        </div>
                    </div>
                </div>

                <div v-else class="grid gap-4 place-items-center place-content-center" style="grid-auto-rows: minmax(min-content, max-content);"
                    :class="{
                        'grid-cols-1': allUsers.length === 1,
                        'grid-cols-2': allUsers.length >= 3 && allUsers.length <= 4,
                        'grid-cols-3': allUsers.length > 4
                    }">
                    <div v-for="[userId, user] in allUsers" :key="userId"
                        class="relative rounded-xl overflow-hidden bg-black/60 flex items-center justify-center group transition-all duration-300 cursor-pointer w-full"
                        :style="{ aspectRatio: '16/9', maxHeight: allUsers.length === 1 ? '25rem' : '19rem', minWidth: allUsers.length === 1 ? '28rem' : '20rem', minHeight: allUsers.length === 1 ? '15.75rem' : '11.25rem' }"
                        :class="{ 'ring-2 ring-lime-400/80 shadow-[0_0_20px_rgba(132,255,90,0.3)]': isSpeaking(userId) }" 
                        @click="toggleFocus(userId)">
                        <video v-if="hasVideo(userId)" 
                            :ref="el => setVideoRef(el, userId)" 
                            autoplay playsinline muted
                            class="w-full h-full object-cover" />

                        <SmartArgonAvatar v-else :user-id="userId" :overrided-size="120"
                            class="transition-transform duration-200 group-hover:scale-110" />

                        <div class="absolute bottom-0 left-0 right-0 text-center bg-gradient-to-t from-black/70 to-transparent py-1">
                            <span class="text-white font-semibold text-sm">{{ user.User.displayName }}</span>
                        </div>

                        <div class="absolute top-2 right-2 flex gap-2">
                            <MicOffIcon v-if="user.isMuted" :width="24" :height="24" :class="mutedIconClass" />
                        </div>
                    </div>
                </div>
            </div>
        </Transition>

        <FloatingMiniVideo v-if="shouldShowMiniVideo" />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { IRealtimeChannelUserWithData, usePoolStore } from "@/store/poolStore";
import type { Guid } from "@argon-chat/ion.webcore";
import SmartArgonAvatar from "./SmartArgonAvatar.vue";
import FloatingMiniVideo from "./FloatingMiniVideo.vue";
import type { Track } from "livekit-client";
import { logger } from "@/lib/logger";
import { MicOffIcon, ScreenShare } from "lucide-vue-next";
import { useUnifiedCall } from "@/store/unifiedCallStore";

const pool = usePoolStore();
const voice = useUnifiedCall();

const selectedChannelId = defineModel<string | null>("selectedChannelId", { type: String, required: true });

const users = computed(() => {
    const ch = selectedChannelId.value ? pool.realtimeChannelUsers.get(selectedChannelId.value) : null;
    return ch?.Users ?? new Map<Guid, IRealtimeChannelUserWithData>();
});

const videoRefs = ref<Map<Guid, HTMLVideoElement>>(new Map());
const lastActiveStream = ref<{ userId: Guid; channelId: string } | null>(null);
const focusedUserId = ref<Guid | null>(null);
const isFullscreen = ref(true);
const mediaChannelContainer = ref<HTMLElement | null>(null);

function setVideoRef(el: Element | null | any, userId: Guid) {
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
}
const mainVideoContainer = ref<HTMLElement | null>(null);

function isSpeaking(uid: Guid) {
    return voice.speaking.has(uid);
}

function hasVideo(uid: Guid) {
    return voice.videoTracks.has(uid);
}

function toggleFocus(userId: Guid) {
    if (focusedUserId.value === userId) {
        focusedUserId.value = null;
    } else {
        focusedUserId.value = userId;
    }
}

function toggleFullscreen() {
    isFullscreen.value = !isFullscreen.value;
}

async function togglePiP() {
    const userId = mainUserId.value;
    if (!userId) return;

    const video = videoRefs.value.get(userId);
    if (!video) return;

    try {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        } else {
            await video.requestPictureInPicture();
        }
    } catch (err) {
        console.warn("failed to toggle PiP:", err);
    }
}

onUnmounted(() => {
    voice.videoTracks.forEach((track, userId) => {
        const el = videoRefs.value.get(userId);
        if (track && el) track.detach(el);
    });
    videoRefs.value.clear();
});

const shouldShowMiniVideo = computed(() => {
    const s = lastActiveStream.value;
    return s !== null && voice.videoTracks.has(s.userId) && selectedChannelId.value !== s.channelId;
});

const allUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() =>
    Array.from(users.value as Map<Guid, IRealtimeChannelUserWithData>)
);

const mainStreamer = computed<IRealtimeChannelUserWithData | null>(() => {
    // Приоритет: focusedUserId, потом screencast, потом activeVideos
    if (focusedUserId.value) {
        const user = users.value.get(focusedUserId.value);
        if (user) return user as IRealtimeChannelUserWithData;
    }
    
    // Ищем screencast
    for (const [userId, user] of users.value) {
        if (user.isScreenShare) {
            return user as IRealtimeChannelUserWithData;
        }
    }
    
    // Или первый с видео
    for (const [userId] of voice.videoTracks) {
        const user = users.value.get(userId);
        if (user) return user as IRealtimeChannelUserWithData;
    }
    
    return null;
});

const mainUserId = computed(() => mainStreamer.value?.User.userId ?? null);

const otherUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() => {
    if (!mainStreamer.value) return allUsers.value;
    const mainId = mainStreamer.value.User.userId;
    return allUsers.value.filter(([id]) => id !== mainId);
});

const hasActiveStream = computed(() => !!mainStreamer.value);
const speakingRingClass = 'ring-2 ring-lime-400/80 shadow-[0_0_15px_rgba(132,255,90,0.3)]';
const mutedIconClass = 'text-red-400 drop-shadow-[0_0_4px_rgba(255,0,0,0.6)]';

const gridStyle = computed(() => {
    const n = users.value.size;
    if (n === 0) return "";
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return `
    grid-template-columns: repeat(${cols}, minmax(0, 1fr));
    grid-template-rows: repeat(${rows}, minmax(0, auto));
  `;
});

const miniGridStyle = computed(() => {
    const n = otherUsers.value.length;
    const cols = Math.min(n, 4);
    return `
    grid-template-columns: repeat(${cols}, minmax(0, 1fr));
    height: 120px;
  `;
});
</script>

<style scoped>
.media-grid {
    width: 100%;
    height: 100%;
}

.user-wrapper {
    position: relative;
    width: 100%;
}

.user-tile {
    width: 100%;
    height: auto;
    backdrop-filter: blur(8px);
    transform-origin: center;
    transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.user-tile:hover {
    transform: translateY(-2px) scale(1.01);
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
}

.aspect-video {
    aspect-ratio: 16 / 9;
    width: 100%;
}

.main-streamer video {
    object-fit: contain;
    background: black;
}

.other-users {
    width: 100%;
    justify-items: center;
    align-items: center;
}

.other-users .user-tile {
    aspect-ratio: 16/9;
    width: 100%;
    max-width: 220px;
    height: auto;
}

@keyframes pulseSpeak {

    0%,
    100% {
        opacity: 0.5;
        transform: scale(1);
        box-shadow: 0 0 8px 4px rgba(132, 255, 90, 0.25);
    }

    50% {
        opacity: 1;
        transform: scale(1.01);
        box-shadow: 0 0 10px 6px rgba(132, 255, 90, 0.5);
    }
}

.animate-pulse-speak {
    animation: pulseSpeak 1.6s ease-in-out infinite !important;
    will-change: transform, box-shadow, opacity;
}

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
