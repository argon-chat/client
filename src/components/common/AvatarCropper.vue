<template>
  <div class="media-editor__main-canvas" ref="rootEl">
    <canvas ref="canvas" />

    <!-- Spotlight (dark overlay with circular cutout) -->
    <div class="media-editor__spotlight-background" :style="{ mask: `url(#${spotlightId})`, WebkitMask: `url(#${spotlightId})` }" />
    <svg class="media-editor__spotlight-mask-svg" width="0" height="0">
      <mask :id="spotlightId">
        <rect x="0" y="0" fill="white" :width="W + 1" :height="H + 1" />
        <rect
          v-if="aspectRatio"
          fill="black"
          :x="cropX" :y="cropY"
          :width="cropW" :height="cropH"
          :rx="4"
        />
        <rect
          v-else
          fill="black"
          :x="cropX" :y="cropY"
          :width="cropW" :height="cropH"
          :rx="cropW / 2"
        />
      </mask>
    </svg>

    <!-- Crop handles -->
    <div class="media-editor__crop-handles" :style="cropStyle">
      <div class="media-editor__crop-handles-line-h" style="top:33%" />
      <div class="media-editor__crop-handles-line-h" style="top:66%" />
      <div class="media-editor__crop-handles-line-v" style="left:33%" />
      <div class="media-editor__crop-handles-line-v" style="left:66%" />
    </div>

    <!-- Rotation wheel -->
    <div class="media-editor__rotation-wheel">
      <button class="media-editor__rotation-wheel-button" @click="rotate90(-1)">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 2v6h6"/><path d="M2.66 8A9 9 0 1 1 4.34 16"/></svg>
      </button>

      <div class="media-editor__rotation-wheel-swiper-wrapper">
        <div
          class="media-editor__rotation-wheel-swiper"
          ref="swiperEl"
          :style="{ '--moved': wheelPx + 'px' }"
          @pointerdown.prevent="onWheelDown"
        >
          <div class="media-editor__rotation-wheel-labels">
            <div v-for="n in 13" :key="n" class="media-editor__rotation-wheel-label">
              <div class="media-editor__rotation-wheel-label-number">{{ (n - 1) * 15 - 90 }}</div>
            </div>
          </div>
          <div class="media-editor__rotation-wheel-dots">
            <div v-for="n in 97" :key="n" class="media-editor__rotation-wheel-dot" />
          </div>
        </div>
      </div>

      <div class="media-editor__rotation-wheel-value">
        <div class="media-editor__rotation-wheel-value-number">{{ degDisplay }}</div>
      </div>

      <svg class="media-editor__rotation-wheel-arrow" width="6" height="4" viewBox="0 0 6 4" fill="none">
        <path d="M2.29289 0.707106L0.28033 2.71967C-0.192143 3.19214 0.142482 4 0.81066 4H5.18934C5.85752 4 6.19214 3.19214 5.71967 2.71967L3.70711 0.707107C3.31658 0.316583 2.68342 0.316582 2.29289 0.707106Z" fill="white" />
      </svg>

      <button class="media-editor__rotation-wheel-button" @click="rotate90(1)">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6"/><path d="M21.34 8A9 9 0 1 0 19.66 16"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(defineProps<{
  src: string
  aspectRatio?: number
}>(), {})

const emit = defineEmits<{ (e: 'ready'): void }>()

// DOM
const rootEl = ref<HTMLElement>()
const canvas = ref<HTMLCanvasElement>()
const swiperEl = ref<HTMLElement>()

// Layout
const W = ref(400)
const H = ref(600)
const PADDING = 60
const spotlightId = 'spotlight-' + Math.random().toString(36).slice(2, 8)

// Crop rect (centered, square or aspect-ratio)
const cropW = computed(() => {
  const maxW = W.value - PADDING * 2
  const maxH = H.value - PADDING * 2 - 60 // leave room for wheel
  if (!props.aspectRatio) {
    const s = Math.min(maxW, maxH)
    return s
  }
  return maxW / maxH > props.aspectRatio ? maxH * props.aspectRatio : maxW
})
const cropH = computed(() => props.aspectRatio ? cropW.value / props.aspectRatio : cropW.value)
const cropX = computed(() => (W.value - cropW.value) / 2)
const cropY = computed(() => (H.value - 60 - cropH.value) / 2) // offset up for wheel space

const cropStyle = computed(() => ({
  left: cropX.value + 'px',
  top: cropY.value + 'px',
  width: cropW.value + 'px',
  height: cropH.value + 'px',
}))

