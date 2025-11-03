<template>
    <div class="media-channel flex flex-col h-full rounded-lg bg-neutral-900/90 backdrop-blur-sm p-6">
        <!-- === Есть активный стример === -->
        <template v-if="mainStreamer">
            <div class="main-streamer relative flex-1 flex items-center justify-center mb-4">
                <div class="user-wrapper w-full h-full flex items-center justify-center relative">
                    <!-- Пульс говорящего -->
                    <!-- Видео / аватар -->
                    <div class="user-tile group rounded-2xl relative overflow-hidden shadow-[0_0_16px_rgba(0,0,0,0.45)] transition-all duration-200 z-0"
                        :class="{
                            'ring-2 ring-lime-400/80 shadow-[0_0_25px_rgba(132,255,90,0.3)] scale-[1.03]': mainStreamer.isSpeaking,
                        }">
                        <video v-if="mainUserId && activeVideos.has(mainUserId)"
                            :ref="(el) => mainUserId && setVideoRef(el, mainUserId)" autoplay playsinline muted
                            class="w-full h-full object-cover rounded-2xl" />
                        <SmartArgonAvatar v-else :user-id="mainStreamer?.User?.userId" :overrided-size="180"
                            class="transition-transform duration-300 group-hover:scale-110" />
                        <div
                            class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white text-lg font-semibold py-3 text-center">
                            {{ mainStreamer?.User?.displayName }}
                        </div>
                    </div>
                </div>
            </div>

            <!-- === Мини-грид остальных === -->
            <div class="other-users grid gap-3" :style="miniGridStyle">
                <div v-for="[userId, user] in otherUsers" :key="userId"
                    class="user-wrapper flex items-center justify-center">
                    <!-- Плитка -->
                    <div class="user-tile relative rounded-xl overflow-hidden bg-black/60 transition-transform duration-200 hover:scale-105 flex items-center justify-center aspect-video w-full"
                        :class="{
                            'ring-2 ring-lime-400/80 shadow-[0_0_25px_rgba(132,255,90,0.3)] scale-[1.03]': user.isSpeaking,
                        }">
                        <!-- Видео или аватар -->
                        <video v-if="activeVideos.has(user.User.userId)"
                            :ref="(el) => setVideoRef(el, user.User.userId)" autoplay playsinline muted
                            class="w-full h-full object-cover" />
                        <SmartArgonAvatar v-else :user-id="user.User.userId" :overrided-size="80"
                            class="transition-transform duration-300 group-hover:scale-110 rounded-full" />

                        <!-- Имя -->
                        <div
                            class="absolute bottom-1 left-0 right-0 text-center text-xs text-white/80 bg-gradient-to-t from-black/50 to-transparent py-0.5">
                            {{ user.User.displayName }}
                        </div>

                        <!-- Иконки -->
                        <div class="absolute top-2 right-2 flex gap-1.5 z-10">
                            <MicOffIcon v-if="user.isMuted" width="18" height="18"
                                class="text-red-400/90 drop-shadow-[0_0_4px_rgba(255,80,80,0.5)]" />
                            <ScreenShare v-if="activeVideos.has(user.User.userId)" width="18" height="18"
                                class="text-sky-400/90 drop-shadow-[0_0_4px_rgba(80,180,255,0.5)]" />
                        </div>

                        <!-- Пульс -->
                        <div v-if="user.isSpeaking"
                            class="absolute inset-0 -m-[3px] rounded-xl ring-4 ring-lime-400/30 animate-pulse-speak pointer-events-none z-0">
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <!-- === Нет стрима — обычная сетка === -->
        <template v-else>
            <div class="media-grid flex-1 grid gap-5 w-full h-full place-items-center" :style="gridStyle">
                <div v-for="[userId, user] in allUsers" :key="userId"
                    class="user-wrapper relative flex items-center justify-center w-full">
                    <!-- Пульс -->
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

// === Users ===
const users = computed(() => {
    const ch = selectedChannelId.value ? pool.realtimeChannelUsers.get(selectedChannelId.value) : null;
    return ch?.Users ?? new Map<Guid, IRealtimeChannelUserWithData>();
});

// === Video Refs ===
const videoRefs = ref<Map<Guid, HTMLVideoElement>>(new Map());
const activeVideos = ref<Map<Guid, Track<Track.Kind>>>(new Map());
const lastActiveStream = ref<{ userId: Guid; channelId: string } | null>(null);

function setVideoRef(el: Element | null, userId: Guid) {
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

// === Video events ===
onMounted(() => {
    voice.onVideoCreated.subscribe(({ track, userId }) => {
        logger.debug("Video created", userId);
        activeVideos.value.set(userId, track);
        const el = videoRefs.value.get(userId);
        if (el) track.attach(el);
        if (selectedChannelId.value) {
            lastActiveStream.value = { userId, channelId: selectedChannelId.value };
        }
    });

    voice.onVideoDestroyed.subscribe(({ userId }: { userId: Guid }) => {
        logger.debug("Video destroyed", userId);
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

// === Floating mini video trigger ===
const shouldShowMiniVideo = computed(() => {
    const s = lastActiveStream.value;
    return s !== null && activeVideos.value.has(s.userId) && selectedChannelId.value !== s.channelId;
});

// === Layout logic ===
const allUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() =>
    Array.from(users.value as Map<Guid, IRealtimeChannelUserWithData>)
);

const mainStreamer = computed<IRealtimeChannelUserWithData | null>(() => {
    if (!lastActiveStream.value) return null;
    const { userId } = lastActiveStream.value;
    if (activeVideos.value.has(userId)) {
        return users.value.get(userId) ?? null;
    }
    return null;
});

const mainUserId = computed(() => mainStreamer.value?.User.userId ?? null);

const otherUsers = computed<[Guid, IRealtimeChannelUserWithData][]>(() => {
    if (!mainStreamer.value) return allUsers.value;
    const mainId = lastActiveStream.value?.userId;
    return allUsers.value.filter(([id]) => id !== mainId);
});

// === Grid layouts ===
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
</style>

<!-- Глобальный CSS без scoped, чтобы анимация реально работала -->
<style>
@keyframes pulseSpeak {

    0%,
    100% {
        opacity: 0.5;
        transform: scale(1);
        box-shadow: 0 0 8px 4px rgba(132, 255, 90, 0.25);
    }

    50% {
        opacity: 1;
        transform: scale(1.1);
        box-shadow: 0 0 24px 8px rgba(132, 255, 90, 0.5);
    }
}

.animate-pulse-speak {
    animation: pulseSpeak 1.6s ease-in-out infinite !important;
    will-change: transform, box-shadow, opacity;
}
</style>
