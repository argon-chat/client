<template>
  <!-- Dark overlay with crop hole (SVG mask) -->
  <template v-if="isReady">
    <div class="absolute inset-0 bg-black/50 pointer-events-none z-[1]" :style="{ mask: `url(#${spotlightId})` }" />
    <svg class="absolute pointer-events-none" width="0" height="0">
      <mask :id="spotlightId">
        <rect x="0" y="0" :width="(store.uiState.canvasSize?.[0] ?? 0) + 1" :height="(store.uiState.canvasSize?.[1] ?? 0) + 1" fill="white" />
        <rect :x="spotLeft" :y="spotTop" :width="spotWidth" :height="spotHeight" :rx="spotRoundness" fill="black" />
      </mask>
    </svg>
  </template>

  <!-- Crop handles -->
  <div
    ref="cropAreaEl"
    class="crop-handles absolute z-[2] border-2 border-white/70 cursor-move touch-none transition-opacity duration-200"
    :class="{ 'opacity-0 pointer-events-none !border-transparent': !isCropping }"
    :style="cropAreaStyle"
    @pointerdown.self.prevent="startPan"
  >
    <div class="absolute left-0 w-full h-px bg-white/20 pointer-events-none" v-for="y in gridHLines" :key="'h'+y" :style="{ top: y + '%' }" />
    <div class="absolute top-0 w-px h-full bg-white/20 pointer-events-none" v-for="x in gridVLines" :key="'v'+x" :style="{ left: x + '%' }" />
    <!-- Diagonal grid lines -->
    <svg v-if="store.uiState.gridOverlay === 'diagonal'" class="absolute inset-0 w-full h-full pointer-events-none">
      <line x1="0" y1="0" x2="100%" y2="100%" stroke="white" stroke-opacity="0.2" stroke-width="1" />
      <line x1="100%" y1="0" x2="0" y2="100%" stroke="white" stroke-opacity="0.2" stroke-width="1" />
    </svg>

    <div v-for="side in sides" :key="side.cls"
      :class="['crop-side absolute', `crop-side--${side.cls}`]"
      @pointerdown.prevent="(e) => startHandleDrag(side, e)" />

    <div v-for="corner in corners" :key="corner.cls"
      :class="['crop-corner absolute size-5', `crop-corner--${corner.cls}`]"
      @pointerdown.prevent="(e) => startHandleDrag(corner, e)" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { useCropOffset } from '../composables/useCropOffset';
import { fitToAspectRatio, mix, mixArray, clamp } from '../geometry';
import { tween } from '../animation';
import { computeCropBounds } from '../canvas/computeCropBounds';
import type { Vec2 } from '../types';

const { store, mode } = useMediaEditorContext();
const cropOffset = useCropOffset();
const cropAreaEl = ref<HTMLDivElement | null>(null);
const spotlightId = `spotlight-${Math.random().toString(36).substring(2)}`;

const isAvatar = mode === 'avatar';
const isCropping = computed(() => store.uiState.currentTab === 'crop');
const isReady = computed(() => !!store.uiState.canvasSize && store.mediaState.currentImageRatio > 0);
const MAX_SCALE = 20;

// ─── Grid overlay lines ────────────────────────────────────────

const PHI = 100 / (1 + 1.618); // ~38.2%
const gridHLines = computed(() => {
  switch (store.uiState.gridOverlay) {
    case 'thirds': return [33.33, 66.67];
    case 'golden': return [PHI, 100 - PHI];
    default: return [];
  }
});
const gridVLines = computed(() => {
  switch (store.uiState.gridOverlay) {
    case 'thirds': return [33.33, 66.67];
    case 'golden': return [PHI, 100 - PHI];
    default: return [];
  }
});

// ─── Crop rect in px ───────────────────────────────────────────

const cropLeftTop = ref<Vec2>([0, 0]);
const cropLeftTopDiff = ref<Vec2>([0, 0]);
const cropSize = ref<Vec2>([0, 0]);
const cropDiff = ref<Vec2>([0, 0]);

