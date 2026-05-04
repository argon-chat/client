<template>
  <div class="flex flex-col gap-5 p-4">
    <!-- Colors -->
    <div class="flex flex-wrap gap-2">
      <button
        v-for="color in presetColors"
        :key="color"
        class="size-8 rounded-full border-2 cursor-pointer transition-transform duration-100"
        :class="store.uiState.currentTextLayerInfo.color === color ? 'border-foreground scale-115' : 'border-transparent'"
        :style="{ backgroundColor: color }"
        @click="store.uiState.currentTextLayerInfo.color = color"
      />
    </div>

    <!-- Alignment & Style toggles -->
    <div class="flex gap-3">
      <div class="flex bg-muted/50 rounded-lg overflow-hidden">
        <button
          v-for="align in alignments"
          :key="align.value"
          class="px-3 py-2 flex items-center cursor-pointer transition-all duration-150 border-none"
          :class="store.uiState.currentTextLayerInfo.alignment === align.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="store.uiState.currentTextLayerInfo.alignment = align.value"
        >
          <component :is="align.icon" :size="18" />
        </button>
      </div>

      <div class="flex bg-muted/50 rounded-lg overflow-hidden">
        <button
          v-for="style in textStyles"
          :key="style.value"
          class="px-3 py-2 flex items-center cursor-pointer transition-all duration-150 border-none"
          :class="store.uiState.currentTextLayerInfo.style === style.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="store.uiState.currentTextLayerInfo.style = style.value"
        >
          <component :is="style.icon" :size="18" />
        </button>
      </div>
    </div>

    <!-- Size slider -->
    <RangeInput
      :label="t('media_editor_size')"
      :model-value="normalizedSize"
      :min="0"
      :max="1"
      @update:model-value="updateSize"
    />

    <!-- Font list -->
    <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground px-2">{{ t('media_editor_font') }}</div>
    <div class="flex flex-col gap-0.5">
      <button
        v-for="font in fonts"
        :key="font.key"
        class="flex items-center gap-3.5 px-3 py-2.5 rounded-lg border-none text-sm cursor-pointer transition-colors duration-150"
        :class="store.uiState.currentTextLayerInfo.font === font.key ? 'bg-accent text-foreground' : 'bg-transparent text-foreground hover:bg-accent/50'"
        @click="store.uiState.currentTextLayerInfo.font = font.key"
      >
        <span
          class="size-9 rounded-lg flex items-center justify-center text-lg shrink-0"
          :class="store.uiState.currentTextLayerInfo.font === font.key ? 'bg-primary/15 text-primary' : 'bg-muted'"
          :style="{ fontFamily: font.fontFamily, fontWeight: font.fontWeight }"
        >Aa</span>
        <span class="text-sm">{{ t(font.labelKey) }}</span>
      </button>
    </div>

    <!-- Add text button -->
    <button
      class="flex items-center justify-center gap-2 py-3.5 rounded-xl border-none text-[15px] font-medium cursor-pointer transition-colors duration-150 bg-primary/10 text-primary hover:bg-primary/20"
      @click="addTextLayer"
    >
      <Plus :size="18" />
      {{ t('media_editor_add_text') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { FONT_REGISTRY } from '../constants';
import type { FontKey } from '../types';
import RangeInput from '../components/RangeInput.vue';
import {
  AlignLeft, AlignCenter, AlignRight,
  Type, Baseline, Square,
  Plus
} from 'lucide-vue-next';

const { t } = useI18n();
const { store } = useMediaEditorContext();

const MIN_SIZE = 16;
const MAX_SIZE = 64;

// Sync currentTextLayerInfo changes to the selected layer
watch(
  () => store.uiState.currentTextLayerInfo,
  (info) => {
    const sel = store.uiState.selectedResizableLayer;
    if (sel == null) return;
    const layer = store.mediaState.resizableLayers.find(l => l.id === sel);
    if (layer?.textInfo) {
      layer.textInfo.font = info.font;
      layer.textInfo.size = info.size;
      layer.textInfo.color = info.color;
      layer.textInfo.alignment = info.alignment;
      layer.textInfo.style = info.style;
    }
  },
  { deep: true }
);

const fonts: { key: FontKey; fontFamily: string; fontWeight: number; labelKey: string }[] = Object.entries(FONT_REGISTRY).map(([key, info]) => ({
  key: key as FontKey,
  fontFamily: info.fontFamily,
  fontWeight: info.fontWeight,
  labelKey: `media_editor_font_${key}`
}));

const textStyles = [
  { value: 'normal', icon: Type },
  { value: 'outline', icon: Baseline },
  { value: 'background', icon: Square }
];

const alignments = [
  { value: 'left', icon: AlignLeft },
  { value: 'center', icon: AlignCenter },
  { value: 'right', icon: AlignRight }
];

const presetColors = [
  '#ffffff', '#000000', '#fe4438', '#ff8901', '#ffd60a',
  '#33c759', '#0a84ff', '#bd5cf3'
];

const normalizedSize = computed(() => {
  return (store.uiState.currentTextLayerInfo.size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE);
});

function updateSize(normalized: number) {
  store.uiState.currentTextLayerInfo.size = Math.round(MIN_SIZE + normalized * (MAX_SIZE - MIN_SIZE));
}

function addTextLayer() {
  const id = Date.now() + Math.random();
  const center = store.uiState.canvasSize
    ? [store.uiState.canvasSize[0] / 2, store.uiState.canvasSize[1] / 2] as [number, number]
    : [200, 200] as [number, number];

  store.mediaState.resizableLayers.push({
    id,
    type: 'text',
    position: center,
    rotation: 0,
    scale: 1,
    textInfo: { ...store.uiState.currentTextLayerInfo, content: 'Text' }
  });

  store.uiState.selectedResizableLayer = id;
}
</script>
