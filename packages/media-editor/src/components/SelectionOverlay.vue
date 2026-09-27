<template>
  <div
    v-if="active"
    ref="rootEl"
    class="absolute inset-0 z-[5] touch-none select-none"
    :style="{ cursor }"
    :data-cutout-overlay="tool"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @pointerleave="onPointerLeave"
    @dblclick.prevent="onDoubleClick"
    @contextmenu.prevent
  >
    <svg class="absolute inset-0 size-full pointer-events-none overflow-visible">
      <path v-if="dimPath" :d="dimPath" fill="black" fill-opacity="0.4" fill-rule="evenodd" />
      <template v-if="outline">
        <path :d="outline.d" fill="none" stroke="black" stroke-opacity="0.7" stroke-width="1.5" stroke-linejoin="round" />
        <path
          :d="outline.d"
          fill="none"
          stroke="white"
          stroke-width="1.5"
          stroke-dasharray="5 5"
          stroke-linejoin="round"
          :class="{ 'media-editor-ants': outline.closed }"
          data-selection-outline
        />
      </template>
      <path v-if="rubberBand" :d="rubberBand" fill="none" stroke="white" stroke-opacity="0.85" stroke-width="1" stroke-dasharray="3 3" />
      <circle
        v-for="(a, i) in anchorDots"
        :key="i"
        :cx="a[0]"
        :cy="a[1]"
        :r="i === 0 && anchorDots.length > 2 ? 4.5 : 3.5"
        class="fill-background stroke-primary"
        stroke-width="1.5"
      />
      <g v-if="brushCursor">
        <circle :cx="brushCursor.x" :cy="brushCursor.y" :r="brushCursor.r" fill="none" stroke="black" stroke-opacity="0.6" stroke-width="2" />
        <circle :cx="brushCursor.x" :cy="brushCursor.y" :r="brushCursor.r" fill="none" stroke="white" stroke-width="1" />
        <path :d="brushCursor.cross" stroke="black" stroke-opacity="0.6" stroke-width="3" />
        <path :d="brushCursor.cross" stroke="white" stroke-width="1" />
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { useMaskPainterSlot, type MaskSnapshot } from '../composables/useMaskPainter';
import { canvasToSource, maskResolution, sourceToCanvas } from '../mask/maskMath';
import { createLiveWireWorker, type LiveWireBackend } from '../selection/liveWireClient';
import { createMagneticLasso, type MagneticLasso } from '../selection/magneticLasso';
import { beginBackgroundErase, type BackgroundEraseStroke } from '../selection/backgroundEraser';
import { simplifyPath } from '../selection/polygon';
import { copyPixels } from '../selection/workingImage';
import type { Bounds } from '../selection/coverage';
import type { Vec2 } from '../types';

const { store } = useMediaEditorContext();
const maskPainter = useMaskPainterSlot();
const rootEl = ref<HTMLDivElement | null>(null);

const tool = computed(() => (store.uiState.currentTab === 'cutout' && store.uiState.isReady ? store.uiState.cutoutTool : null));
const active = computed(() => tool.value !== null);
const isLasso = computed(() => tool.value === 'lasso' || tool.value === 'magneticLasso');

/** Close a polygon by clicking within this many CSS pixels of its first point. */
const CLOSE_DISTANCE = 8;
/** Freehand points closer than this (CSS pixels) are skipped. */
const MIN_STEP = 1.5;

// ─── Coordinates ───────────────────────────────────────────────────
// Pointer → device pixels → source pixels through the view's transform (zoom, rotation, flip), and
// back for drawing, so the outline sits on the image however it is shown.

function viewport(): Vec2 {
  const [w, h] = store.uiState.canvasSize ?? [0, 0];
  const dpr = store.uiState.pixelRatio;
  return [Math.round(w * dpr), Math.round(h * dpr)];
}

function mediaSize(): Vec2 {
  return store.uiState.mediaSize ?? [1, 1];
}

