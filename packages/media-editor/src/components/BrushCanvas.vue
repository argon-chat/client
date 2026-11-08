<template>
  <div ref="surface" data-media-editor-brush-surface class="absolute inset-0 z-[3] select-none touch-none"
    :style="{ pointerEvents: store.uiState.currentTab === 'brush' ? 'auto' : 'none', cursor: 'crosshair' }"
    @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
    @pointercancel="cancelStroke" @lostpointercapture="cancelStroke" />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { useMediaEditorContext, useEscape } from '../composables/useMediaEditorContext';
import { useMaskPainterSlot } from '../composables/useMaskPainter';
import { createBrushPainter, type BrushDrawnLine, type BrushPainterAPI } from '../canvas/brushPainter';
import { isMaskBrush, type Vec2 } from '../types';
import { rasterSize, rasterLine } from '../canvas/annotationSpace';
import { canvasToSource } from '../mask/maskMath';
import { imageProjection, projectionBasis } from '../canvas/projective';

const { store } = useMediaEditorContext();
const maskPainter = useMaskPainterSlot();
const surface = ref<HTMLDivElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
let painter: BrushPainterAPI | null = null;
let currentLine: BrushDrawnLine | null = null;
let activePointer: number | null = null, isMasking = false;
let bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
let pendingDensity = false;
let scale = 1, renderFrame: number | null = null;
let shownLines: BrushDrawnLine[] = [];

function notify(rect?: { x: number; y: number; width: number; height: number }) {
  const old = store.uiState.annotationDirtyRect;
  // A full replay wins over later partial changes until the GPU consumed it.
  if (rect && old) {
    const x = Math.min(rect.x, old.x), y = Math.min(rect.y, old.y);
    store.uiState.annotationDirtyRect = { x, y, width: Math.max(rect.x + rect.width, old.x + old.width) - x,
      height: Math.max(rect.y + rect.height, old.y + old.height) - y };
  } else store.uiState.annotationDirtyRect = rect && store.uiState.annotationUploadedRevision === store.uiState.annotationRevision ? rect : undefined;
  store.uiState.annotationRevision++;
}
function preview(finish = false) {
  if (!painter || !currentLine || !canvasEl.value) return;
  painter.preview(rasterLine(currentLine, scale), finish);
  // Smooth curves and arrow heads can change earlier pixels; upload the stroke's bounds.
  const pad = currentLine.size * scale * 5 + 32;
  const x = Math.max(0, Math.floor(bounds[0] * scale - pad)), y = Math.max(0, Math.floor(bounds[1] * scale - pad));
  const right = Math.min(canvasEl.value.width, Math.ceil(bounds[2] * scale + pad));
  const bottom = Math.min(canvasEl.value.height, Math.ceil(bounds[3] * scale + pad));
  notify({ x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) });
}
function schedulePreview() {
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => { renderFrame = null; preview(); });
}
function initPainter() {
  if (!store.uiState.isReady || !store.uiState.mediaSize || !store.uiState.getSourceImageCanvas) return;
  cancelStroke(); painter?.dispose();
  const canvas = canvasEl.value ?? document.createElement('canvas');
  pendingDensity = false;
  [canvas.width, canvas.height] = store.uiState.annotationRasterSize ?? rasterSize(store.uiState.mediaSize);
  scale = canvas.width / store.uiState.mediaSize[0];
  canvasEl.value = canvas; store.uiState.brushCanvas = canvas;
  painter = createBrushPainter({ targetCanvas: canvas, blurRadius: 10 * scale, imageCanvas: () => store.uiState.getSourceImageCanvas!() });
  redrawAll();
}
function redrawAll() {
  if (!painter || activePointer !== null) return;
  shownLines = [...store.mediaState.brushDrawnLines];
  painter.redrawAll(shownLines.map(line => rasterLine(line, scale))); notify();
}
watch(() => store.uiState.annotationRasterSize, () => {
  if (!painter) return;
  if (activePointer !== null) pendingDensity = true; else initPainter();
});
watch(() => store.uiState.isReady, ready => { if (ready && (store.uiState.currentTab === 'brush' || store.mediaState.brushDrawnLines.length)) initPainter(); });
watch(() => store.mediaState.brushDrawnLines, () => {
  if (shownLines.length === store.mediaState.brushDrawnLines.length && shownLines.every((line, i) => line === store.mediaState.brushDrawnLines[i])) return;
  if (!painter && store.uiState.isReady && store.mediaState.brushDrawnLines.length) initPainter();
  else redrawAll();
}, { deep: true });
watch(() => store.uiState.sourceImageRevision, () => {
  painter?.invalidateSource();
  if (store.mediaState.brushDrawnLines.some(line => line.brush === 'blur')) redrawAll();
});
watch(() => store.uiState.currentTab, tab => { cancelStroke(); if (tab === 'brush' && !painter) initPainter(); });

