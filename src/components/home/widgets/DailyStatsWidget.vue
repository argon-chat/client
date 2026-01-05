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
import { useLocale } from '@/store/localeStore';
import { IconChartBar, IconClock, IconPhoneCall, IconMessage } from '@tabler/icons-vue';
import { ref } from 'vue';

const { t } = useLocale();

// TODO: Fetch from API
const voiceTime = ref('0h 0m');
const callsMade = ref(0);
const messagesSent = ref(0);
</script>
