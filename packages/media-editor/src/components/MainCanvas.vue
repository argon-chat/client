<template>
  <div class="relative isolate bg-black flex-1 overflow-hidden" ref="containerEl">
    <ImageCanvas ref="imageCanvasRef" />
    <BrushCanvas ref="brushCanvasRef" />
    <TextLayers />
    <CropHandles />
    <RotationWheel v-if="store.uiState.currentTab === 'crop'" />
    <BeforeAfter :visible="store.uiState.showBeforeAfter" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, provide } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { useFinalTransform } from '../composables/useFinalTransform';
import { MASK_PAINTER_KEY, type MaskPainterSlot } from '../composables/useMaskPainter';
import ImageCanvas from './ImageCanvas.vue';
import BrushCanvas from './BrushCanvas.vue';
import CropHandles from './CropHandles.vue';
import RotationWheel from './RotationWheel.vue';
import TextLayers from './TextLayers.vue';
import BeforeAfter from './BeforeAfter.vue';

const { store } = useMediaEditorContext();

// Initialize finalTransform computation
useFinalTransform();

const maskPainter: MaskPainterSlot = { current: null };
provide(MASK_PAINTER_KEY, maskPainter);

const containerEl = ref<HTMLDivElement | null>(null);
const imageCanvasRef = ref<InstanceType<typeof ImageCanvas> | null>(null);
const brushCanvasRef = ref<InstanceType<typeof BrushCanvas> | null>(null);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!containerEl.value) return;
  updateCanvasSize();
  resizeObserver = new ResizeObserver(() => { updateCanvasSize(); });
  resizeObserver.observe(containerEl.value);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});

function updateCanvasSize() {
  if (!containerEl.value) return;
  const rect = containerEl.value.getBoundingClientRect();
  store.uiState.canvasSize = [rect.width, rect.height];
  store.uiState.pixelRatio = window.devicePixelRatio;
}
</script>

<style scoped>
canvas {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
</style>
