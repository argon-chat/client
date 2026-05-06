<template>
  <div class="grid grid-cols-3 gap-2 p-2">
    <button
      v-for="preset in PRESETS"
      :key="preset.id"
      class="flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all"
      :class="activePreset === preset.id
        ? 'border-primary bg-primary/10'
        : 'border-transparent hover:bg-accent/50'"
      @click="applyPreset(preset)"
    >
      <div
        class="w-full aspect-square rounded-md overflow-hidden bg-muted"
        :style="{ filter: presetCSSFilter(preset) }"
      >
        <img
          v-if="thumbnailSrc"
          :src="thumbnailSrc"
          class="w-full h-full object-cover"
          draggable="false"
        />
        <div v-else class="w-full h-full bg-gradient-to-br from-blue-400 to-purple-500" />
      </div>
      <span class="text-[11px] font-medium text-center leading-tight">{{ t(preset.labelKey) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { PRESETS, type Preset } from '../presets';
import { adjustmentKeys } from '../adjustments';

const { t } = useI18n();
const { store } = useMediaEditorContext();

const thumbnailSrc = computed(() => store.mediaSrc || null);

const activePreset = computed(() => {
  for (const preset of PRESETS) {
    if (preset.id === 'none') {
      const allZero = adjustmentKeys.every(k => store.mediaState.adjustments[k] === 0);
      if (allZero) return 'none';
      continue;
    }
    const matches = adjustmentKeys.every(k => {
      const expected = preset.values[k] ?? 0;
      return Math.abs(store.mediaState.adjustments[k] - expected) < 0.001;
    });
    if (matches) return preset.id;
  }
  return null;
});

function applyPreset(preset: Preset) {
  const oldAdj = { ...store.mediaState.adjustments };
  for (const key of adjustmentKeys) {
    store.mediaState.adjustments[key] = preset.values[key] ?? 0;
  }
  store.pushToHistory({
    path: ['adjustments'],
    oldValue: oldAdj,
    newValue: { ...store.mediaState.adjustments },
  });
}

function presetCSSFilter(preset: Preset): string {
  const parts: string[] = [];
  const b = preset.values.brightness ?? 0;
  const c = preset.values.contrast ?? 0;
  const s = preset.values.saturation ?? 0;
  if (b) parts.push(`brightness(${1 + b})`);
  if (c) parts.push(`contrast(${1 + c})`);
  if (s) parts.push(`saturate(${1 + s})`);
  return parts.join(' ') || 'none';
}
</script>