function eventToSource(e: MouseEvent): Vec2 {
  const rect = rootEl.value!.getBoundingClientRect();
  const dpr = store.uiState.pixelRatio;
  return canvasToSource([(e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr], store.uiState.finalTransform, viewport(), mediaSize());
}

function toCss(p: Vec2): Vec2 {
  const c = sourceToCanvas(p, store.uiState.finalTransform, viewport(), mediaSize());
  const dpr = store.uiState.pixelRatio;
  return [c[0] / dpr, c[1] / dpr];
}

/** Source pixels per CSS pixel on screen. */
function sourcePerCss(): number {
  return store.uiState.pixelRatio / (store.uiState.finalTransform.scale || 1);
}

/** Working (mask) pixels per source pixel. */
function workingScale(): number {
  const [w, h] = mediaSize();
  return maskResolution(w, h)[0] / w;
}

const toWorking = (p: Vec2): Vec2 => [p[0] * workingScale(), p[1] * workingScale()];
const fromWorking = (x: number, y: number): Vec2 => [(x + 0.5) / workingScale(), (y + 0.5) / workingScale()];

function cssDistance(a: Vec2, b: Vec2): number {
  const p = toCss(a);
  const q = toCss(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toString();

function pathD(points: readonly Vec2[], close: boolean): string {
  if (!points.length) return '';
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const [x, y] = toCss(points[i]);
    d += `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`;
  }
  return close ? d + 'Z' : d;
}

// ─── State ─────────────────────────────────────────────────────────

/** The lasso being drawn, source pixels. */
const lassoPoints = shallowRef<Vec2[]>([]);
/** Clicked vertices of the polygon lasso (dragged stretches have none). */
const polygonVertices = shallowRef<Vec2[]>([]);
const pointer = ref<Vec2 | null>(null);
let pointerDown = false;

let backend: LiveWireBackend | null = null;
let magnetic: MagneticLasso | null = null;
const magneticTick = ref(0);

let stroke: BackgroundEraseStroke | null = null;
let snapshot: MaskSnapshot | null = null;

const magneticActive = () => tool.value === 'magneticLasso' && store.uiState.liveWire !== 'failed';
const polygonLike = () => (tool.value === 'lasso' && store.uiState.cutoutOptions.lassoMode === 'polygon') || tool.value === 'magneticLasso';

function magneticPoints(): Vec2[] {
  void magneticTick.value;
  const m = magnetic?.state;
  if (!m || !m.anchors.length) return [];
  const out: Vec2[] = [];
  for (const seg of m.segments) for (let i = out.length ? 2 : 0; i < seg.length; i += 2) out.push(fromWorking(seg[i], seg[i + 1]));
  if (!out.length) out.push(fromWorking(m.anchors[0][0], m.anchors[0][1]));
  if (m.live) for (let i = 2; i < m.live.length; i += 2) out.push(fromWorking(m.live[i], m.live[i + 1]));
  return out;
}

const outline = computed<{ d: string; closed: boolean } | null>(() => {
  const selection = store.uiState.selection;
  if (selection && isLasso.value) return { d: pathD(selection.points, true), closed: true };
  if (magneticActive()) {
    const points = magneticPoints();
    return points.length > 1 ? { d: pathD(points, false), closed: false } : null;
  }
  if (isLasso.value && lassoPoints.value.length > 1) return { d: pathD(lassoPoints.value, false), closed: false };
  return null;
});

const dimPath = computed(() => {
  const selection = store.uiState.selection;
  if (!selection || !isLasso.value) return '';
  const polygon = pathD(selection.points, true);
  if (selection.inverted) return polygon;
  const [w, h] = store.uiState.canvasSize ?? [0, 0];
  return `M0 0H${w}V${h}H0Z${polygon}`;
});

const rubberBand = computed(() => {
  if (!pointer.value || store.uiState.selection) return '';
  if (tool.value === 'lasso' && store.uiState.cutoutOptions.lassoMode === 'polygon' && lassoPoints.value.length && !pointerDown) {
    return pathD([lassoPoints.value[lassoPoints.value.length - 1], pointer.value], false);
  }
  if (tool.value === 'magneticLasso' && store.uiState.liveWire === 'failed' && lassoPoints.value.length) {
    return pathD([lassoPoints.value[lassoPoints.value.length - 1], pointer.value], false);
  }
  return '';
});

const anchorDots = computed<Vec2[]>(() => {
  if (store.uiState.selection) return [];
  if (magneticActive()) {
    void magneticTick.value;
    return (magnetic?.state.anchors ?? []).map((a) => toCss(fromWorking(a[0], a[1])));
  }
  if (polygonLike()) return polygonVertices.value.map(toCss);
  return [];
});

const brushCursor = computed(() => {
  if (tool.value !== 'backgroundEraser' || !pointer.value) return null;
  const [x, y] = toCss(pointer.value);
  const r = store.uiState.cutoutOptions.eraserSize / 2;
  return { x, y, r, cross: `M${fmt(x - 5)} ${fmt(y)}H${fmt(x + 5)}M${fmt(x)} ${fmt(y - 5)}V${fmt(y + 5)}` };
});

const cursor = computed(() => (tool.value === 'backgroundEraser' ? 'none' : 'crosshair'));

// ─── Lasso ─────────────────────────────────────────────────────────

function commitSelection(points: Vec2[]) {
  const simplified = simplifyPath(points, 0.3 * sourcePerCss());
  store.uiState.selection = simplified.length >= 3 ? { points: simplified, inverted: false } : null;
}

function finishLasso() {
  const points = lassoPoints.value;
  lassoPoints.value = [];
  polygonVertices.value = [];
  if (points.length >= 3) commitSelection(points);
}

function addLassoPoint(p: Vec2, vertex: boolean) {
  const pts = lassoPoints.value;
  if (pts.length && cssDistance(pts[pts.length - 1], p) < MIN_STEP) return;
  lassoPoints.value = [...pts, p];
  if (vertex) polygonVertices.value = [...polygonVertices.value, p];
}

function removeLastVertex() {
  const vertices = polygonVertices.value;
  if (!vertices.length) {
    lassoPoints.value = [];
    return;
  }
  // Back to the vertex before the last one, dropping any dragged stretch after it.
  const keep = vertices.slice(0, -1);
  const lastKept = keep[keep.length - 1];
  const at = lastKept ? lassoPoints.value.lastIndexOf(lastKept) : -1;
  lassoPoints.value = at >= 0 ? lassoPoints.value.slice(0, at + 1) : [];
  polygonVertices.value = keep;
}

// ─── Magnetic lasso ────────────────────────────────────────────────

function ensureLiveWire() {
  if (backend || magnetic || store.uiState.liveWire === 'failed') return;
  const image = store.getWorkingImage();
  const onChange = () => magneticTick.value++;
  const snapRadius = () => store.uiState.cutoutOptions.edgeWidth * sourcePerCss() * workingScale();
  const fallBack = (e: unknown) => {
    console.warn('[media-editor] edge detection unavailable, the magnetic lasso draws straight lines', e);
    backend?.dispose();
    backend = null;
    magnetic = null;
    store.uiState.liveWire = 'failed';
  };
  if (!image) return;
  try {
    backend = createLiveWireWorker();
    magnetic = createMagneticLasso(backend, { snapRadius, onChange });
    store.uiState.liveWire = 'preparing';
    const mine = backend;
    backend.prepare({ width: image.width, height: image.height, data: copyPixels(image) }).then(
      () => {
        if (backend === mine) store.uiState.liveWire = 'ready';
      },
      (e) => {
        if (backend === mine) fallBack(e);
      }
    );
  } catch (e) {
    fallBack(e);
  }
}

async function closeMagnetic() {
  const m = magnetic;
  if (!m) return;
  const points = await m.close();
  if (!points) return;
  commitSelection(points.map(([x, y]) => fromWorking(x, y)));
}

const magneticInProgress = () => !!magnetic?.state.anchors.length;

// ─── Background eraser ─────────────────────────────────────────────

function showStroke(b: Bounds | null) {
  const painter = maskPainter.current;
  if (!b || !stroke || !snapshot || !painter) return;
  const width = b.x1 - b.x0;
  const height = b.y1 - b.y0;
  if (width <= 0 || height <= 0) return;
  const alpha = new Uint8Array(width * height);
  const cov = stroke.coverage;
  const base = snapshot.data;
  const fw = snapshot.width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (b.y0 + y) * fw + b.x0 + x;
      alpha[y * width + x] = Math.round((base[i] * (255 - cov[i])) / 255);
    }
  }
  painter.preview({ x: b.x0, y: b.y0, width, height }, alpha);
}

