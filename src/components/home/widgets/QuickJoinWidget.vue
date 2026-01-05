<template>
    <div class="widget-container h-full bg-gradient-to-br from-primary/5 to-transparent border-primary/20">
        <div class="flex flex-col gap-2 h-full">
            <div class="flex items-center gap-2">
                <div class="p-1.5 rounded-lg bg-primary/10">
                    <IconBolt class="w-4 h-4 text-primary" />
                </div>
                <p class="font-semibold text-sm">{{ t('quick_join') }}</p>
            </div>
            <input 
                v-model="channelCode"
                type="text" 
                :placeholder="t('enter_channel_code')"
                :disabled="isLoading"
                class="px-2.5 py-2 bg-background border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all disabled:opacity-50"
                @keyup.enter="handleJoin"
            />
            <p v-if="error" class="text-xs text-red-500 -mt-1">{{ error }}</p>
            <button 
                @click="handleJoin"
                :disabled="!channelCode || isLoading"
                class="w-full px-2.5 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1">
                <span v-if="isLoading" class="animate-spin i-lucide-loader-2 w-3 h-3"></span>
                <span v-else>{{ t('join') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { IconBolt } from '@tabler/icons-vue';
import { ref, watch } from 'vue';
import { useSpaceStore } from '@/store/serverStore';
import { usePoolStore } from '@/store/poolStore';
import { DeferFlag } from '@/lib/DeferFlag';
import { logger } from '@/lib/logger';

const { t } = useLocale();
const spaceStore = useSpaceStore();
const poolStore = usePoolStore();

const channelCode = ref('');
const isLoading = ref(false);
const error = ref('');

// Clear error when user types
watch(channelCode, () => {
    if (error.value) {
        error.value = '';
    }
});

const handleJoin = async () => {
    if (!channelCode.value.trim()) {
        error.value = t('please_enter_invite_code');
        return;
    }
    
    const e = new DeferFlag(isLoading);
    try {
        error.value = '';
        logger.log(`[QuickJoinWidget] Joining server with invite code: ${channelCode.value}`);
        
        const result = await spaceStore.joinToServer(channelCode.value.trim());

        if (result) {
            error.value = result;
            return;
        }
        
        channelCode.value = '';
        poolStore.refershDatas();
        
    } finally {
        e[Symbol.dispose]();
    }
};
</script>