function getNewLeftTopAndSize() {
  const co = cropOffset.value;
  const [width, height] = fitToAspectRatio(store.mediaState.currentImageRatio, co.width, co.height);
  return {
    leftTop: [co.left + (co.width - width) / 2, co.top + (co.height - height) / 2] as Vec2,
    size: [width, height] as Vec2
  };
}

watch(cropOffset, () => {
  const { leftTop, size } = getNewLeftTopAndSize();
  cropLeftTop.value = leftTop;
  cropSize.value = size;
}, { immediate: true });

watch(() => store.mediaState.currentImageRatio, (_, prev) => {
  if (!prev) {
    const { leftTop, size } = getNewLeftTopAndSize();
    cropLeftTop.value = leftTop;
    cropSize.value = size;
  } else {
    resetSizeWithAnimation();
  }
});

function resetSizeWithAnimation() {
  const initDiff = [...cropDiff.value] as Vec2;
  const initLtDiff = [...cropLeftTopDiff.value] as Vec2;
  const initLt = [...cropLeftTop.value] as Vec2;
  const initSz = [...cropSize.value] as Vec2;
  const { leftTop: targetLt, size: targetSz } = getNewLeftTopAndSize();

  tween({ from: 0, to: 1, duration: 200, onUpdate: (p: number) => {
    cropDiff.value = mixArray(initDiff, [0, 0], p) as Vec2;
    cropLeftTopDiff.value = mixArray(initLtDiff, [0, 0], p) as Vec2;
    cropLeftTop.value = mixArray(initLt, targetLt, p) as Vec2;
    cropSize.value = mixArray(initSz, targetSz, p) as Vec2;
  }});
}

// ─── Spotlight position (lerps between normal and crop) ─────────

const normalSpotlight = computed(() => {
  const [w, h] = store.uiState.canvasSize ?? [0, 0];
  const [sw, sh] = fitToAspectRatio(store.mediaState.currentImageRatio, w, h);
  return { left: (w - sw) / 2, top: (h - sh) / 2, width: sw, height: sh };
});

const cropSpotlight = computed(() => ({
  left: cropLeftTop.value[0] + cropLeftTopDiff.value[0],
  top: cropLeftTop.value[1] + cropLeftTopDiff.value[1],
  width: cropSize.value[0] + cropDiff.value[0],
  height: cropSize.value[1] + cropDiff.value[1]
}));

const spotLeft = computed(() => mix(normalSpotlight.value.left, cropSpotlight.value.left, store.uiState.cropTabAnimationProgress));
const spotTop = computed(() => mix(normalSpotlight.value.top, cropSpotlight.value.top, store.uiState.cropTabAnimationProgress));
const spotWidth = computed(() => mix(normalSpotlight.value.width, cropSpotlight.value.width, store.uiState.cropTabAnimationProgress));
const spotHeight = computed(() => mix(normalSpotlight.value.height, cropSpotlight.value.height, store.uiState.cropTabAnimationProgress));
const spotRoundness = computed(() => {
  if (isAvatar) return Math.min(spotWidth.value, spotHeight.value) / 2;
  return 0;
});

const cropAreaStyle = computed(() => ({
  left: spotLeft.value + 'px',
  top: spotTop.value + 'px',
  width: spotWidth.value + 'px',
  height: spotHeight.value + 'px'
}));

// ─── Handle definitions ─────────────────────────────────────────

type HandleDef = { left: number; top: number; cls: string };

const corners: HandleDef[] = [
  { left: -1, top: -1, cls: 'nw' },
  { left: 1, top: -1, cls: 'ne' },
  { left: -1, top: 1, cls: 'sw' },
  { left: 1, top: 1, cls: 'se' }
];

const sides: HandleDef[] = [
  { left: -1, top: 0, cls: 'w' },
  { left: 0, top: -1, cls: 'n' },
  { left: 1, top: 0, cls: 'e' },
  { left: 0, top: 1, cls: 's' }
];

// ─── Pan (drag image inside crop) ──────────────────────────────

