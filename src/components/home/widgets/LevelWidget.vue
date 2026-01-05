<template>
    <div class="widget-container h-full bg-gradient-to-br from-primary/10 to-transparent border-primary/20 p-2">
        <div class="flex items-center gap-3 h-full">
            <div class="relative flex-shrink-0">
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-primary via-primary/90 to-primary/70 flex items-center justify-center shadow-lg ring-2 ring-primary/30">
                    <div class="text-center">
                        <div class="text-lg font-black text-white leading-none drop-shadow-md">{{ currentLevel }}</div>
                        <div class="text-[8px] text-white/90 uppercase font-bold leading-none mt-0.5 tracking-wide">LVL</div>
                    </div>
                </div>
                <div 
                    v-if="levelData?.readyToClaimCoin"
                    class="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center shadow-lg ring-2 ring-yellow-300/50 cursor-pointer hover:scale-110 transition-transform animate-pulse"
                    @click="claimCoin"
                    title="Claim coin!"
                >
                    <IconCoin class="w-3 h-3 text-white drop-shadow" />
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-semibold text-foreground">{{ currentXP }}/{{ nextLevelXP }} XP</span>
                </div>
                <div class="relative h-2.5 bg-gradient-to-r from-muted/40 to-muted/60 rounded-full overflow-hidden ring-1 ring-border/50 shadow-inner">
                    <div 
                        class="absolute h-full bg-gradient-to-r from-primary via-primary to-primary/90 rounded-full transition-all duration-700 ease-out"
                        :style="{ width: `${progressPercent}%` }"
                    >
                        <!-- Shine effect -->
                        <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"></div>
                        <!-- Inner highlight for 3D effect -->
                        <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-b from-white/40 to-transparent rounded-t-full"></div>
                    </div>
                </div>
                <p class="text-[9px] text-muted-foreground mt-1 leading-none">{{ currentXP }}/{{ nextLevelXP }} XP {{ t('to') }} LVL {{ currentLevel + 1 }}</p>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { IconStar, IconCoin } from '@tabler/icons-vue';
import { computed, ref, onMounted } from 'vue';
import { useApi } from '@/store/apiStore';
import { logger } from '@/lib/logger';

const { t } = useLocale();
const api = useApi();

interface MyLevelDetails {
  totalXp: number;
  currentLevel: number;
  xpForNextLevel: number;
  xpForCurrentLevel: number;
  readyToClaimCoin: boolean;
}

const levelData = ref<MyLevelDetails | null>(null);
const isLoading = ref(true);

const currentLevel = computed(() => levelData.value?.currentLevel ?? 1);
const currentXP = computed(() => {
  if (!levelData.value) return 0;
  return levelData.value.totalXp - levelData.value.xpForCurrentLevel;
});
const nextLevelXP = computed(() => {
  if (!levelData.value) return 10;
  return levelData.value.xpForNextLevel - levelData.value.xpForCurrentLevel;
});
const progressPercent = computed(() => {
  const total = nextLevelXP.value;
  if (total === 0) return 0;
  return (currentXP.value / total) * 100;
});

async function claimCoin() {
  try {
    logger.log('[LevelWidget] Claiming coin...');
    await api.userInteraction.ClaimLevelCoin();
    logger.log('[LevelWidget] Coin claimed successfully!');
    // Reload level data to update UI
    await loadLevelData();
  } catch (error) {
    logger.error('[LevelWidget] Failed to claim coin:', error);
  }
}

async function loadLevelData() {
  try {
    isLoading.value = true;
    const data = await api.userInteraction.GetMyLevel();
    levelData.value = data;
    logger.log('[LevelWidget] Level data loaded:', data);
  } catch (error) {
    logger.error('[LevelWidget] Failed to load level data:', error);
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  loadLevelData();
});
</script>
