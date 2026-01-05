<template>
    <div class="widget-container h-full bg-gradient-to-br from-primary/10 to-transparent border-primary/20 p-2">
        <div class="flex items-center gap-2 h-full">
            <div class="relative flex-shrink-0">
                <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
                    <div class="text-center">
                        <div class="text-base font-bold text-primary-foreground leading-none">{{ currentLevel }}</div>
                        <div class="text-[7px] text-primary-foreground/80 uppercase font-semibold leading-none mt-0.5">LVL</div>
                    </div>
                </div>
                <div class="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-yellow-500 rounded-full flex items-center justify-center shadow-md">
                    <IconStar class="w-2 h-2 text-white" />
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-0.5">
                    <span class="text-[10px] font-medium leading-none">{{ currentXP }}/{{ nextLevelXP }} XP</span>
                    <span class="text-[9px] text-muted-foreground leading-none">{{ voiceHours }}h</span>
                </div>
                <div class="relative h-1.5 bg-muted rounded-full overflow-hidden">
                    <div 
                        class="absolute h-full bg-gradient-to-r from-primary to-primary/80 rounded-full transition-all duration-500"
                        :style="{ width: `${progressPercent}%` }"
                    >
                        <div class="absolute inset-0 bg-white/20 animate-shimmer"></div>
                    </div>
                </div>
                <p class="text-[8px] text-muted-foreground mt-0.5 leading-none">{{ hoursToNextLevel }}h {{ t('to') }} LVL {{ currentLevel + 1 }}</p>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { IconStar } from '@tabler/icons-vue';
import { computed, ref } from 'vue';

const { t } = useLocale();

// TODO: Fetch from API
const voiceHours = ref(42);
const currentLevel = computed(() => Math.floor(voiceHours.value / 10) + 1);
const currentXP = computed(() => voiceHours.value % 10);
const nextLevelXP = 10;
const progressPercent = computed(() => (currentXP.value / nextLevelXP) * 100);
const hoursToNextLevel = computed(() => Math.floor((nextLevelXP - currentXP.value)));
</script>