// Image
let img: HTMLImageElement | null = null
let natW = 1, natH = 1, loaded = false

// Transform
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const angle = ref(0) // degrees

// Drag
let dragging = false, dsx = 0, dsy = 0, dtx = 0, dty = 0

// Wheel rotation
const PX_PER_15 = 42
const MAX_PX = 6 * PX_PER_15
const wheelPx = ref(0)
let wDragging = false, wsx = 0, wInit = 0

const degDisplay = computed(() => {
  const d = -wheelPx.value / PX_PER_15 * 15
  const s = d.toFixed(1).replace(/\.0$/, '')
  return s === '-0' ? '0' : s
})

// --- Render ---
let raf = 0
function scheduleRender() { if (!raf) raf = requestAnimationFrame(render) }

function render() {
  raf = 0
  const c = canvas.value
  if (!c || !img || !loaded) return
  const dpr = window.devicePixelRatio || 1
  c.width = W.value * dpr; c.height = H.value * dpr
  c.style.width = W.value + 'px'; c.style.height = H.value + 'px'

  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.save()
  ctx.scale(dpr, dpr)
  // Move to crop center + translation
  const ccx = cropX.value + cropW.value / 2
  const ccy = cropY.value + cropH.value / 2
  ctx.translate(ccx + tx.value, ccy + ty.value)
  ctx.rotate(angle.value * Math.PI / 180)
  ctx.scale(scale.value, scale.value)
  ctx.drawImage(img, -natW / 2, -natH / 2, natW, natH)
  ctx.restore()
}

// --- Fit ---
function fitScale() {
  if (!loaded) return 1
  return Math.max(cropW.value / natW, cropH.value / natH)
}

function resetView() {
  scale.value = fitScale()
  tx.value = 0; ty.value = 0; angle.value = 0
  wheelPx.value = 0
}

// --- Clamp translation ---
function clamp() {
  const s = scale.value
  const hw = natW * s / 2, hh = natH * s / 2
  const cw2 = cropW.value / 2, ch2 = cropH.value / 2
  const maxTx = Math.max(0, hw - cw2)
  const maxTy = Math.max(0, hh - ch2)
  tx.value = Math.max(-maxTx, Math.min(maxTx, tx.value))
  ty.value = Math.max(-maxTy, Math.min(maxTy, ty.value))
}

// --- Ensure image covers crop after rotation ---
function ensureCoverage() {
  const rad = angle.value * Math.PI / 180
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad))
  const iw = natW * scale.value, ih = natH * scale.value
  const bw = iw * cos + ih * sin
  const bh = iw * sin + ih * cos
  const needed = Math.max(cropW.value / bw, cropH.value / bh)
  if (needed > 1) scale.value *= needed
}

// --- Pointer (pan) ---
function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  dragging = true; dsx = e.clientX; dsy = e.clientY; dtx = tx.value; dty = ty.value
  rootEl.value?.setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  tx.value = dtx + (e.clientX - dsx)
  ty.value = dty + (e.clientY - dsy)
  clamp()
}
function onPointerUp() { dragging = false }

// --- Scroll zoom ---
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const min = fitScale()
  const f = e.deltaY > 0 ? 0.93 : 1.07
  scale.value = Math.max(min, Math.min(min * 10, scale.value * f))
  clamp()
}

// --- Rotation swiper ---
function onWheelDown(e: PointerEvent) {
  wDragging = true; wsx = e.clientX; wInit = wheelPx.value
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onWheelMove)
  window.addEventListener('pointerup', onWheelUp)
}
function onWheelMove(e: PointerEvent) {
  if (!wDragging) return
  let px = wInit + (e.clientX - wsx)
  px = Math.max(-MAX_PX, Math.min(MAX_PX, px))
  wheelPx.value = px
  angle.value = -px / PX_PER_15 * 15
  ensureCoverage()
}
function onWheelUp() {
  wDragging = false
  window.removeEventListener('pointermove', onWheelMove)
  window.removeEventListener('pointerup', onWheelUp)
}

function rotate90(dir: number) {
  const target = Math.round(angle.value / 90) * 90 + dir * 90
  const start = angle.value
  const t0 = performance.now()
  wheelPx.value = 0
  function tick(now: number) {
    const t = Math.min(1, (now - t0) / 200)
    angle.value = start + (target - start) * (1 - (1 - t) ** 3)
    ensureCoverage()
    if (t < 1) requestAnimationFrame(tick)
    else { tx.value = 0; ty.value = 0; clamp() }
  }
  requestAnimationFrame(tick)
}

