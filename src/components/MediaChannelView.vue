<template>
    <div class="media-channel flex flex-col h-full rounded-lg bg-neutral-900/90 backdrop-blur-sm p-6">
        <template v-if="mainStreamer">
            <div class="main-streamer relative flex-1 flex items-center justify-center mb-4">
                <div class="user-wrapper w-full h-full flex items-center justify-center relative">
                    <div ref="mainVideoContainer"
                        class="user-tile group rounded-2xl relative overflow-hidden shadow-[0_0_16px_rgba(0,0,0,0.45)] transition-all duration-200 z-0"
                        :class="{
                            'ring-2 ring-lime-400/80 shadow-[0_0_25px_rgba(132,255,90,0.3)] scale-[1.03]': mainStreamer.isSpeaking,
                        }">
                        <video v-if="mainUserId && activeVideos.has(mainUserId)"
                            :ref="(el) => mainUserId && setVideoRef(el, mainUserId)" autoplay playsinline muted
                            class="w-full h-full object-cover rounded-2xl" />
                        <SmartArgonAvatar v-else :user-id="mainStreamer?.User?.userId" :overrided-size="180"
                            class="transition-transform duration-300 group-hover:scale-110" />

                        <div class="absolute top-3 right-3 z-10 flex gap-2">
                           <!--  <button @click="togglePiP"
                                class="bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition"
                                title="">
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <rect x="3" y="3" width="18" height="14" rx="2" ry="2" stroke-width="2" />
                                    <rect x="12" y="10" width="8" height="6" rx="1" ry="1" fill="currentColor" />
                                </svg>
                            </button> -->

                            <button @click="toggleFullscreen"
                                class="bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition"
                                title="Развернуть в полный экран">
                                <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M8 3H5a2 2 0 00-2 2v3m0 8v3a2 2 0 002 2h3m8-18h3a2 2 0 012 2v3m0 8v3a2 2 0 01-2 2h-3" />
                                </svg>
                            </button>
                        </div>

                        <div
                            class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white text-lg font-semibold py-3 text-center">
                            {{ mainStreamer?.User?.displayName }}
                        </div>
                    </div>
                </div>
            </div>

            <div class="other-users grid gap-3" :style="miniGridStyle">
                <div v-for="[userId, user] in otherUsers" :key="userId"
                    class="user-wrapper flex items-center justify-center">
                    <div class="user-tile relative rounded-xl overflow-hidden bg-black/60 transition-transform duration-200 hover:scale-105 flex items-center justify-center aspect-video w-full"
                        :class="{
                            'ring-2 ring-lime-400/80 shadow-[0_0_25px_rgba(132,255,90,0.3)] scale-[1.03]': user.isSpeaking,
                        }">
                        <video v-if="activeVideos.has(user.User.userId)"
                            :ref="(el) => setVideoRef(el, user.User.userId)" autoplay playsinline muted
                            class="w-full h-full object-cover" />
                        <SmartArgonAvatar v-else :user-id="user.User.userId" :overrided-size="80"
                            class="transition-transform duration-300 group-hover:scale-110 rounded-full" />

                        <div
                            class="absolute bottom-1 left-0 right-0 text-center text-xs text-white/80 bg-gradient-to-t from-black/50 to-transparent py-0.5">
                            {{ user.User.displayName }}
                        </div>

                        <div class="absolute top-2 right-2 flex gap-1.5 z-10">
                            <MicOffIcon v-if="user.isMuted" width="18" height="18"
                                class="text-red-400/90 drop-shadow-[0_0_4px_rgba(255,80,80,0.5)]" />
                            <ScreenShare v-if="activeVideos.has(user.User.userId)" width="18" height="18"
                                class="text-sky-400/90 drop-shadow-[0_0_4px_rgba(80,180,255,0.5)]" />
                        </div>

                        <div v-if="user.isSpeaking"
                            class="absolute inset-0 -m-[3px] rounded-xl ring-4 ring-lime-400/30 animate-pulse-speak pointer-events-none z-0">
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <template v-else>
            <div class="media-grid flex-1 grid gap-5 w-full h-full place-items-center" :style="gridStyle">
                <div v-for="[userId, user] in allUsers" :key="userId"
                    class="user-wrapper relative flex items-center justify-center w-full">
                    <div v-if="user.isSpeaking"
                        class="absolute inset-0 -m-[4px] rounded-2xl ring-4 ring-lime-400/30 animate-pulse-speak pointer-events-none z-[1]">
                    </div>

                    <div class="user-tile group rounded-2xl relative overflow-hidden shadow-[0_0_16px_rgba(0,0,0,0.45)] transition-all duration-200 z-0"
                        :class="{
                            'ring-2 ring-lime-400/80 shadow-[0_0_25px_rgba(132,255,90,0.3)] scale-[1.03]': user.isSpeaking,
                        }">
                        <div class="aspect-video w-full flex items-center justify-center bg-black">
                            <video v-if="activeVideos.has(user.User.userId)"
                                :ref="(el) => setVideoRef(el, user.User.userId)" autoplay playsinline muted
                                class="w-full h-full object-cover rounded-md" />
                            <SmartArgonAvatar v-else :user-id="user.User.userId" :overrided-size="150"
                                class="transition-transform duration-300 group-hover:scale-110" />
                        </div>

                        <div
                            class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white text-sm font-semibold py-2 text-center">
                            {{ user.User.displayName }}
                        </div>

                        <div class="absolute top-3 right-3 flex gap-1.5">
                            <MicOffIcon v-if="user.isMuted" width="22" height="22"
                                class="text-red-400/90 drop-shadow-[0_0_4px_rgba(255,80,80,0.5)]" />
                            <ScreenShare v-if="activeVideos.has(user.User.userId)" width="22" height="22"
                                class="text-sky-400/90 drop-shadow-[0_0_4px_rgba(80,180,255,0.5)]" />
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <FloatingMiniVideo v-if="shouldShowMiniVideo" />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { IRealtimeChannelUserWithData, usePoolStore } from "@/store/poolStore";
import type { Guid } from "@argon-chat/ion.webcore";
import SmartArgonAvatar from "./SmartArgonAvatar.vue";
import FloatingMiniVideo from "./FloatingMiniVideo.vue";
import { useVoice } from "@/store/voiceStore";
import type { Track } from "livekit-client";
import { logger } from "@/lib/logger";
import { MicOffIcon, ScreenShare } from "lucide-vue-next";