function beginStroke(p: Vec2): boolean {
  const image = store.getWorkingImage();
  if (!image) return false;
  const o = store.uiState.cutoutOptions;
  const shot = maskPainter.current?.snapshot() ?? null;
  snapshot = shot && shot.width === image.width && shot.height === image.height ? shot : null;
  stroke = beginBackgroundErase(image, [p[0] * image.scale, p[1] * image.scale], {
    size: o.eraserSize * sourcePerCss() * image.scale,
    hardness: o.eraserHardness,
    tolerance: o.eraserTolerance,
    sampling: o.sampling
  });
  showStroke(stroke.bounds);
  return true;
}

function endStroke() {
  const s = stroke;
  stroke = null;
  snapshot = null;
  const image = store.getWorkingImage();
  const result = s?.result();
  if (result && image) store.addMaskErase(result, image.scale);
}

// ─── Pointer and keys ──────────────────────────────────────────────

function capture(e: PointerEvent) {
  try {
    rootEl.value?.setPointerCapture(e.pointerId);
  } catch {
    // Not a live pointer (a synthetic event): moves still arrive while it stays over the canvas.
  }
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || !rootEl.value) return;
  const p = eventToSource(e);
  pointer.value = p;

  switch (tool.value) {
    case 'lasso': {
      const polygon = store.uiState.cutoutOptions.lassoMode === 'polygon';
      if (!lassoPoints.value.length) store.uiState.selection = null;
      if (polygon && polygonVertices.value.length >= 3 && cssDistance(polygonVertices.value[0], p) <= CLOSE_DISTANCE) {
        finishLasso();
        return;
      }
      if (!polygon) lassoPoints.value = [];
      addLassoPoint(p, polygon);
      pointerDown = true;
      capture(e);
      return;
    }
    case 'magneticLasso': {
      if (store.uiState.liveWire === 'failed') {
        // No edge map: a polygon lasso.
        if (!lassoPoints.value.length) store.uiState.selection = null;
        if (polygonVertices.value.length >= 3 && cssDistance(polygonVertices.value[0], p) <= CLOSE_DISTANCE) finishLasso();
        else addLassoPoint(p, true);
        return;
      }
      ensureLiveWire();
      if (!magnetic) return;
      if (!magneticInProgress()) store.uiState.selection = null;
      const anchors = magnetic.state.anchors;
      if (anchors.length >= 2 && cssDistance(fromWorking(anchors[0][0], anchors[0][1]), p) <= CLOSE_DISTANCE) {
        void closeMagnetic();
        return;
      }
      void magnetic.click(toWorking(p));
      return;
    }
    case 'magicEraser':
      store.magicErase(p);
      return;
    case 'backgroundEraser':
      if (beginStroke(p)) {
        pointerDown = true;
        capture(e);
      }
      return;
  }
}

