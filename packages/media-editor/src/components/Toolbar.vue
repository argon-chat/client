<template>
  <div class="flex flex-col flex-1 overflow-hidden">
    <div class="relative flex shrink-0 shadow-sm">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="flex-1 py-3 bg-transparent border-none cursor-pointer transition-colors duration-150 flex items-center justify-center"
        :class="store.uiState.currentTab === tab.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="store.uiState.currentTab = tab.id"
      >
        <component :is="tab.icon" />
      </button>
      <div
        class="absolute bottom-0 -translate-x-1/2 w-6 h-[3px] rounded-t-sm bg-primary transition-[left] duration-200"
        :style="underlineStyle"
      />
    </div>

    <div class="flex-1 overflow-y-auto overscroll-contain p-2 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
      <PresetsTab v-if="store.uiState.currentTab === 'presets'" />
      <AdjustmentsTab v-else-if="store.uiState.currentTab === 'adjustments'" />
      <CurvesTab v-else-if="store.uiState.currentTab === 'curves'" />
      <CropTab v-else-if="store.uiState.currentTab === 'crop'" />
      <BrushTab v-else-if="store.uiState.currentTab === 'brush'" />
      <TextTab v-else-if="store.uiState.currentTab === 'text'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { SlidersHorizontal, Crop, Pen, Type, Palette, Blend } from 'lucide-vue-next';
import PresetsTab from '../tabs/PresetsTab.vue';
import AdjustmentsTab from '../tabs/AdjustmentsTab.vue';
import CropTab from '../tabs/CropTab.vue';
import BrushTab from '../tabs/BrushTab.vue';
import TextTab from '../tabs/TextTab.vue';
import CurvesTab from '../tabs/CurvesTab.vue';

const { store, mode } = useMediaEditorContext();

const allTabs = [
  { id: 'presets', icon: Palette },
  { id: 'crop', icon: Crop },
  { id: 'adjustments', icon: SlidersHorizontal },
  { id: 'curves', icon: Blend },
  { id: 'brush', icon: Pen },
  { id: 'text', icon: Type }
];

const tabs = computed(() => {
  return allTabs;
});

const underlineStyle = computed(() => {
  const list = tabs.value;
  const idx = list.findIndex(t => t.id === store.uiState.currentTab);
  if (idx === -1) return { opacity: '0' };
  const pct = ((idx + 0.5) / list.length) * 100;
  return { left: pct + '%', transform: 'translateX(-50%)' };
});
</script>
