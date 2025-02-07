<template>
    <div
      ref="containerRef"
      class="pixel-card"
      @focus="finalNoFocus ? undefined : onFocus"
      @blur="finalNoFocus ? undefined : onBlur"
      :tabindex="finalNoFocus ? -1 : 0"
    >
      <canvas ref="canvasRef" class="pixel-canvas"></canvas>
      <slot></slot>
    </div>
  </template>


<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';

class Pixel {
  constructor(canvas, context, x, y, color, speed, delay) {
    this.width = canvas.width;
    this.height = canvas.height;
    this.ctx = context;
    this.x = x;
    this.y = y;
    this.color = color;
    this.speed = Math.random() * 0.8 * speed + 0.1 * speed;
    this.size = 0;
    this.sizeStep = Math.random() * 0.4;
    this.minSize = 0.5;
    this.maxSizeInteger = 2;
    this.maxSize = Math.random() * (this.maxSizeInteger - this.minSize) + this.minSize;
    this.delay = delay;
    this.counter = 0;
    this.counterStep = Math.random() * 4 + (this.width + this.height) * 0.01;
    this.isIdle = false;
    this.isReverse = false;
    this.isShimmer = false;
  }

  draw() {
    const centerOffset = this.maxSizeInteger * 0.5 - this.size * 0.5;
    this.ctx.fillStyle = this.color;
    this.ctx.fillRect(this.x + centerOffset, this.y + centerOffset, this.size, this.size);
  }

  appear() {
    this.isIdle = false;
    if (this.counter <= this.delay) {
      this.counter += this.counterStep;
      return;
    }
    if (this.size >= this.maxSize) {
      this.isShimmer = true;
    }
    if (this.isShimmer) {
      this.shimmer();
    } else {
      this.size += this.sizeStep;
    }
    this.draw();
  }

  disappear() {
    this.isShimmer = false;
    this.counter = 0;
    if (this.size <= 0) {
      this.isIdle = true;
      return;
    }
    this.size -= 0.1;
    this.draw();
  }

  shimmer() {
    if (this.size >= this.maxSize) {
      this.isReverse = true;
    } else if (this.size <= this.minSize) {
      this.isReverse = false;
    }
    this.size += this.isReverse ? -this.speed : this.speed;
  }
}

const VARIANTS = {
  default: { activeColor: '#ffffff', gap: 12, speed: 90, colors: '#fecdd3,#fda4af,#e11d48', noFocus: true },
  blue: { activeColor: '#e0f2fe', gap: 10, speed: 25, colors: '#e0f2fe,#7dd3fc,#0ea5e9', noFocus: true },
  yellow: { activeColor: '#fef08a', gap: 3, speed: 20, colors: '#fef08a,#fde047,#eab308', noFocus: true },
  pink: { activeColor: '#fecdd3', gap: 6, speed: 80, colors: '#fecdd3,#fda4af,#e11d48', noFocus: true }
};

const props = defineProps({
  variant: { type: String, default: 'default' },
  gap: Number,
  speed: Number,
  colors: String,
  noFocus: Boolean
});

const containerRef = ref(null);
const canvasRef = ref(null);
const pixelsRef = ref([]);
const animationRef = ref(null);
const timePreviousRef = ref(performance.now());
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const variantCfg = computed(() => VARIANTS[props.variant] || VARIANTS.default);
const finalGap = computed(() => props.gap ?? variantCfg.value.gap);
const finalSpeed = computed(() => props.speed ?? variantCfg.value.speed);
const finalColors = computed(() => props.colors ?? variantCfg.value.colors);
const finalNoFocus = computed(() => props.noFocus ?? variantCfg.value.noFocus);

const initPixels = () => {
  if (!containerRef.value || !canvasRef.value) return;

  const rect = containerRef.value.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  const ctx = canvasRef.value.getContext('2d');

  canvasRef.value.width = width;
  canvasRef.value.height = height;

  const colorsArray = finalColors.value.split(',');
  const pxs = [];
  for (let x = 0; x < width; x += parseInt(finalGap.value, 10)) {
    for (let y = 0; y < height; y += parseInt(finalGap.value, 10)) {
      const color = colorsArray[Math.floor(Math.random() * colorsArray.length)];
      const delay = reducedMotion ? 0 : Math.sqrt(x ** 2 + y ** 2);
      pxs.push(new Pixel(canvasRef.value, ctx, x, y, color, finalSpeed.value * 0.001, delay));
    }
  }
  pixelsRef.value = pxs;

  handleAnimation("appear")
};

const doAnimate = (fnName) => {
  animationRef.value = requestAnimationFrame(() => doAnimate(fnName));
  const ctx = canvasRef.value?.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvasRef.value.width, canvasRef.value.height);
  pixelsRef.value.forEach(pixel => pixel[fnName]());
};

const handleAnimation = (name) => {
  cancelAnimationFrame(animationRef.value);
  animationRef.value = requestAnimationFrame(() => doAnimate(name));
};

onMounted(() => {
  initPixels();
  const observer = new ResizeObserver(initPixels);
  observer.observe(containerRef.value);
  onBeforeUnmount(() => observer.disconnect());
});
</script>


<style scoped>
.pixel-canvas {
    width: 100%;
    height: 100%;
    display: block;
}

.pixel-card {
    position: relative;
    overflow: hidden;
    display: grid;
    place-items: center;
    isolation: isolate;
    user-select: none;
}

.pixel-card::before {
    position: absolute;
    inset: 0;
    margin: auto;
    aspect-ratio: 1;
    background: radial-gradient(circle, #09090b, transparent 85%);
    opacity: 0;
}

.pixel-card:hover::before,
.pixel-card:focus-within::before {
    opacity: 1;
}
</style>