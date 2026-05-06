<template>
  <div class="p-4">
    <!-- Colors -->
    <div class="flex flex-wrap gap-2 mb-5 transition-opacity" :class="{ 'opacity-25 pointer-events-none': !hasColor }">
      <button
        v-for="color in presetColors"
        :key="color"
        class="size-8 rounded-full border-2 cursor-pointer transition-transform duration-100"
        :class="store.uiState.currentBrush.color === color ? 'border-foreground scale-115' : 'border-transparent hover:scale-110'"
        :style="{ backgroundColor: color }"
        :disabled="!hasColor"
        @click="store.uiState.currentBrush.color = color"
      />
      <!-- Eyedropper -->
      <button
        v-if="hasEyeDropper"
        class="size-8 rounded-full border-2 border-dashed border-muted-foreground/50 cursor-pointer flex items-center justify-center transition-transform hover:scale-110 text-muted-foreground hover:text-foreground"
        :disabled="!hasColor"
        @click="pickColor"
        :title="t('media_editor_eyedropper')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m2 22 1-1h3l9-9M3 21v-3l9-9"/>
          <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4"/>
        </svg>
      </button>
    </div>

    <!-- Size -->
    <div class="mb-5">
      <RangeInput
        :label="t('media_editor_size')"
        :model-value="normalizedSize"
        :min="0"
        :max="1"
        @update:model-value="updateSize"
      />
    </div>

    <!-- Tools -->
    <div class="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3 px-2">{{ t('media_editor_tool') }}</div>
    <div class="flex flex-col gap-0.5">
      <button
        v-for="brush in brushTypes"
        :key="brush.id"
        class="flex items-center gap-3.5 px-3 py-2.5 rounded-lg border-none text-sm cursor-pointer transition-colors duration-150"
        :class="store.uiState.currentBrush.brush === brush.id ? 'bg-accent text-foreground' : 'bg-transparent text-foreground hover:bg-accent/50'"
        @click="selectBrush(brush.id)"
      >
        <div
          class="size-8 rounded-lg flex items-center justify-center shrink-0"
          :class="store.uiState.currentBrush.brush === brush.id ? 'bg-primary/15' : 'bg-muted'"
          :style="brush.id in brushColorMap ? { color: brushColorMap[brush.id] } : {}"
        >
          <component :is="brush.icon" :size="20" />
        </div>
        <span>{{ t(brush.labelKey) }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import type { BrushType } from '../types';
import RangeInput from '../components/RangeInput.vue';
import { PenLine, MoveUpRight, Paintbrush, Sparkles, CircleDot, Eraser } from 'lucide-vue-next';

const { t } = useI18n();
const { store } = useMediaEditorContext();

const MIN_SIZE = 2;
const MAX_SIZE = 32;

const brushTypes: { id: BrushType; labelKey: string; icon: any }[] = [
  { id: 'pen', labelKey: 'media_editor_brush_pen', icon: PenLine },
  { id: 'arrow', labelKey: 'media_editor_brush_arrow', icon: MoveUpRight },
  { id: 'brush', labelKey: 'media_editor_brush_marker', icon: Paintbrush },
  { id: 'neon', labelKey: 'media_editor_brush_neon', icon: Sparkles },
  { id: 'blur', labelKey: 'media_editor_brush_blur', icon: CircleDot },
  { id: 'eraser', labelKey: 'media_editor_brush_eraser', icon: Eraser }
];

const presetColors = [
  '#fe4438', '#ff8901', '#ffd60a', '#33c759', '#62e5e0',
  '#0a84ff', '#bd5cf3', '#ffffff', '#000000'
];

const brushColorMap: Record<string, string> = {
  pen: '#fe4438',
  arrow: '#ffd60a',
  brush: '#ff8901',
  neon: '#62e5e0'
};

const hasColor = computed(() => store.uiState.currentBrush.brush in brushColorMap);

const normalizedSize = computed(() => {
  return (store.uiState.currentBrush.size - MIN_SIZE) / (MAX_SIZE - MIN_SIZE);
});

function updateSize(normalized: number) {
  store.uiState.currentBrush.size = Math.round(MIN_SIZE + normalized * (MAX_SIZE - MIN_SIZE));
}

function selectBrush(id: BrushType) {
  store.uiState.currentBrush.brush = id;
  if (id in brushColorMap) {
    store.uiState.currentBrush.color = brushColorMap[id];
  }
}

const hasEyeDropper = 'EyeDropper' in window;

async function pickColor() {
  try {
    const dropper = new (window as any).EyeDropper();
    const result = await dropper.open();
    if (result?.sRGBHex) {
      store.uiState.currentBrush.color = result.sRGBHex;
    }
  } catch { /* user cancelled */ }
}
</script>
