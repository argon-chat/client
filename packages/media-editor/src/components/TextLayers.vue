<template>
  <div ref="root" data-media-editor-text-surface class="absolute inset-0 z-[4] select-none"
    :style="{ pointerEvents: interactive ? 'auto' : 'none' }" @pointerdown="onRootPointerDown" @dblclick="onRootDoubleClick">
    <svg class="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
      <polygon v-for="layer in store.mediaState.resizableLayers" :key="layer.id"
        :data-media-editor-layer="layer.id" :points="corners(layer)"
        fill="transparent" :stroke="interactive && store.uiState.selectedResizableLayer === layer.id ? '#3b82f6' : 'transparent'"
        stroke-width="2" style="pointer-events:none" />
    </svg>
    <template v-for="layer in store.mediaState.resizableLayers" :key="layer.id">
      <div v-if="editingLayerId === layer.id" class="absolute pointer-events-auto" :style="layerStyle(layer)">
        <textarea ref="editInputRef" class="bg-transparent border-none outline-none resize-none w-full h-full whitespace-pre select-text"
          :style="textContentStyle(layer)" :value="layerText(layer.textInfo)"
          @pointerdown.stop @input="updateContent(layer, ($event.target as HTMLTextAreaElement).value)" @blur="stopEditing" />
      </div>
    </template>
  </div>
