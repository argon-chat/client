<template>
    <div class="shrink-0 relative">
        <SmartArgonAvatar :overrided-size="96" :user-id="userId"
            class="w-24 h-24 border-4 border-background shadow-md" />
        <svg class="pointer-events-none absolute inset-0 -m-[4px] w-[calc(100%+6px)] h-[calc(100%+5px)] animate-spin-slow"
            viewBox="0 0 100 100" aria-hidden="true">
            <defs>
                <linearGradient id="storyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#ff930f" />
                    <stop offset="100%" stop-color="#fff95b" />
                </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="46" fill="none" stroke="url(#storyGradient)" stroke-width="3"
                stroke-dasharray="1 4" stroke-linecap="round" />
        </svg>
    </div>
</template>
<script setup lang="ts">
import SmartArgonAvatar from '@/components/SmartArgonAvatar.vue';
import { Guid } from '@argon-chat/ion.webcore';

const props = defineProps<{
    userId: Guid
}>()
</script>
<style scoped>
@keyframes spin-slow {
    to {
        transform: rotate(360deg);
    }
}

.animate-spin-slow {
    animation: spin-slow 12.5s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
    .animate-spin-slow {
        animation: none;
    }
}
</style>
