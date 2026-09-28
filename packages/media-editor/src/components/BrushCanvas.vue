<template>
  <canvas ref="canvasEl" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, watchEffect } from 'vue';
import { useMediaEditorContext, useEscape } from '../composables/useMediaEditorContext';
import { useMaskPainterSlot } from '../composables/useMaskPainter';
import { createBrushPainter, type BrushDrawnLine, type BrushPainterAPI } from '../canvas/brushPainter';
import { isMaskBrush, type Vec2 } from '../types';

const { store } = useMediaEditorContext();
const maskPainter = useMaskPainterSlot();
const canvasEl = ref<HTMLCanvasElement | null>(null);

let painter: BrushPainterAPI | null = null;
let currentLine: BrushDrawnLine | null = null;
let isDrawing = false;
let isMasking = false;

// Erase / restore show their footprint as the cursor (browsers cap cursor images at 128 px).
watchEffect(() => {
  const el = canvasEl.value;
  if (!el) return;
  const brush = store.uiState.currentBrush.brush;
  if (store.uiState.currentTab !== 'brush' || !isMaskBrush(brush)) {
    el.style.cursor = '';
    return;
  }
  const d = Math.max(4, Math.min(126, Math.round(store.uiState.maskBrushSize)));
  const r = d / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d + 2}" height="${d + 2}"><circle cx="${r + 1}" cy="${r + 1}" r="${r}" fill="none" stroke="black" stroke-opacity=".6" stroke-width="2"/><circle cx="${r + 1}" cy="${r + 1}" r="${r}" fill="none" stroke="white" stroke-width="1"/></svg>`;
  el.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(r + 1)} ${Math.round(r + 1)}, crosshair`;
});

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
  if (!canvasEl.value) return;

  const brush = store.uiState.currentBrush.brush;
  if (isMaskBrush(brush)) {
    const target = maskPainter.current;
    if (!target) return;
    isMasking = true;
    canvasEl.value.setPointerCapture(e.pointerId);
    target.begin(brush === 'maskErase' ? 'erase' : 'restore', store.uiState.maskBrushSize * store.uiState.pixelRatio, getCanvasPoint(e));
    return;
  }

  if (!painter) return;
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
  if (isMasking) {
    maskPainter.current?.extend(getCanvasPoint(e));
    return;
  }
  if (!isDrawing || !currentLine || !painter) return;
  currentLine.points.push(getCanvasPoint(e));
  painter.preview(currentLine);
}

function onPointerUp(_e: PointerEvent) {
  if (isMasking) {
    isMasking = false;
    maskPainter.current?.end();
    return;
  }
  if (!isDrawing || !currentLine || !painter) return;
  isDrawing = false;

  painter.preview(currentLine, true);
  painter.commit();

  store.addBrushLine(currentLine);
  shownLines = store.mediaState.brushDrawnLines.length;

  currentLine = null;
}

// Undo and redo add and take lines: the canvas redraws what the state has (a line just drawn is
// already on it).
let shownLines = store.mediaState.brushDrawnLines.length;
watch(
  () => [store.mediaState.brushDrawnLines, store.mediaState.brushDrawnLines.length],
  () => {
    const count = store.mediaState.brushDrawnLines.length;
    if (isDrawing || !painter || count === shownLines) return;
    shownLines = count;
    painter.redrawAll(store.mediaState.brushDrawnLines);
  }
);

// Esc drops the stroke being drawn.
useEscape(() => {
  if (isMasking) {
    isMasking = false;
    return maskPainter.current?.cancel() ?? true;
  }
  if (!isDrawing) return false;
  isDrawing = false;
  currentLine = null;
  painter?.discard();
  return true;
});

onMounted(() => {
  canvasEl.value?.addEventListener('pointerdown', onPointerDown);
  canvasEl.value?.addEventListener('pointermove', onPointerMove);
  canvasEl.value?.addEventListener('pointerup', onPointerUp);
  canvasEl.value?.addEventListener('pointercancel', onPointerUp);
});

onBeforeUnmount(() => {
  canvasEl.value?.removeEventListener('pointerdown', onPointerDown);
  canvasEl.value?.removeEventListener('pointermove', onPointerMove);
  canvasEl.value?.removeEventListener('pointerup', onPointerUp);
  canvasEl.value?.removeEventListener('pointercancel', onPointerUp);
});

defineExpose({ canvasEl });
</script>
