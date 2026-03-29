<template>
    <div 
        class="participant-card group"
        :class="[className, { 'participant-card--playing': isPlaying, 'participant-card--speaking': isSpeaking, 'participant-card--streaming': isScreenSharing }]"
        :style="customStyle"
        @click="$emit('click', userId)">
        
        <video 
            v-if="hasVideo" 
            :ref="(el) => $emit('video-ref', el, userId)" 
            autoplay 
            playsinline 
            muted 
            class="participant-video" />

        <SmartArgonAvatar 
            v-else 
            :user-id="userId" 
            :overrided-size="avatarSize"
            :class="[
                'rounded-full transition-all duration-300 ease-in-out group-hover:scale-105',
                { 'ring-2 ring-lime-400/80 shadow-[0_0_20px_rgba(132,255,90,0.6)]': isSpeaking }
            ]" />

        <!-- Bottom name overlay -->
        <div class="participant-overlay" :class="{ 'text-center': centered }">
            <span class="participant-name" :class="nameClass">
                {{ displayName }}
            </span>
        </div>

        <!-- Streaming badge -->
        <div v-if="isScreenSharing" class="streaming-badge">
            <ScreenShareIcon class="w-3 h-3" />
            <span>LIVE</span>
        </div>

        <!-- Status icons -->
        <div class="participant-icons" :class="iconPosition">
            <span v-if="isPlaying" class="status-icon status-icon--playing">
                <Gamepad2Icon :width="iconSize" :height="iconSize" />
            </span>
            <span v-if="isMuted" class="status-icon status-icon--muted">
                <MicOffIcon :width="iconSize" :height="iconSize" />
            </span>
            <span v-if="isHeadphoneMuted" class="status-icon status-icon--muted">
                <HeadphoneOffIcon :width="iconSize" :height="iconSize" />
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { Guid } from "@argon-chat/ion.webcore";
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { MicOffIcon, HeadphoneOffIcon, Gamepad2 as Gamepad2Icon, ScreenShare as ScreenShareIcon } from "lucide-vue-next";

interface Props {
    userId: Guid;
    displayName: string;
    isSpeaking?: boolean;
    isMuted?: boolean;
    isHeadphoneMuted?: boolean;
    hasVideo?: boolean;
    isScreenSharing?: boolean;
    isPlaying?: boolean;
    avatarSize?: number;
    iconSize?: number;
    className?: string;
    customStyle?: Record<string, any>;
    nameClass?: string;
    iconPosition?: string;
    centered?: boolean;
}

withDefaults(defineProps<Props>(), {
    isSpeaking: false,
    isMuted: false,
    isHeadphoneMuted: false,
    hasVideo: false,
    isScreenSharing: false,
    isPlaying: false,
    avatarSize: 120,
    iconSize: 24,
    className: '',
    nameClass: 'text-sm',
    iconPosition: 'top-2 right-2',
    centered: true
});

defineEmits<{
    (e: 'click', userId: Guid): void;
    (e: 'video-ref', el: any, userId: Guid): void;
}>();
</script>

<style scoped>
.participant-card {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.participant-card:hover {
    border-color: hsl(var(--border));
}

.participant-card--speaking {
    border-color: rgba(132, 255, 90, 0.4);
    box-shadow: 0 0 16px rgba(132, 255, 90, 0.3);
}

.participant-card--playing {
    border-color: hsl(160 84% 39% / 0.5);
    box-shadow: 0 0 0 2px hsl(160 84% 39% / 0.1);
}

.participant-card--streaming {
    border-color: hsl(0 84% 60% / 0.5);
    box-shadow: 0 0 12px hsl(0 84% 60% / 0.2);
}

.participant-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
}



/* Bottom overlay */
.participant-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to top, hsl(var(--card) / 0.9), hsl(var(--card) / 0.5) 60%, transparent);
    padding: 1.5rem 0.5rem 0.375rem;
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
}

.participant-name {
    color: hsl(var(--foreground));
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* Streaming badge */
.streaming-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    border-radius: 4px;
    background: hsl(0 84% 50%);
    color: white;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    line-height: 1;
    animation: streaming-pulse 2s ease-in-out infinite;
    z-index: 5;
}

@keyframes streaming-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

/* Status icons */
.participant-icons {
    position: absolute;
    display: flex;
    gap: 3px;
}

.status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    border-radius: 6px;
    background: hsl(var(--card) / 0.75);
    backdrop-filter: blur(4px);
}

.status-icon--muted {
    color: hsl(0 84% 60%);
}

.status-icon--playing {
    color: hsl(160 84% 39%);
}
</style>
