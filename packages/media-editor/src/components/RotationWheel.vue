<template>
  <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center px-4 h-[42px] w-[632px] max-w-full z-[3] select-none">
    <button class="size-10 rounded-full bg-black/40 border-none text-[#fff] cursor-pointer flex items-center justify-center shrink-0 hover:bg-black/60 transition-colors" @click="rotateLeft" title="Rotate left">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </svg>
    </button>

    <div class="rotation-swiper-wrapper flex-1 h-full overflow-hidden relative">
      <div
        ref="swiperEl"
        class="absolute w-[568px] h-full left-[calc(50%+var(--moved,0px))] top-0 -translate-x-1/2 flex flex-col justify-between items-center cursor-ew-resize touch-none"
        :style="{ '--moved': (moved + movedDiff) + 'px' }"
        @pointerdown.prevent="startSwipe"
      >
        <div class="flex gap-[18px]">
          <div v-for="i in 13" :key="i" class="w-6 h-4 flex items-center justify-center">
            <div class="rotation-label text-xs text-[rgba(255,255,255,0.5)] whitespace-nowrap relative">{{ (i - 1) * 15 - 90 }}</div>
          </div>
        </div>
        <div class="flex gap-1">
          <div v-for="i in 97" :key="i" class="rotation-dot size-0.5 rounded-full bg-white opacity-20 shrink-0" />
        </div>
      </div>
    </div>

    <div class="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none flex items-center justify-center h-4">
      <div class="rotation-value text-base font-medium text-[#fff] whitespace-nowrap relative">{{ displayValue }}</div>
    </div>

    <svg class="absolute left-1/2 top-[26px] -translate-x-1/2 pointer-events-none" width="6" height="4" viewBox="0 0 6 4" fill="none">
      <path d="M2.29289 0.707106L0.28033 2.71967C-0.192143 3.19214 0.142482 4 0.81066 4H5.18934C5.85752 4 6.19214 3.19214 5.71967 2.71967L3.70711 0.707107C3.31658 0.316583 2.68342 0.316582 2.29289 0.707106Z" fill="white" />
    </svg>

    <button class="size-10 rounded-full bg-black/40 border-none text-[#fff] cursor-pointer flex items-center justify-center shrink-0 hover:bg-black/60 transition-colors" @click="flipImage" title="Flip">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 20V4" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMediaEditorContext } from '../composables/useMediaEditorContext';
import { useCropOffset } from '../composables/useCropOffset';
import { fitToAspectRatio, mixArray, mix, clamp } from '../geometry';
import { tween } from '../animation';
import type { Vec2 } from '../types';

const { store } = useMediaEditorContext();
const cropOffset = useCropOffset();

const DEGREE_DIST_PX = 42;
const DEGREE_STEP = 15;
const TOTAL_DEGREES_SIDE = 90;
const MAX_DEGREES_DIST_PX = (TOTAL_DEGREES_SIDE / DEGREE_STEP) * DEGREE_DIST_PX;

function rotationFromMove(amount: number) {
  return ((amount / DEGREE_DIST_PX) * DEGREE_STEP * Math.PI) / 180;
}

const moved = ref(0);
const movedDiff = ref(0);
const swiperEl = ref<HTMLDivElement | null>(null);
let prevRotation = 0;

const displayValue = computed(() => {
  return ((-(moved.value + movedDiff.value) / DEGREE_DIST_PX) * DEGREE_STEP)
    .toFixed(1)
    .replace(/\.0$/, '')
    .replace(/^-0$/, '0');
});

// ─── Swipe handler ─────────────────────────────────────────────