function onPointerMove(e: PointerEvent) {
  if (!rootEl.value) return;
  const p = eventToSource(e);
  pointer.value = p;
  if (tool.value === 'lasso' && pointerDown) addLassoPoint(p, false);
  else if (tool.value === 'magneticLasso' && magnetic) magnetic.move(toWorking(p));
  else if (tool.value === 'backgroundEraser' && stroke) {
    const s = stroke;
    const rect = s.to([p[0] * workingScale(), p[1] * workingScale()]);
    showStroke(rect);
  }
}

function onPointerUp(e: PointerEvent) {
  if (!pointerDown) return;
  pointerDown = false;
  if (rootEl.value?.hasPointerCapture(e.pointerId)) rootEl.value.releasePointerCapture(e.pointerId);
  if (tool.value === 'lasso' && store.uiState.cutoutOptions.lassoMode === 'freehand') finishLasso();
  else if (tool.value === 'backgroundEraser') endStroke();
}

function onPointerLeave() {
  if (!pointerDown) pointer.value = null;
}

function onDoubleClick() {
  if (tool.value === 'magneticLasso' && store.uiState.liveWire !== 'failed') void closeMagnetic();
  else if (polygonLike() && polygonVertices.value.length >= 3) finishLasso();
}

function inProgress(): boolean {
  return lassoPoints.value.length > 0 || magneticInProgress();
}

/** Keys while drawing: Enter closes, Backspace takes the last point back, Escape cancels. */
function onKeydown(e: KeyboardEvent) {
  if (!active.value || !isLasso.value) return;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  let handled = false;
  if (e.key === 'Escape' && (inProgress() || store.uiState.selection)) {
    cancelAll();
    store.uiState.selection = null;
    handled = true;
  } else if (e.key === 'Enter' && inProgress()) {
    if (magneticActive()) void closeMagnetic();
    else if (polygonVertices.value.length >= 3 || lassoPoints.value.length >= 3) finishLasso();
    handled = true;
  } else if (e.key === 'Backspace' && inProgress() && !e.ctrlKey) {
    if (magneticActive()) magnetic?.removeLast();
    else removeLastVertex();
    handled = true;
  }
  if (handled) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function cancelAll() {
  lassoPoints.value = [];
  polygonVertices.value = [];
  magnetic?.cancel();
  if (stroke) {
    stroke = null;
    snapshot = null;
  }
}

watch(tool, (next, previous) => {
  cancelAll();
  pointerDown = false;
  const lassoTool = next === 'lasso' || next === 'magneticLasso';
  if (!lassoTool || (previous !== 'lasso' && previous !== 'magneticLasso')) store.uiState.selection = null;
  if (next === 'magneticLasso') ensureLiveWire();
});

watch(() => store.uiState.cutoutOptions.lassoMode, () => {
  lassoPoints.value = [];
  polygonVertices.value = [];
});

onMounted(() => document.addEventListener('keydown', onKeydown, true));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true);
  backend?.dispose();
  backend = null;
  magnetic = null;
});
</script>

<style>
.media-editor-ants {
  animation: media-editor-ants 0.5s linear infinite;
}
@keyframes media-editor-ants {
  to {
    stroke-dashoffset: -10;
  }
}
@media (prefers-reduced-motion: reduce) {
  .media-editor-ants {
    animation: none;
  }
}
</style>
