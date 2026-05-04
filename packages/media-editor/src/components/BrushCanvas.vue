<template>
  <canvas ref="canvasEl" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { createBrushPainter, type BrushDrawnLine, type BrushPainterAPI } from '../canvas/brushPainter';
import type { Vec2 } from '../types';

const { store } = useMediaEditorContext();
const canvasEl = ref<HTMLCanvasElement | null>(null);

let painter: BrushPainterAPI | null = null;
let currentLine: BrushDrawnLine | null = null;
let isDrawing = false;

onMounted(() => {
  if (!canvasEl.value) return;
  store.uiState.brushCanvas = canvasEl.value;
});

watch(
  () => store.uiState.isReady,
  (ready) => {
    if (ready) initPainter();
  }
);

watch(
  () => store.uiState.canvasSize,
  () => {
    updateSize();
    initPainter();
  },
  { deep: true }
);

function updateSize() {
  if (!canvasEl.value || !store.uiState.canvasSize) return;
  const dpr = store.uiState.pixelRatio;
  const [w, h] = store.uiState.canvasSize;
  canvasEl.value.width = w * dpr;
  canvasEl.value.height = h * dpr;
}

function initPainter() {
  if (!canvasEl.value || !store.uiState.imageCanvas) return;
  updateSize();
  painter = createBrushPainter({
    targetCanvas: canvasEl.value,
    imageCanvas: store.uiState.imageCanvas
  });
  // Redraw existing lines
  if (store.mediaState.brushDrawnLines.length) {
    painter.redrawAll(store.mediaState.brushDrawnLines);
  }
}

function getCanvasPoint(e: PointerEvent): Vec2 {
  if (!canvasEl.value) return [0, 0];
  const rect = canvasEl.value.getBoundingClientRect();
  const dpr = store.uiState.pixelRatio;
  return [
    (e.clientX - rect.left) * dpr,
    (e.clientY - rect.top) * dpr
  ];
}

function onPointerDown(e: PointerEvent) {
  if (store.uiState.currentTab !== 'brush') return;
  if (!painter || !canvasEl.value) return;

  isDrawing = true;
  canvasEl.value.setPointerCapture(e.pointerId);

  currentLine = {
    color: store.uiState.currentBrush.color,
    brush: store.uiState.currentBrush.brush,
    size: store.uiState.currentBrush.size * store.uiState.pixelRatio,
    points: [getCanvasPoint(e)]
  };

  painter.preview(currentLine);
}

function onPointerMove(e: PointerEvent) {
  if (!isDrawing || !currentLine || !painter) return;
  currentLine.points.push(getCanvasPoint(e));
  painter.preview(currentLine);
}

function onPointerUp(_e: PointerEvent) {
  if (!isDrawing || !currentLine || !painter) return;
  isDrawing = false;

  painter.preview(currentLine, true);
  painter.commit();

  store.mediaState.brushDrawnLines.push(currentLine);
  store.pushToHistory({
    path: ['brushDrawnLines', store.mediaState.brushDrawnLines.length - 1],
    oldValue: 'SSBiZWxpZXZlIEkgY2FuIGZseSwgSSBiZWxpZXZlIEkgY2FuIHRvdWNoIHRoZSBza3kh',
    newValue: currentLine
  });

  currentLine = null;
}

onMounted(() => {
  canvasEl.value?.addEventListener('pointerdown', onPointerDown);
  canvasEl.value?.addEventListener('pointermove', onPointerMove);
  canvasEl.value?.addEventListener('pointerup', onPointerUp);
});

onBeforeUnmount(() => {
  canvasEl.value?.removeEventListener('pointerdown', onPointerDown);
  canvasEl.value?.removeEventListener('pointermove', onPointerMove);
  canvasEl.value?.removeEventListener('pointerup', onPointerUp);
});

defineExpose({ canvasEl });
</script>
