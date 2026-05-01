<template>
  <div v-if="space" class="boost-banner flex items-center gap-3 px-4 py-2">
    <RocketIcon class="w-4 h-4 text-violet-300 flex-shrink-0" />
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <span class="text-sm font-medium text-violet-200">Level {{ space.boostLevel }}</span>
      <div class="boost-progress flex-1 max-w-[120px] h-1.5 rounded-full bg-violet-900/50 overflow-hidden">
        <div
          class="h-full rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400 transition-all duration-500"
          :style="{ width: progressPercent + '%' }"
        />
      </div>
      <span class="text-xs text-violet-300/70">{{ space.boostCount }} boost{{ space.boostCount !== 1 ? 's' : '' }}</span>
    </div>
    <Button
      variant="ghost"
      size="sm"
      class="text-violet-300 hover:text-violet-100 hover:bg-violet-500/20 text-xs h-7 px-2"
      @click="emit('boost-click')"
    >
      Boost
    </Button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RocketIcon } from "lucide-vue-next";
import { Button } from "@argon/ui/button";
import { computedAsync } from "@vueuse/core";
import { usePoolStore } from "@/store/data/poolStore";

const props = defineProps<{
  spaceId: string;
}>();

const emit = defineEmits<{
  "boost-click": [];
}>();

const pool = usePoolStore();
const space = computedAsync(() => pool.getServer(props.spaceId));

// Boost level thresholds (approximate: 2, 7, 14)
const levelThresholds = [0, 2, 7, 14];

const progressPercent = computed(() => {
  if (!space.value) return 0;
  const level = space.value.boostLevel;
  const count = space.value.boostCount;
  const currentThreshold = levelThresholds[level] ?? 0;
  const nextThreshold = levelThresholds[level + 1];
  if (!nextThreshold) return 100;
  const progress = (count - currentThreshold) / (nextThreshold - currentThreshold);
  return Math.min(Math.max(progress * 100, 0), 100);
});
</script>

<style scoped>
.boost-banner {
  background: linear-gradient(135deg, hsl(270 50% 15% / 0.8), hsl(280 40% 12% / 0.8));
  border-bottom: 1px solid hsl(270 30% 25% / 0.5);
}
</style>
