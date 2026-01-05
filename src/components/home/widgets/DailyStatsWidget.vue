<template>
    <div class="widget-container h-full">
        <h2 class="flex items-center gap-2 text-sm font-semibold mb-3">
            <div class="p-1.5 rounded-lg bg-blue-500/10">
                <IconChartBar class="w-4 h-4 text-blue-500" />
            </div>
            {{ t('today_stats') }}
        </h2>
        
        <div class="space-y-2">
            <div class="flex items-center justify-between p-2 rounded-lg bg-gradient-to-r from-primary/5 to-transparent border border-primary/10">
                <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-primary/10">
                        <IconClock class="w-4 h-4 text-primary" />
                    </div>
                    <span class="text-xs font-medium">{{ t('time_in_voice') }}</span>
                </div>
                <span class="text-sm font-bold">{{ voiceTime }}</span>
            </div>

            <div class="flex items-center justify-between p-2 rounded-lg bg-gradient-to-r from-green-500/5 to-transparent border border-green-500/10">
                <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-green-500/10">
                        <IconPhoneCall class="w-4 h-4 text-green-500" />
                    </div>
                    <span class="text-xs font-medium">{{ t('calls_made') }}</span>
                </div>
                <span class="text-sm font-bold">{{ callsMade }}</span>
            </div>

            <div class="flex items-center justify-between p-2 rounded-lg bg-gradient-to-r from-orange-500/5 to-transparent border border-orange-500/10">
                <div class="flex items-center gap-2">
                    <div class="p-1.5 rounded-lg bg-orange-500/10">
                        <IconMessage class="w-4 h-4 text-orange-500" />
                    </div>
                    <span class="text-xs font-medium">{{ t('messages_today') }}</span>
                </div>
                <span class="text-sm font-bold">{{ messagesSent }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useApi } from '@/store/apiStore';
import { useLocale } from '@/store/localeStore';
import { IconChartBar, IconClock, IconPhoneCall, IconMessage } from '@tabler/icons-vue';
import { ref, computed, onMounted } from 'vue';
import { logger } from '@/lib/logger';

const { t } = useLocale();
const api = useApi();

interface TodayStats {
  timeInVoice: number;
  callsMade: number;
  messagesSent: number;
}

const statsData = ref<TodayStats | null>(null);
const isLoading = ref(true);

const voiceTime = computed(() => {
  if (!statsData.value) return '0h 0m';
  const minutes = statsData.value.timeInVoice;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
});

const callsMade = computed(() => statsData.value?.callsMade ?? 0);
const messagesSent = computed(() => statsData.value?.messagesSent ?? 0);

async function loadStats() {
  try {
    isLoading.value = true;
    const data = await api.userInteraction.GetTodayStats();
    statsData.value = data;
    logger.log('[DailyStatsWidget] Stats loaded:', data);
  } catch (error) {
    logger.error('[DailyStatsWidget] Failed to load stats:', error);
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  loadStats();
});
</script>
