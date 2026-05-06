<template>
  <div class="flex flex-col gap-0.5 py-2">
    <!-- Video quality selector -->
    <StepInput
      v-if="store.mediaType === 'video' && qualitySteps.length > 1"
      label="Quality"
      :model-value="effectiveQuality"
      :steps="qualitySteps"
      @update:model-value="store.mediaState.videoQuality = $event"
    />

    <!-- Enhance (standalone, prominent) -->
    <div class="px-4 py-3">
      <div class="flex items-center gap-2.5 mb-2">
        <Sparkles :size="16" class="shrink-0" :class="store.mediaState.adjustments.enhance !== 0 ? 'text-primary' : 'text-muted-foreground'" />
        <span class="text-[13px] font-semibold text-foreground flex-1">{{ t('media_editor_enhance') }}</span>
        <button
          v-if="store.mediaState.adjustments.enhance !== 0"
          class="text-[10px] text-muted-foreground hover:text-foreground bg-muted px-1.5 py-0.5 rounded cursor-pointer border-none"
          @click="resetAdjustment('enhance')"
        >{{ t('media_editor_reset') }}</button>
        <span class="text-xs tabular-nums min-w-[28px] text-right" :class="store.mediaState.adjustments.enhance !== 0 ? 'text-primary' : 'text-muted-foreground'">{{ store.mediaState.adjustments.enhance ? Math.round(store.mediaState.adjustments.enhance * 100) : '' }}</span>
      </div>
      <RangeInput
        :model-value="store.mediaState.adjustments.enhance"
        :min="0" :max="1" :to100="true" compact
        @update:model-value="updateAdjustment('enhance', $event)"
      />
    </div>

    <!-- Light section -->
    <AdjustmentSection :title="t('media_editor_section_light')" :initially-open="true">
      <AdjustmentRow key="brightness" :label="t('media_editor_brightness')" :icon="Sun" :value="store.mediaState.adjustments.brightness" bipolar @update="v => updateAdjustment('brightness', v)" @reset="resetAdjustment('brightness')" />
      <AdjustmentRow key="contrast" :label="t('media_editor_contrast')" :icon="Contrast" :value="store.mediaState.adjustments.contrast" bipolar @update="v => updateAdjustment('contrast', v)" @reset="resetAdjustment('contrast')" />
      <AdjustmentRow key="highlights" :label="t('media_editor_highlights')" :icon="Sunrise" :value="store.mediaState.adjustments.highlights" bipolar @update="v => updateAdjustment('highlights', v)" @reset="resetAdjustment('highlights')" />
      <AdjustmentRow key="shadows" :label="t('media_editor_shadows')" :icon="Moon" :value="store.mediaState.adjustments.shadows" bipolar @update="v => updateAdjustment('shadows', v)" @reset="resetAdjustment('shadows')" />
      <AdjustmentRow key="fade" :label="t('media_editor_fade')" :icon="CloudFog" :value="store.mediaState.adjustments.fade" @update="v => updateAdjustment('fade', v)" @reset="resetAdjustment('fade')" />
    </AdjustmentSection>

    <!-- Color section -->
    <AdjustmentSection :title="t('media_editor_section_color')">
      <AdjustmentRow key="saturation" :label="t('media_editor_saturation')" :icon="Droplets" :value="store.mediaState.adjustments.saturation" bipolar @update="v => updateAdjustment('saturation', v)" @reset="resetAdjustment('saturation')" />
      <AdjustmentRow key="warmth" :label="t('media_editor_warmth')" :icon="Thermometer" :value="store.mediaState.adjustments.warmth" bipolar @update="v => updateAdjustment('warmth', v)" @reset="resetAdjustment('warmth')" />
    </AdjustmentSection>

    <!-- Detail section -->
    <AdjustmentSection :title="t('media_editor_section_detail')">
      <AdjustmentRow key="sharpen" :label="t('media_editor_sharpen')" :icon="Diamond" :value="store.mediaState.adjustments.sharpen" @update="v => updateAdjustment('sharpen', v)" @reset="resetAdjustment('sharpen')" />
      <AdjustmentRow key="grain" :label="t('media_editor_grain')" :icon="ScanLine" :value="store.mediaState.adjustments.grain" @update="v => updateAdjustment('grain', v)" @reset="resetAdjustment('grain')" />
      <AdjustmentRow key="vignette" :label="t('media_editor_vignette')" :icon="Aperture" :value="store.mediaState.adjustments.vignette" @update="v => updateAdjustment('vignette', v)" @reset="resetAdjustment('vignette')" />
    </AdjustmentSection>

    <!-- Effects section -->
    <AdjustmentSection :title="t('media_editor_section_effects')">
      <AdjustmentRow key="tiltShift" :label="t('media_editor_tilt_shift')" :icon="Mountain" :value="store.mediaState.adjustments.tiltShift" @update="v => updateAdjustment('tiltShift', v)" @reset="resetAdjustment('tiltShift')" />
      <AdjustmentRow key="chromatic" :label="t('media_editor_chromatic')" :icon="Rainbow" :value="store.mediaState.adjustments.chromatic" @update="v => updateAdjustment('chromatic', v)" @reset="resetAdjustment('chromatic')" />
      <AdjustmentRow key="fisheye" :label="t('media_editor_fisheye')" :icon="CircleDot" :value="store.mediaState.adjustments.fisheye" bipolar @update="v => updateAdjustment('fisheye', v)" @reset="resetAdjustment('fisheye')" />
      <AdjustmentRow key="glitch" :label="t('media_editor_glitch')" :icon="Zap" :value="store.mediaState.adjustments.glitch" @update="v => updateAdjustment('glitch', v)" @reset="resetAdjustment('glitch')" />
      <AdjustmentRow key="motionBlur" :label="t('media_editor_motion_blur')" :icon="Wind" :value="store.mediaState.adjustments.motionBlur" @update="v => updateAdjustment('motionBlur', v)" @reset="resetAdjustment('motionBlur')" />
    </AdjustmentSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { type AdjustmentKey } from '../adjustments';
import { QUALITY_PRESETS, resolveOutputQuality } from '../constants';
import RangeInput from '../components/RangeInput.vue';
import StepInput from '../components/StepInput.vue';
import AdjustmentSection from '../components/AdjustmentSection.vue';
import AdjustmentRow from '../components/AdjustmentRow.vue';
import {
  Sparkles, Sun, Contrast, Droplets, Thermometer,
  CloudFog, Sunrise, Moon, Aperture, ScanLine, Diamond,
  Mountain, Rainbow, CircleDot, Zap, Wind
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

function updateAdjustment(key: AdjustmentKey, value: number) {
  const oldValue = store.mediaState.adjustments[key];
  store.mediaState.adjustments[key] = value;
  store.pushToHistory({
    path: ['adjustments', key],
    oldValue,
    newValue: value
  });
}

function resetAdjustment(key: AdjustmentKey) {
  updateAdjustment(key, 0);
}
</script>