// --- Load ---
function load() {
  loaded = false
  img = new Image()
  img.onload = () => {
    natW = img!.naturalWidth; natH = img!.naturalHeight; loaded = true
    resetView(); scheduleRender(); emit('ready')
  }
  img.src = props.src
}

// --- Crop output ---
async function getCroppedCanvas(size = 512): Promise<HTMLCanvasElement> {
  const out = document.createElement('canvas')
  const outH = props.aspectRatio ? Math.round(size / props.aspectRatio) : size
  out.width = size; out.height = outH
  if (!img || !loaded) return out
  const ctx = out.getContext('2d')!
  const outputScale = size / cropW.value
  ctx.translate(size / 2, outH / 2)
  ctx.translate(tx.value * outputScale, ty.value * outputScale)
  ctx.rotate(angle.value * Math.PI / 180)
  ctx.scale(scale.value * outputScale, scale.value * outputScale)
  ctx.drawImage(img, -natW / 2, -natH / 2, natW, natH)
  return out
}

async function getCroppedDataURL(size = 512, quality = 0.92): Promise<string> {
  const c = await getCroppedCanvas(size)
  return c.toDataURL('image/jpeg', quality)
}

// --- Lifecycle ---
let ro: ResizeObserver | null = null

onMounted(() => {
  const el = rootEl.value!
  const r = el.getBoundingClientRect()
  W.value = r.width; H.value = r.height
  ro = new ResizeObserver(entries => {
    W.value = entries[0].contentRect.width
    H.value = entries[0].contentRect.height
  })
  ro.observe(el)
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('wheel', onWheel, { passive: false })
  load()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  const el = rootEl.value
  if (el) {
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('wheel', onWheel)
  }
  window.removeEventListener('pointermove', onWheelMove)
  window.removeEventListener('pointerup', onWheelUp)
  if (raf) cancelAnimationFrame(raf)
})

watch(() => props.src, load)
watch([scale, tx, ty, angle, W, H], scheduleRender)

defineExpose({ getCroppedCanvas, getCroppedDataURL })
</script>

<style scoped>
.media-editor__main-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  background: #000;
}
.media-editor__main-canvas:active {
  cursor: grabbing;
}
.media-editor__main-canvas canvas {
  position: absolute;
  inset: 0;
}

/* Spotlight */
.media-editor__spotlight-background {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  pointer-events: none;
}
.media-editor__spotlight-mask-svg {
  position: absolute;
  pointer-events: none;
}

/* Crop handles */
.media-editor__crop-handles {
  position: absolute;
  pointer-events: none;
  border: 1.5px solid rgba(255, 255, 255, 0.4);
  border-radius: 50%;
}
.media-editor__crop-handles-line-h,
.media-editor__crop-handles-line-v {
  position: absolute;
  background: rgba(255, 255, 255, 0.12);
}
.media-editor__crop-handles-line-h {
  left: 0; width: 100%; height: 1px;
}
.media-editor__crop-handles-line-v {
  top: 0; height: 100%; width: 1px;
}

/* Rotation wheel */
.media-editor__rotation-wheel {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  pointer-events: auto;
}
.media-editor__rotation-wheel-button {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
}
.media-editor__rotation-wheel-button:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}
.media-editor__rotation-wheel-swiper-wrapper {
  flex: 1;
  height: 100%;
  overflow: hidden;
  position: relative;
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}
.media-editor__rotation-wheel-swiper {
  position: absolute;
  left: 50%;
  top: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transform: translateX(var(--moved, 0px));
  cursor: ew-resize;
  touch-action: none;
}
.media-editor__rotation-wheel-labels {
  display: flex;
}
.media-editor__rotation-wheel-label {
  width: 42px;
  text-align: center;
  flex-shrink: 0;
}
.media-editor__rotation-wheel-label-number {
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.3);
}
.media-editor__rotation-wheel-dots {
  display: flex;
}
.media-editor__rotation-wheel-dot {
  width: 2px;
  height: 6px;
  margin: 0 2px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.18);
}
.media-editor__rotation-wheel-dot:nth-child(8n+1) {
  height: 10px;
  background: rgba(255, 255, 255, 0.4);
}
.media-editor__rotation-wheel-value {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.media-editor__rotation-wheel-value-number {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
}
.media-editor__rotation-wheel-arrow {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  pointer-events: none;
}
</style>
