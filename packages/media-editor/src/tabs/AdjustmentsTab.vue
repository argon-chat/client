<template>
  <div class="flex flex-col gap-1 py-2">
    <!-- Video quality selector -->
    <StepInput
      v-if="store.mediaType === 'video' && qualitySteps.length > 1"
      label="Quality"
      :model-value="effectiveQuality"
      :steps="qualitySteps"
      @update:model-value="store.mediaState.videoQuality = $event"
    />

    <div
      v-for="item in adjustmentsConfig"
      :key="item.key"
      class="group px-4 py-2 rounded-lg transition-colors hover:bg-accent/50"
    >
      <div class="flex items-center gap-2.5 mb-2">
        <component
          :is="iconMap[item.icon]"
          :size="16"
          class="shrink-0 transition-colors"
          :class="store.mediaState.adjustments[item.key] !== 0 ? 'text-primary' : 'text-muted-foreground'"
        />
        <span class="text-[13px] font-medium text-foreground flex-1">{{ t(item.labelKey) }}</span>
        <span
          class="text-xs tabular-nums min-w-[32px] text-right transition-colors"
          :class="store.mediaState.adjustments[item.key] !== 0 ? 'text-primary' : 'text-muted-foreground'"
        >{{ formatValue(item) }}</span>
      </div>
      <RangeInput
        :model-value="store.mediaState.adjustments[item.key]"
        :min="item.to100 ? 0 : -1"
        :max="1"
        :to100="item.to100"
        compact
        @update:model-value="updateAdjustment(item.key, $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { adjustmentsConfig, type AdjustmentKey } from '../adjustments';
import { QUALITY_PRESETS, resolveOutputQuality } from '../constants';
import RangeInput from '../components/RangeInput.vue';
import StepInput from '../components/StepInput.vue';
import {
  Sparkles, Sun, Contrast, Droplets, Thermometer,
  CloudFog, Sunrise, Moon, Aperture, ScanLine, Diamond
} from 'lucide-vue-next';

const { t } = useI18n();
const { store } = useMediaEditorContext();

// --- Quality ---
const maxQuality = computed(() => {
  const mediaHeight = store.uiState.renderingPayload?.media?.height ?? 1080;
  return resolveOutputQuality(mediaHeight);
});

const qualitySteps = computed(() =>
  QUALITY_PRESETS
    .filter(h => h <= maxQuality.value)
    .map(h => ({ value: h, label: h + 'p' }))
);

const effectiveQuality = computed(() =>
  Math.min(maxQuality.value, store.mediaState.videoQuality || maxQuality.value)
);

const iconMap: Record<string, any> = {
  'sparkles': Sparkles,
  'sun': Sun,
  'contrast': Contrast,
  'droplets': Droplets,
  'thermometer': Thermometer,
  'cloud-fog': CloudFog,
  'sunrise': Sunrise,
  'moon': Moon,
  'aperture': Aperture,
  'scan-line': ScanLine,
  'diamond': Diamond
};

function formatValue(item: typeof adjustmentsConfig[number]) {
  const v = store.mediaState.adjustments[item.key];
  if (v === 0) return '';
  if (item.to100) return Math.round(v * 100);
  return (v > 0 ? '+' : '') + Math.round(v * 100);
}

function updateAdjustment(key: AdjustmentKey, value: number) {
  const oldValue = store.mediaState.adjustments[key];
  store.mediaState.adjustments[key] = value;
  store.pushToHistory({
    path: ['adjustments', key],
    oldValue,
    newValue: value
  });
}
</script>
