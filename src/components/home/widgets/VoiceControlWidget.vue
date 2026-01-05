<template>
    <div class="widget-container h-full overflow-hidden relative">
        <div class="flex items-center gap-2 mb-3">
            <div class="p-1.5 rounded-lg bg-primary/10">
                <IconMicrophone class="w-4 h-4 text-primary" />
            </div>
            <p class="font-semibold text-sm">{{ t('voice_control') }}</p>
        </div>
        
        <div class="space-y-2">
            <!-- Mute Toggle -->
            <button 
                @click="toggleMute"
                :class="[
                    'w-full flex items-center justify-between p-2 rounded-lg transition-all',
                    isMuted 
                        ? 'bg-red-500/10 border border-red-500/30 hover:bg-red-500/20' 
                        : 'bg-green-500/10 border border-green-500/30 hover:bg-green-500/20'
                ]"
            >
                <div class="flex items-center gap-2">
                    <div :class="['p-1.5 rounded-lg', isMuted ? 'bg-red-500/20' : 'bg-green-500/20']">
                        <IconMicrophoneOff v-if="isMuted" class="w-4 h-4 text-red-500" />
                        <IconMicrophone v-else class="w-4 h-4 text-green-500" />
                    </div>
                    <span class="text-xs font-medium">{{ isMuted ? t('unmute') : t('muted') }}</span>
                </div>
                <div class="text-[10px] font-medium" :class="isMuted ? 'text-red-500' : 'text-green-500'">
                    {{ isMuted ? 'OFF' : 'ON' }}
                </div>
            </button>

            <!-- Deafen Toggle -->
            <button 
                @click="toggleDeafen"
                :class="[
                    'w-full flex items-center justify-between p-2 rounded-lg transition-all',
                    isDeafened 
                        ? 'bg-red-500/10 border border-red-500/30 hover:bg-red-500/20' 
                        : 'bg-blue-500/10 border border-blue-500/30 hover:bg-blue-500/20'
                ]"
            >
                <div class="flex items-center gap-2">
                    <div :class="['p-1.5 rounded-lg', isDeafened ? 'bg-red-500/20' : 'bg-blue-500/20']">
                        <IconHeadphonesOff v-if="isDeafened" class="w-4 h-4 text-red-500" />
                        <IconHeadphones v-else class="w-4 h-4 text-blue-500" />
                    </div>
                    <span class="text-xs font-medium">{{ isDeafened ? t('undeafen') : t('deafened') }}</span>
                </div>
                <div class="text-[10px] font-medium" :class="isDeafened ? 'text-red-500' : 'text-blue-500'">
                    {{ isDeafened ? 'OFF' : 'ON' }}
                </div>
            </button>

            <!-- Voice Activity Indicator -->
            <div class="p-2 rounded-lg bg-muted/50 border border-border">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] text-muted-foreground">{{ t('input_level') }}</span>
                    <span class="text-[10px] font-medium">{{ voiceLevel }}%</span>
                </div>
                <div class="relative h-1.5 bg-background rounded-full overflow-hidden">
                    <div 
                        class="absolute h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 rounded-full transition-all duration-100"
                        :style="{ width: `${voiceLevel}%` }"
                    >
                        <div class="absolute inset-0 bg-white/30 animate-pulse-fast"></div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Decorative wave -->
        <div class="absolute -bottom-1 left-0 right-0 h-12 opacity-20 pointer-events-none overflow-hidden">
            <svg viewBox="0 0 400 60" preserveAspectRatio="none" class="w-[200%] h-full">
                <path d="M0,30 Q25,10 50,30 T100,30 T150,30 T200,30 T250,30 T300,30 T350,30 T400,30 T450,30 T500,30 T550,30 T600,30 T650,30 T700,30 T750,30 T800,30" 
                    fill="none" stroke="currentColor" stroke-width="2" class="text-primary wave-path wave-1" />
                <path d="M0,40 Q25,20 50,40 T100,40 T150,40 T200,40 T250,40 T300,40 T350,40 T400,40 T450,40 T500,40 T550,40 T600,40 T650,40 T700,40 T750,40 T800,40" 
                    fill="none" stroke="currentColor" stroke-width="2" class="text-primary wave-path wave-2" />
            </svg>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { IconMicrophone, IconMicrophoneOff, IconHeadphones, IconHeadphonesOff } from '@tabler/icons-vue';
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useSystemStore } from '@/store/systemStore';
import { audio } from '@/lib/audio/AudioManager';
import { logger } from '@/lib/logger';
import type { Disposable } from '@/lib/disposables';

const { t } = useLocale();
const sys = useSystemStore();

// Voice control state
const isMuted = ref(false);
const isDeafened = ref(false);
const voiceLevel = ref(0);

let vuMeterDisposable: Disposable<AudioWorkletNode> | null = null;

// Sync with system store
watch(() => sys.microphoneMuted, (val) => {
    isMuted.value = val;
    if (val) {
        voiceLevel.value = 0;
    }
});

watch(() => sys.headphoneMuted, (val) => {
    isDeafened.value = val;
});

async function toggleMute() {
    await sys.toggleMicrophoneMute();
}

async function toggleDeafen() {
    await sys.toggleHeadphoneMute();
}

async function setupVUMeter() {
    try {
        const stream = await audio.createRawInputMediaStream();
        
        vuMeterDisposable = await audio.createVUMeterLight(stream, (level) => {
            if (!isMuted.value) {
                voiceLevel.value = level;
            }
        });
        
        logger.log('[VoiceControlWidget] VU meter initialized');
    } catch (error) {
        logger.error('[VoiceControlWidget] Failed to setup VU meter:', error);
    }
}

onMounted(async () => {
    isMuted.value = sys.microphoneMuted;
    isDeafened.value = sys.headphoneMuted;
    await setupVUMeter();
});

onUnmounted(async () => {
    if (vuMeterDisposable) {
        await vuMeterDisposable[Symbol.asyncDispose]();
        vuMeterDisposable = null;
    }
});
</script>

<style scoped>
@keyframes wave-animation {
    0% {
        transform: translateX(0);
    }
    100% {
        transform: translateX(-50%);
    }
}

.wave-path {
    animation: wave-animation 4s linear infinite;
}

.wave-1 {
    animation-delay: 0s;
}

.wave-2 {
    animation-delay: 0.5s;
}

@keyframes pulse-fast {
    0%, 100% {
        opacity: 0.3;
    }
    50% {
        opacity: 0.5;
    }
}

.animate-pulse-fast {
    animation: pulse-fast 0.5s ease-in-out infinite;
}
</style>