function startSwipe(e: PointerEvent) {
  const startX = e.clientX;
  const initMoved = moved.value;
  let currentDiff = movedDiff.value;
  let initialScale = store.mediaState.scale;
  store.uiState.isMoving = true;

  function onMove(ev: PointerEvent) {
    const xDiff = ev.clientX - startX;
    currentDiff = clamp(initMoved + xDiff, -MAX_DEGREES_DIST_PX, MAX_DEGREES_DIST_PX) - initMoved;
    movedDiff.value = currentDiff;
    onSwipe(initialScale);
  }

  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);

    let newMoved = moved.value + movedDiff.value;
    if (Math.abs(newMoved) === MAX_DEGREES_DIST_PX) {
      newMoved = 0;
      prevRotation = 0;
    }
    moved.value = newMoved;
    movedDiff.value = 0;
    store.uiState.isMoving = false;
    store.mediaState.rotation = store.mediaState.rotation % (Math.PI * 2);
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function onSwipe(initialScale: number) {
  const co = cropOffset.value;
  const ms = store.uiState.mediaSize;
  if (!ms || !initialScale) return;

  const rotFromSwiper = rotationFromMove(moved.value + movedDiff.value);
  const rotDiff = rotFromSwiper - prevRotation;

  const targetRotation = store.mediaState.rotation - rotDiff;

  const r = [Math.cos(rotDiff), Math.sin(rotDiff)];
  const targetTranslation: Vec2 = [
    store.mediaState.translation[0] * r[0] + store.mediaState.translation[1] * r[1],
    store.mediaState.translation[1] * r[0] - store.mediaState.translation[0] * r[1]
  ];

  prevRotation = rotFromSwiper;

  store.mediaState.rotation = targetRotation;
  store.mediaState.translation = targetTranslation;

  // Compute minimum scale to keep image covering the crop area at new rotation
  const [w, h] = ms;
  const origRatio = w / h;
  const [imgW, imgH] = fitToAspectRatio(origRatio, co.width, co.height);
  const [cropW, cropH] = fitToAspectRatio(store.mediaState.currentImageRatio, co.width, co.height);

  const absRot = Math.abs(targetRotation % (Math.PI * 2));
  const sinR = Math.abs(Math.sin(absRot));
  const cosR = Math.abs(Math.cos(absRot));

  // Effective dimensions needed to cover crop at this rotation
  const neededW = cropW * cosR + cropH * sinR;
  const neededH = cropW * sinR + cropH * cosR;

  const minScale = Math.max(neededW / imgW, neededH / imgH);

  // Track scale both up and down during swipe, never below initial
  store.mediaState.scale = Math.max(initialScale, minScale);
}

// ─── Rotate 90° ────────────────────────────────────────────────

function rotateLeft() {
  const co = cropOffset.value;
  const ms = store.uiState.mediaSize;
  if (!ms) return;

  const newRotation = (Math.round((store.mediaState.rotation / Math.PI) * 2) * Math.PI) / 2 - Math.PI / 2;
  const snappedRot90 = Math.round((newRotation / Math.PI) * 2);
  const isReversed = Math.abs(snappedRot90) & 1;

  const [w, h] = ms;
  let ratio: number;
  if (store.uiState.fixedImageRatioKey?.includes('x') || store.uiState.fixedImageRatioKey?.includes(':')) {
    ratio = store.mediaState.currentImageRatio;
  } else {
    ratio = isReversed ? h / w : w / h;
  }

  const origRatio = w / h;
  const [w1, h1] = fitToAspectRatio(origRatio, co.width, co.height);
  const [w2, h2] = fitToAspectRatio(ratio, co.width, co.height);

  const initScale = store.mediaState.scale;
  const initTrans = [...store.mediaState.translation] as Vec2;
  const initRot = store.mediaState.rotation;
  const targetScale = isReversed ? Math.max(w2 / h1, h2 / w1) : Math.max(w2 / w1, h2 / h1);

  store.mediaState.currentImageRatio = ratio;
  store.uiState.isMoving = true;

  tween({
    from: 0, to: 1, duration: 200,
    onUpdate: (p: number) => {
      store.mediaState.scale = mix(initScale, targetScale, p);
      store.mediaState.translation = mixArray(initTrans, [0, 0], p) as Vec2;
      store.mediaState.rotation = mix(initRot, newRotation, p);
    },
    onComplete: () => {
      store.uiState.isMoving = false;
      store.mediaState.rotation = store.mediaState.rotation % (Math.PI * 2);
    }
  });

  // Reset wheel visual
  tween({
    from: [moved.value, movedDiff.value], to: [0, 0], duration: 200,
    onUpdate: (v: number[]) => {
      moved.value = v[0];
      movedDiff.value = v[1];
    }
  });
  prevRotation = 0;
}

// ─── Flip ──────────────────────────────────────────────────────

function flipImage() {
  store.uiState.isMoving = true;
  const isReversedRatio = Math.abs(Math.round((store.mediaState.rotation / Math.PI) * 2)) & 1;
  const snap1 = (v: number) => v < 0 ? -1 : 1;
  const targetFlip: Vec2 = [
    snap1(store.mediaState.flip[0]) * (isReversedRatio ? 1 : -1),
    snap1(store.mediaState.flip[1]) * (isReversedRatio ? -1 : 1)
  ];

  tween({
    from: [...store.mediaState.flip], to: targetFlip, duration: 200,
    onUpdate: (v: Vec2) => { store.mediaState.flip = v; },
    onComplete: () => { store.uiState.isMoving = false; }
  });
}
</script>

<style>
.rotation-swiper-wrapper {
  mask-image: linear-gradient(to right, transparent 0%, black 15%, black 35%, transparent 44%, transparent 56%, black 65%, black 85%, transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 15%, black 35%, transparent 44%, transparent 56%, black 65%, black 85%, transparent 100%);
}
.rotation-label::after,
.rotation-value::after {
  content: '\00B0';
  position: absolute;
  right: 0;
  top: 0;
  transform: translateX(100%);
}
.rotation-dot:nth-child(7n) {
  opacity: 0.5;
}
</style>