const pool = usePoolStore();
const voice = useVoice();

const selectedChannelId = defineModel<string | null>("selectedChannelId", { type: String, required: true });

const users = computed(() => {
    const ch = selectedChannelId.value ? pool.realtimeChannelUsers.get(selectedChannelId.value) : null;
    return ch?.Users ?? new Map<Guid, IRealtimeChannelUserWithData>();
});

const videoRefs = ref<Map<Guid, HTMLVideoElement>>(new Map());
const activeVideos = ref<Map<Guid, Track<Track.Kind>>>(new Map());
const lastActiveStream = ref<{ userId: Guid; channelId: string } | null>(null);

function setVideoRef(el: Element | null | any, userId: Guid) {
    if (el instanceof HTMLVideoElement) {
        videoRefs.value.set(userId, el);
        const track = activeVideos.value.get(userId);
        if (track) track.attach(el);
    } else if (el === null) {
        const oldEl = videoRefs.value.get(userId);
        if (oldEl) {
            const track = activeVideos.value.get(userId);
            if (track) track.detach(oldEl);
        }
        videoRefs.value.delete(userId);
    }
}
const mainVideoContainer = ref<HTMLElement | null>(null);

function toggleFullscreen() {
    const el = mainVideoContainer.value;
    if (!el) return;

    if (!document.fullscreenElement) {
        el.requestFullscreen().catch(err => {
            console.warn("failed enter to fullscreen:", err);
        });
    } else {
        document.exitFullscreen().catch(err => {
            console.warn("failed exit from fullscreen:", err);
        });
    }
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

onMounted(() => {
    voice.onVideoCreated.subscribe(({ track, userId }) => {
        activeVideos.value.set(userId, track);
        const el = videoRefs.value.get(userId);
        if (el) track.attach(el);
        if (selectedChannelId.value) {
            lastActiveStream.value = { userId, channelId: selectedChannelId.value };
        }
    });

    voice.onVideoDestroyed.subscribe(({ userId }: { userId: Guid }) => {
        const track = activeVideos.value.get(userId);
        const el = videoRefs.value.get(userId);
        if (track && el) track.detach(el);
        activeVideos.value.delete(userId);
        if (lastActiveStream.value?.userId === userId) {
            lastActiveStream.value = null;
        }
    });
});

onUnmounted(() => {
    activeVideos.value.forEach((track, userId) => {
        const el = videoRefs.value.get(userId);
        if (track && el) track.detach(el);
    });
    activeVideos.value.clear();
    videoRefs.value.clear();
});

const shouldShowMiniVideo = computed(() => {
    const s = lastActiveStream.value;
    return s !== null && activeVideos.value.has(s.userId) && selectedChannelId.value !== s.channelId;
});

const allUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() =>
    Array.from(users.value as Map<Guid, IRealtimeChannelUserWithData>)
);

const mainStreamer = computed<IRealtimeChannelUserWithData | null>(() => {
    if (!lastActiveStream.value) return null;
    const { userId } = lastActiveStream.value;
    if (activeVideos.value.has(userId)) {
        return (users.value.get(userId) ?? null) as IRealtimeChannelUserWithData | null;
    }
    return null;
});

const mainUserId = computed(() => mainStreamer.value?.User.userId ?? null);

const otherUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() => {
    if (!mainStreamer.value) return allUsers.value;
    const mainId = lastActiveStream.value?.userId;
    return allUsers.value.filter(([id]) => id !== mainId);
});

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
</style>