function startPan(e: PointerEvent) {
  if (!isCropping.value) return;

  const initTranslation = [...store.mediaState.translation] as Vec2;
  store.uiState.isMoving = true;

  let boundDiff: Vec2 = [0, 0];
  const startX = e.clientX, startY = e.clientY;

  function onMove(ev: PointerEvent) {
    const xDiff = ev.clientX - startX;
    const yDiff = ev.clientY - startY;

    const co = cropOffset.value;
    const ms = store.uiState.mediaSize;
    if (!ms) return;

    const pos = computeCropBounds({
      scale: store.mediaState.scale,
      rotation: store.mediaState.rotation,
      translation: [initTranslation[0] + xDiff, initTranslation[1] + yDiff],
      mediaSize: ms,
      currentImageRatio: store.mediaState.currentImageRatio,
      cropOffset: co
    });

    boundDiff = [0, 0];
    if (pos.imageMinX > pos.cropMinX) boundDiff[0] = pos.imageMinX - pos.cropMinX;
    if (pos.imageMaxX < pos.cropMaxX) boundDiff[0] = pos.imageMaxX - pos.cropMaxX;
    if (pos.imageMinY > pos.cropMinY) boundDiff[1] = pos.imageMinY - pos.cropMinY;
    if (pos.imageMaxY < pos.cropMaxY) boundDiff[1] = pos.imageMaxY - pos.cropMaxY;

    const r = [Math.sin(store.mediaState.rotation), Math.cos(store.mediaState.rotation)];
    boundDiff = [
      boundDiff[0] * r[1] - boundDiff[1] * r[0],
      boundDiff[1] * r[1] + boundDiff[0] * r[0]
    ];

    const resistance = 4;
    store.mediaState.translation = [
      initTranslation[0] + xDiff - (boundDiff[0] - boundDiff[0] / resistance),
      initTranslation[1] + yDiff - (boundDiff[1] - boundDiff[1] / resistance)
    ];
    boundDiff = [boundDiff[0] / resistance, boundDiff[1] / resistance];
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);

    const prev = [...store.mediaState.translation] as Vec2;
    tween({
      from: prev,
      to: [prev[0] - boundDiff[0], prev[1] - boundDiff[1]],
      duration: 120,
      onUpdate: (v: Vec2) => { store.mediaState.translation = v; },
      onComplete: () => { store.uiState.isMoving = false; }
    });
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// ─── Handle drag (resize crop) ─────────────────────────────────

function startHandleDrag(handle: HandleDef, e: PointerEvent) {
  if (!isCropping.value) return;

  const { left, top } = handle;
  const initScale = store.mediaState.scale;
  const initTranslation = [...store.mediaState.translation] as Vec2;
  store.uiState.isMoving = true;

  const startX = e.clientX, startY = e.clientY;

  function onMove(ev: PointerEvent) {
    const co = cropOffset.value;
    const ms = store.uiState.mediaSize;
    if (!ms) return;

    const [w, h] = cropSize.value;
    const fixed = !!store.uiState.fixedImageRatioKey;
    let ratio = store.mediaState.currentImageRatio;
    if (left < 0) ratio = -ratio;
    if (top < 0) ratio = -ratio;

    const minW = Math.min(w, (co.width / MAX_SCALE) * Math.min(MAX_SCALE, initScale));
    const minH = Math.min(h, (co.height / MAX_SCALE) * Math.min(MAX_SCALE, initScale));

    let xDiff = ev.clientX - startX;
    let yDiff = ev.clientY - startY;

    xDiff = Math.max(xDiff * left, minW - w) * left;
    yDiff = Math.max(yDiff * top, minH - h) * top;

    if (fixed) {
      if (top === 0) {
        yDiff = xDiff / ratio;
      } else if (left === 0) {
        xDiff = yDiff * ratio;
      } else {
        const xd = xDiff;
        xDiff = (xDiff + yDiff * ratio) / 2;
        yDiff = (xd / ratio + yDiff) / 2;
      }
    }

    if (fixed && top === 0) {
      cropDiff.value = [left * xDiff, yDiff];
    } else if (fixed && left === 0) {
      cropDiff.value = [xDiff, top * yDiff];
    } else {
      cropDiff.value = [xDiff * left, yDiff * top];
    }

    cropLeftTopDiff.value = [
      fixed && left === 0 ? -xDiff / 2 : Number(left < 0) * xDiff,
      fixed && top === 0 ? -yDiff / 2 : Number(top < 0) * yDiff
    ];

    // Keep image covering the crop area
    const pos = computeCropBounds({
      scale: initScale,
      rotation: store.mediaState.rotation,
      translation: initTranslation,
      mediaSize: ms,
      currentImageRatio: store.mediaState.currentImageRatio,
      cropOffset: co,
      extendCrop: [
        [
          fixed && left === 0 ? -xDiff / 2 : left === -1 ? xDiff : 0,
          fixed && top === 0 ? yDiff / 2 : top === 1 ? yDiff : 0
        ],
        [
          fixed && left === 0 ? xDiff / 2 : left === 1 ? xDiff : 0,
          fixed && top === 0 ? -yDiff / 2 : top === -1 ? yDiff : 0
        ]
      ]
    });

    const halfImageW = (pos.imageMaxX - pos.imageMinX) / 2;
    const halfImageH = (pos.imageMaxY - pos.imageMinY) / 2;
    const imgCenterX = pos.imageMinX + halfImageW;
    const imgCenterY = pos.imageMinY + halfImageH;

    let addScaleX = 1, addScaleY = 1;
    if (pos.imageMinX > pos.cropMinX) addScaleX *= 1 + ((imgCenterX - pos.cropMinX) / halfImageW - 1) / 2;
    if (pos.imageMaxX < pos.cropMaxX) addScaleX *= 1 + ((pos.cropMaxX - imgCenterX) / halfImageW - 1) / 2;
    if (pos.imageMinY > pos.cropMinY) addScaleY *= 1 + ((imgCenterY - pos.cropMinY) / halfImageH - 1) / 2;
    if (pos.imageMaxY < pos.cropMaxY) addScaleY *= 1 + ((pos.cropMaxY - imgCenterY) / halfImageH - 1) / 2;

    const addScale = Math.max(addScaleX, addScaleY);
    if (addScale > 1) {
      store.mediaState.scale = initScale * addScale;
    }

    let bd: Vec2 = [0, 0];
    if (pos.imageMinX > pos.cropMinX) bd[0] += pos.imageMinX - pos.cropMinX;
    if (pos.imageMaxX < pos.cropMaxX) bd[0] += pos.imageMaxX - pos.cropMaxX;
    if (pos.imageMinY > pos.cropMinY) bd[1] += pos.imageMinY - pos.cropMinY;
    if (pos.imageMaxY < pos.cropMaxY) bd[1] += pos.imageMaxY - pos.cropMaxY;

    const r = [Math.sin(store.mediaState.rotation), Math.cos(store.mediaState.rotation)];
    bd = [bd[0] * r[1] - bd[1] * r[0], bd[1] * r[1] + bd[0] * r[0]];
    store.mediaState.translation = [initTranslation[0] - bd[0] / 2, initTranslation[1] - bd[1] / 2];
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);

    const newWidth = cropSize.value[0] + cropDiff.value[0];
    const newHeight = cropSize.value[1] + cropDiff.value[1];
    const newRatio = newWidth / newHeight;
    const co = cropOffset.value;
    const upScale = Math.min(co.width / newWidth, co.height / newHeight);

    store.mediaState.currentImageRatio = newRatio;
    resetSizeWithAnimation();

    const scaleNow = store.mediaState.scale;
    const transNow = [...store.mediaState.translation] as Vec2;
    const targetScale = scaleNow * upScale;
    const targetTranslation: Vec2 = [
      upScale * (transNow[0] + -cropDiff.value[0] * left * 0.5),
      upScale * (transNow[1] + -cropDiff.value[1] * top * 0.5)
    ];

    tween({ from: 0, to: 1, duration: 200, onUpdate: (p: number) => {
      store.mediaState.scale = mix(scaleNow, targetScale, p);
      store.mediaState.translation = mixArray(transNow, targetTranslation, p) as Vec2;
    }, onComplete: () => { store.uiState.isMoving = false; } });
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// ─── Scroll to zoom ────────────────────────────────────────────

onMounted(() => {
  const el = cropAreaEl.value;
  if (!el) return;

  let wheelRafId: number | null = null;
  let pendingDeltaY = 0;

  const processZoom = () => {
    wheelRafId = null;
    if (!isCropping.value) return;

    const ms = store.uiState.mediaSize;
    if (!ms) return;

    const zoomFactor = pendingDeltaY > 0 ? 1.1 : 0.9;
    pendingDeltaY = 0;
    const co = cropOffset.value;

    const pos = computeCropBounds({
      scale: store.mediaState.scale * zoomFactor,
      rotation: store.mediaState.rotation,
      translation: store.mediaState.translation,
      mediaSize: ms,
      currentImageRatio: store.mediaState.currentImageRatio,
      cropOffset: co
    });

    const halfW = (pos.imageMaxX - pos.imageMinX) / 2;
    const halfH = (pos.imageMaxY - pos.imageMinY) / 2;
    const imgCX = pos.imageMinX + halfW;
    const imgCY = pos.imageMinY + halfH;

    let addScale = 1;
    if (pos.imageMinX > pos.cropMinX) addScale = Math.max(addScale, (imgCX - pos.cropMinX) / halfW);
    if (pos.imageMaxX < pos.cropMaxX) addScale = Math.max(addScale, (pos.cropMaxX - imgCX) / halfW);
    if (pos.imageMinY > pos.cropMinY) addScale = Math.max(addScale, (imgCY - pos.cropMinY) / halfH);
    if (pos.imageMaxY < pos.cropMaxY) addScale = Math.max(addScale, (pos.cropMaxY - imgCY) / halfH);

    const finalZoom = zoomFactor * addScale;
    const targetScale = Math.min(MAX_SCALE, store.mediaState.scale * finalZoom);
    const actualZoom = targetScale / store.mediaState.scale;

    store.mediaState.scale = targetScale;
    store.mediaState.translation = [
      store.mediaState.translation[0] * actualZoom,
      store.mediaState.translation[1] * actualZoom
    ];
  };

  const onWheel = (e: WheelEvent) => {
    if (!isCropping.value) return;
    e.preventDefault();
    pendingDeltaY += e.deltaY;
    if (wheelRafId === null) {
      wheelRafId = requestAnimationFrame(processZoom);
    }
  };

  el.addEventListener('wheel', onWheel, { passive: false });
  onBeforeUnmount(() => {
    el.removeEventListener('wheel', onWheel);
    if (wheelRafId !== null) cancelAnimationFrame(wheelRafId);
  });
});
</script>

<style>
.crop-side--n { top: -10px; left: 20px; right: 20px; height: 20px; cursor: ns-resize; }
.crop-side--s { bottom: -10px; left: 20px; right: 20px; height: 20px; cursor: ns-resize; }
.crop-side--w { left: -10px; top: 20px; bottom: 20px; width: 20px; cursor: ew-resize; }
.crop-side--e { right: -10px; top: 20px; bottom: 20px; width: 20px; cursor: ew-resize; }
.crop-corner::before,
.crop-corner::after {
  content: '';
  position: absolute;
  background: #ffffff;
  border-radius: 1px;
}
.crop-corner--nw { top: -3px; left: -3px; cursor: nwse-resize; }
.crop-corner--nw::before { width: 20px; height: 3px; top: 0; left: 0; }
.crop-corner--nw::after { width: 3px; height: 20px; top: 0; left: 0; }
.crop-corner--ne { top: -3px; right: -3px; cursor: nesw-resize; }
.crop-corner--ne::before { width: 20px; height: 3px; top: 0; right: 0; }
.crop-corner--ne::after { width: 3px; height: 20px; top: 0; right: 0; }
.crop-corner--sw { bottom: -3px; left: -3px; cursor: nesw-resize; }
.crop-corner--sw::before { width: 20px; height: 3px; bottom: 0; left: 0; }
.crop-corner--sw::after { width: 3px; height: 20px; bottom: 0; left: 0; }
.crop-corner--se { bottom: -3px; right: -3px; cursor: nwse-resize; }
.crop-corner--se::before { width: 20px; height: 3px; bottom: 0; right: 0; }
.crop-corner--se::after { width: 3px; height: 20px; bottom: 0; right: 0; }
</style>