</template>
<script setup lang="ts">
import { ref, nextTick, computed, watch, onBeforeUnmount } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import type { Gesture } from '../store/editorStore';
import { TEXT_BACKGROUND_PADDING, TEXT_BACKGROUND_RADIUS, TEXT_LINE_HEIGHT } from '../constants';
import { fontInfo, layerText } from '../fonts';
import { contrastingTextColor } from '../color';
import type { EditorLayer, Vec2 } from '../types';
import { imageProjection, inverse, project, projectionBasis } from '../canvas/projective';
import { layerSize, projectedLayerCorners } from '../canvas/layerGeometry';
import type { AnnotationFrame } from '../canvas/annotationSpace';
const { store } = useMediaEditorContext();
const root = ref<HTMLDivElement | null>(null), editingLayerId = ref<number | null>(null);
const editInputRef = ref<HTMLTextAreaElement[] | null>(null);
const interactive = computed(() => ['text', 'stickers'].includes(store.uiState.currentTab));
const layerIndex = (id: number) => store.mediaState.resizableLayers.findIndex(layer => layer.id === id);
function frame(): AnnotationFrame {
  const dpr = store.uiState.pixelRatio, size = store.uiState.canvasSize ?? [1, 1];
  return { transform: store.uiState.finalTransform, canvas: [Math.round(size[0] * dpr), Math.round(size[1] * dpr)], media: store.uiState.mediaSize ?? [1, 1], dpr };
}
function hitLayer(e: MouseEvent): EditorLayer | undefined {
  if (!root.value) return;
  const rect = root.value.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top, f = frame();
  return [...store.mediaState.resizableLayers].reverse().find(layer => {
    const points = projectedLayerCorners(layer, f); let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
function onRootPointerDown(e: PointerEvent) {
  const layer = hitLayer(e); if (layer) startDrag(layer, e); else { stopEditing(); store.uiState.selectedResizableLayer = undefined; }
}
function onRootDoubleClick(e: MouseEvent) { const layer = hitLayer(e); if (layer?.type === 'text') startEditing(layer); }
function corners(layer: EditorLayer) { return projectedLayerCorners(layer, frame()).map(point => point.join(',')).join(' '); }
function editingTransform(layer: EditorLayer) {
  const f = frame(), projection = imageProjection(f.transform, f.canvas, f.media), point = project(projection, layer.position);
  const [a, b, c, d] = projectionBasis(projection, layer.position), [e, g, h, i] = layer.basis ?? [1, 0, 0, 1];
  const m00 = (a*e+c*g)/f.dpr, m10 = (b*e+d*g)/f.dpr;
  const m01 = (a*h+c*i)/f.dpr, m11 = (b*h+d*i)/f.dpr;
  const cosine = Math.cos(layer.rotation) * layer.scale, sine = Math.sin(layer.rotation) * layer.scale;
  const matrix = [m00*cosine+m01*sine, m10*cosine+m11*sine, -m00*sine+m01*cosine, -m10*sine+m11*cosine];
  const [aa, bb, cc, dd] = matrix;
  const normSquared = aa*aa + bb*bb + cc*cc + dd*dd, determinant = aa*dd - bb*cc;
  const largestSingular = Math.sqrt((normSquared + Math.sqrt(Math.max(0, normSquared*normSquared - 4*determinant*determinant))) / 2);
  // GPUI caches glyph bitmaps before CSS transforms. Rasterize at the enlarged local font size,
  // then divide the matrix by the same factor so every world coordinate stays unchanged.
  const density = Number.isFinite(largestSingular) ? Math.max(1, largestSingular) : 1;
  return { point: [point[0] / f.dpr, point[1] / f.dpr], matrix: matrix.map(value => value / density), density };
}
function layerStyle(layer: EditorLayer) {
  const { point, matrix, density } = editingTransform(layer), [width, height] = layerSize(layer);
  return { left: point[0] + 'px', top: point[1] + 'px', width: width * density + 'px', height: height * density + 'px',
    transform: `translate(-50%, -50%) matrix(${matrix.join(',')},0,0)` };
}
function textContentStyle(layer: EditorLayer) {
  const info = layer.textInfo; if (!info) return {};
  const font = fontInfo(info.font), density = editingTransform(layer).density;
  return { fontSize: info.size * density + 'px', color: info.style === 'background' ? contrastingTextColor(info.color) : info.color,
    backgroundColor: info.style === 'background' ? info.color : 'transparent', textAlign: info.alignment as 'left',
    fontFamily: font.fontFamily, fontWeight: String(font.fontWeight), lineHeight: String(TEXT_LINE_HEIGHT),
    padding: info.style === 'background' ? `${TEXT_BACKGROUND_PADDING[1] * density}px ${TEXT_BACKGROUND_PADDING[0] * density}px` : `${6 * density}px`,
    borderRadius: `${TEXT_BACKGROUND_RADIUS * density}px` };
}
let dragging: Gesture | null = null, detachDrag: (() => void) | null = null;
function startDrag(layer: EditorLayer, e: PointerEvent) {
  if (!interactive.value || e.button !== 0 || editingLayerId.value === layer.id || !root.value) return;
  e.preventDefault(); e.stopPropagation(); stopEditing(); detachDrag?.();
  store.uiState.selectedResizableLayer = layer.id;
  const target = e.currentTarget as Element, pointer = e.pointerId, rect = root.value.getBoundingClientRect(), f = frame();
  const undo = inverse(imageProjection(f.transform, f.canvas, f.media));
  const sourcePoint = (ev: PointerEvent) => project(undo, [(ev.clientX - rect.left) * f.dpr, (ev.clientY - rect.top) * f.dpr]);
  const start = sourcePoint(e), position = [...layer.position] as Vec2;
  const detach = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel); target.removeEventListener('lostpointercapture', cancel); window.removeEventListener('blur', cancel);
    detachDrag = null; dragging = null;
    try { if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer); } catch { /* already released */ }
  };
  const gesture = store.beginGesture({ track: [['resizableLayers', layerIndex(layer.id), 'position']], onCancel: detach });
  dragging = gesture; detachDrag = () => gesture.cancel();
  function move(ev: PointerEvent) {
    if (ev.pointerId !== pointer) return;
    if (!(ev.buttons & 1)) { up(ev); return; }
    ev.preventDefault(); const point = sourcePoint(ev); if (!point.every(Number.isFinite)) return;
    layer.position = [position[0] + point[0] - start[0], position[1] + point[1] - start[1]];
  }
  function up(ev: PointerEvent) { if (ev.pointerId !== pointer) return; detach(); gesture.end(); }
  function cancel() { gesture.cancel(); }
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel);
  target.addEventListener('lostpointercapture', cancel); window.addEventListener('blur', cancel);
  try { target.setPointerCapture(pointer); } catch { /* document listeners still release */ }
}
let editing: Gesture | null = null;
function startEditing(layer: EditorLayer) {
  if (!interactive.value || layer.type !== 'text') return;
  stopEditing(); editingLayerId.value = layer.id; store.uiState.editingTextLayer = layer.id; store.uiState.selectedResizableLayer = layer.id;
  editing = store.beginGesture({ track: [['resizableLayers', layerIndex(layer.id), 'textInfo', 'content']],
    onCancel: () => { editing = null; editingLayerId.value = null; store.uiState.editingTextLayer = undefined; } });
  nextTick(() => { editInputRef.value?.[0]?.focus(); editInputRef.value?.[0]?.select(); });
}
function updateContent(layer: EditorLayer, content: string) { if (layer.textInfo) layer.textInfo.content = content; }
function stopEditing() {
  editingLayerId.value = null; store.uiState.editingTextLayer = undefined;
  const gesture = editing; editing = null; gesture?.end();
}
watch(() => store.mediaState.resizableLayers.length, (count, before) => {
  if (count <= before || !interactive.value) return;
  const layer = store.mediaState.resizableLayers[count - 1]; if (layer?.type === 'text') void nextTick(() => startEditing(layer));
});
watch(interactive, active => { if (!active) { dragging?.cancel(); stopEditing(); } });
onBeforeUnmount(() => { detachDrag?.(); stopEditing(); });
</script>