function canvasPoint(e: PointerEvent): Vec2 {
  const rect = surface.value!.getBoundingClientRect(), dpr = store.uiState.pixelRatio;
  return [(e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr];
}
function sourcePoint(e: PointerEvent): Vec2 {
  const size = store.uiState.canvasSize!, dpr = store.uiState.pixelRatio;
  return canvasToSource(canvasPoint(e), store.uiState.finalTransform,
    [Math.round(size[0] * dpr), Math.round(size[1] * dpr)], store.uiState.mediaSize!);
}
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || activePointer !== null || store.uiState.currentTab !== 'brush' || !painter || !surface.value) return;
  const point = sourcePoint(e); if (!point.every(Number.isFinite)) return;
  const brush = store.uiState.currentBrush.brush;
  if (isMaskBrush(brush) && !maskPainter.current) return;
  e.preventDefault(); e.stopPropagation();
  activePointer = e.pointerId;
  try { surface.value.setPointerCapture(e.pointerId); } catch { /* global release remains available */ }
  if (isMaskBrush(brush)) {
    isMasking = true;
    maskPainter.current!.begin(brush === 'maskErase' ? 'erase' : 'restore', store.uiState.maskBrushSize * store.uiState.pixelRatio, canvasPoint(e));
    return;
  }
  const size = store.uiState.canvasSize!, dpr = store.uiState.pixelRatio;
  const basis = projectionBasis(imageProjection(store.uiState.finalTransform, [Math.round(size[0] * dpr), Math.round(size[1] * dpr)], store.uiState.mediaSize!), point);
  const localScale = Math.sqrt(Math.abs(basis[0] * basis[3] - basis[1] * basis[2]));
  bounds = [point[0], point[1], point[0], point[1]];
  currentLine = { ...store.uiState.currentBrush, coordinateSpace: 'source',
    size: store.uiState.currentBrush.size * dpr / Math.max(1e-6, localScale), points: [point] };
  preview();
}
function onPointerMove(e: PointerEvent) {
  if (activePointer !== e.pointerId) return;
  if (!(e.buttons & 1)) { finishStroke(true); return; }
  e.preventDefault();
  if (isMasking) { maskPainter.current?.extend(canvasPoint(e)); return; }
  const point = sourcePoint(e); if (!point.every(Number.isFinite) || !currentLine) return;
  bounds = [Math.min(bounds[0], point[0]), Math.min(bounds[1], point[1]), Math.max(bounds[2], point[0]), Math.max(bounds[3], point[1])];
  currentLine.points.push(point); schedulePreview();
}
function onPointerUp(e: PointerEvent) {
  if (e.pointerId === activePointer) { e.preventDefault(); finishStroke(true); }
}
function finishStroke(commit: boolean) {
  const pointer = activePointer;
  if (pointer === null) return false;
  activePointer = null;
  if (renderFrame !== null) { cancelAnimationFrame(renderFrame); renderFrame = null; }
  if (isMasking) { isMasking = false; if (commit) maskPainter.current?.end(); else maskPainter.current?.cancel(); }
  else if (currentLine && painter) {
    if (commit) { preview(true); painter.commit(); const line = currentLine; currentLine = null; store.addBrushLine(line); shownLines = [...store.mediaState.brushDrawnLines]; }
    else { currentLine = null; painter.discard(); notify(); }
  }
  try { if (surface.value?.hasPointerCapture(pointer)) surface.value.releasePointerCapture(pointer); } catch { /* already lost */ }
  if (pendingDensity) initPainter();
  return true;
}
function cancelStroke() { return finishStroke(false); }
useEscape(cancelStroke);
onMounted(() => { window.addEventListener('blur', cancelStroke); window.addEventListener('pointerup', onPointerUp); if (store.uiState.isReady && (store.uiState.currentTab === 'brush' || store.mediaState.brushDrawnLines.length)) initPainter(); });
onBeforeUnmount(() => {
  cancelStroke(); painter?.dispose(); painter = null;
  window.removeEventListener('blur', cancelStroke); window.removeEventListener('pointerup', onPointerUp);
  if (store.uiState.brushCanvas === canvasEl.value) store.uiState.brushCanvas = undefined;
  if (canvasEl.value) canvasEl.value.width = canvasEl.value.height = 0;
});
defineExpose({ canvasEl });
</script>
