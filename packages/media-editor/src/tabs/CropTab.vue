<template>
  <div class="p-4">
    <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 px-2">{{ t('media_editor_aspect_ratio') }}</div>
    <div class="grid grid-cols-3 gap-2">
      <button
        v-for="ratio in visibleRatios"
        :key="ratio.key ?? 'free'"
        class="flex flex-col items-center gap-2 py-3 px-2 rounded-lg border text-xs cursor-pointer transition-all duration-150 disabled:opacity-30 disabled:cursor-default disabled:pointer-events-none"
        :class="store.uiState.fixedImageRatioKey === ratio.key ? 'border-primary text-primary' : 'border-border text-muted-foreground hover:border-foreground/30'"
        :disabled="ratio.disabled"
        @click="selectRatio(ratio)"
      >
        <div class="border-2 border-current rounded-sm" :style="ratio.style" />
        <span>{{ ratio.labelKey ? t(ratio.labelKey) : ratio.label }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { useCropOffset } from '../composables/useCropOffset';
import { fitToAspectRatio, mix, mixArray } from '../geometry';
import { tween } from '../animation';
import type { Vec2 } from '../types';

const { t } = useI18n();
const { store, mode } = useMediaEditorContext();
const cropOffset = useCropOffset();
const isAvatar = mode === 'avatar';

type RatioItem = {
  key: string | undefined;
  label?: string;
  labelKey?: string;
  style: Record<string, string>;
  ratio?: number;
  disabled?: boolean;
};

const allRatios: RatioItem[] = [
  { key: undefined, labelKey: 'media_editor_free', style: { width: '18px', height: '14px' }, disabled: isAvatar },
  { key: 'original', labelKey: 'media_editor_original', style: { width: '18px', height: '14px' }, disabled: isAvatar },
  { key: '1x1', label: '1:1', style: { width: '14px', height: '14px' }, ratio: 1 },
  { key: '3x2', label: '3:2', style: { width: '15px', height: '10px' }, ratio: 3 / 2, disabled: isAvatar },
  { key: '2x3', label: '2:3', style: { width: '10px', height: '15px' }, ratio: 2 / 3, disabled: isAvatar },
  { key: '4x3', label: '4:3', style: { width: '16px', height: '12px' }, ratio: 4 / 3, disabled: isAvatar },
  { key: '3x4', label: '3:4', style: { width: '12px', height: '16px' }, ratio: 3 / 4, disabled: isAvatar },
  { key: '16x9', label: '16:9', style: { width: '18px', height: '10px' }, ratio: 16 / 9, disabled: isAvatar },
  { key: '9x16', label: '9:16', style: { width: '10px', height: '18px' }, ratio: 9 / 16, disabled: isAvatar }
];

const visibleRatios = computed(() => {
  if (isAvatar) return allRatios.filter(r => !r.disabled);
  return allRatios;
});

function selectRatio(item: RatioItem) {
  store.uiState.fixedImageRatioKey = item.key;
  animateToNewRatio(item);
}

function animateToNewRatio(item: RatioItem) {
  const ms = store.uiState.mediaSize;
  if (!ms) return;

  const co = cropOffset.value;
  const [w, h] = ms;
  const origRatio = w / h;

  let ratio: number;
  if (item.key === 'original') {
    ratio = origRatio;
  } else if (item.ratio) {
    ratio = item.ratio;
  } else {
    // Free - use original
    ratio = origRatio;
  }

  const [w1, h1] = fitToAspectRatio(origRatio, co.width, co.height);
  const [w2, h2] = fitToAspectRatio(ratio, co.width, co.height);

  const initScale = store.mediaState.scale;
  const initTrans = [...store.mediaState.translation] as Vec2;
  const targetScale = Math.max(w2 / w1, h2 / h1);

  store.mediaState.currentImageRatio = ratio;
  store.uiState.isMoving = true;

  tween({ from: 0, to: 1, duration: 200, onUpdate: (p: number) => {
    store.mediaState.scale = mix(initScale, targetScale, p);
    store.mediaState.translation = mixArray(initTrans, [0, 0], p) as Vec2;
  }, onComplete: () => { store.uiState.isMoving = false; } });
}
</script>
