<template>
    <div 
        class="relative rounded-xl overflow-hidden bg-black/60 flex items-center justify-center group transition-all duration-300 cursor-pointer"
        :class="className"
        :style="customStyle"
        @click="$emit('click', userId)">
        
        <video 
            v-if="hasVideo" 
            :ref="(el) => $emit('video-ref', el, userId)" 
            autoplay 
            playsinline 
            muted 
            class="w-full h-full object-cover" />

        <SmartArgonAvatar 
            v-else 
            :user-id="userId" 
            :overrided-size="avatarSize"
            :class="[
                'transition-all duration-300 ease-in-out group-hover:scale-110',
                { 'ring-4 ring-lime-400/80 rounded-full shadow-[0_0_20px_rgba(132,255,90,0.6)]': isSpeaking }
            ]" />

        <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent py-1 px-2" :class="{ 'text-center': centered }">
            <span class="text-white font-semibold truncate block" :class="nameClass">
                {{ displayName }}
                <span v-if="isScreenSharing" class="text-xs text-lime-400 ml-2">📺 Sharing screen</span>
            </span>
        </div>

        <div class="absolute flex gap-1" :class="iconPosition">
            <MicOffIcon v-if="isMuted" :width="iconSize" :height="iconSize" :class="mutedIconClass" />
            <HeadphoneOffIcon v-if="isHeadphoneMuted" :width="iconSize" :height="iconSize" :class="mutedIconClass" />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { Guid } from "@argon-chat/ion.webcore";
import SmartArgonAvatar from "@/components/SmartArgonAvatar.vue";
import { MicOffIcon, HeadphoneOffIcon } from "lucide-vue-next";

interface Props {
    userId: Guid;
    displayName: string;
    isSpeaking?: boolean;
    isMuted?: boolean;
    isHeadphoneMuted?: boolean;
    hasVideo?: boolean;
    isScreenSharing?: boolean;
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

const mutedIconClass = 'text-red-400 drop-shadow-[0_0_4px_rgba(255,0,0,0.6)]';
</script>
