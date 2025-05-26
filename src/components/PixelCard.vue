<template>
  <div ref="containerRef" class="pixel-card" @focus="finalNoFocus ? undefined : onFocus"
    @blur="finalNoFocus ? undefined : onBlur" :tabindex="finalNoFocus ? -1 : 0">
    <canvas ref="canvasRef" class="pixel-canvas"></canvas>
    <slot></slot>
  </div>
</template>


<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
type PixelShape = 'square' | 'circle' | 'cross' | 'diamond';


class Pixel {
  private width: number;
  private height: number;
  private ctx: CanvasRenderingContext2D;

  private x: number;
  private y: number;
  private color: string;

  private speed: number;
  private size: number;
  private sizeStep: number;
  private minSize: number;
  private maxSizeInteger: number;
  private maxSize: number;

  private delay: number;
  private counter: number;
  private counterStep: number;

  private isIdle: boolean;
  private isReverse: boolean;
  private isShimmer: boolean;

  private alpha: number;
  private shape: PixelShape;
  private pulseOffset: number;
  private jitter: boolean;

  private flickerTimer: number;
  private flickerState: boolean;

  constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    speed: number,
    delay: number
  ) {
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

    // 🎨 Visual Effects
    this.alpha = 0.6 + Math.random() * 0.4;
    this.shape = ['square', 'circle', 'cross', 'diamond'][Math.floor(Math.random() * 4)] as PixelShape;
    this.pulseOffset = Math.random() * Math.PI * 2;
    this.jitter = Math.random() < 0.2;

    // ⚡ Flicker effect
    this.flickerTimer = Math.random() * 5000; // flicker interval
    this.flickerState = false;
  }

  private draw(): void {
    const time = performance.now();
    const tSec = time * 0.001;

    // jitter
    const jitterX = this.jitter ? (Math.random() - 0.5) * 0.6 : 0;
    const jitterY = this.jitter ? (Math.random() - 0.5) * 0.6 : 0;

    // pulse (scale oscillation)
    const pulse = 1 + 0.08 * Math.sin(tSec * 2 + this.pulseOffset);
    const drawSize = this.size * pulse;
    const centerOffset = this.maxSizeInteger * 0.5 - drawSize * 0.5;

    const px = this.x + centerOffset + jitterX;
    const py = this.y + centerOffset + jitterY;

    // flicker every few seconds
    if (time > this.flickerTimer) {
      this.flickerState = !this.flickerState;
      this.flickerTimer = time + 1000 + Math.random() * 4000;
    }

    this.ctx.save();
    this.ctx.globalAlpha = this.alpha * (this.flickerState ? 0.5 + Math.random() * 0.5 : 1);
    this.ctx.fillStyle = this.color;

    switch (this.shape) {
      case 'circle':
        this.ctx.beginPath();
        this.ctx.arc(px + drawSize / 2, py + drawSize / 2, drawSize / 2, 0, Math.PI * 2);
        this.ctx.fill();
        break;

      case 'cross':
        this.ctx.fillRect(px + drawSize * 0.4, py, drawSize * 0.2, drawSize);
        this.ctx.fillRect(px, py + drawSize * 0.4, drawSize, drawSize * 0.2);
        break;

      case 'diamond':
        this.ctx.beginPath();
        this.ctx.moveTo(px + drawSize / 2, py);
        this.ctx.lineTo(px + drawSize, py + drawSize / 2);
        this.ctx.lineTo(px + drawSize / 2, py + drawSize);
        this.ctx.lineTo(px, py + drawSize / 2);
        this.ctx.closePath();
        this.ctx.fill();
        break;

      case 'square':
      default:
        this.ctx.fillRect(px, py, drawSize, drawSize);
    }

    this.ctx.restore();
  }

  public appear(): void {
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

  public disappear(): void {
    this.isShimmer = false;
    this.counter = 0;
    if (this.size <= 0) {
      this.isIdle = true;
      return;
    }
    this.size -= 0.1;
    this.draw();
  }

  private shimmer(): void {
    if (this.size >= this.maxSize) {
      this.isReverse = true;
    } else if (this.size <= this.minSize) {
      this.isReverse = false;
    }
    this.size += this.isReverse ? -this.speed : this.speed;
  }
}
interface Variant {
  activeColor: string
  gap: number
  speed: number
  colors: string
  noFocus: boolean
}

const VARIANTS: Record<string, Variant> = {
  default: {
    activeColor: '#ffffff',
    gap: 18,
    speed: 40,
    colors: '#0f172a,#1e293b,#64748b',
    noFocus: true,
  },
}

const props = defineProps<{
  variant?: string
  gap?: number
  speed?: number
  colors?: string
  noFocus?: boolean
}>()

const containerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const pixelsRef = ref<Pixel[]>([])
const animationRef = ref<number | null>(null)
const timePreviousRef = ref<number>(performance.now())
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const variantCfg = computed(() => VARIANTS[props.variant ?? 'default'] || VARIANTS.default)
const finalGap = computed(() => props.gap ?? variantCfg.value.gap)
const finalSpeed = computed(() => props.speed ?? variantCfg.value.speed)
const finalColors = computed(() => props.colors ?? variantCfg.value.colors)
const finalNoFocus = computed(() => props.noFocus ?? variantCfg.value.noFocus)

const initPixels = () => {
  if (!containerRef.value || !canvasRef.value) return

  const rect = containerRef.value.getBoundingClientRect()
  const width = Math.floor(rect.width)
  const height = Math.floor(rect.height)
  const ctx = canvasRef.value.getContext('2d')
  if (!ctx) return

  canvasRef.value.width = width
  canvasRef.value.height = height

  const colorsArray = finalColors.value.split(',')
  const pxs: Pixel[] = []
  const gap = parseInt(String(finalGap.value), 10)

  for (let x = 0; x < width; x += gap) {
    for (let y = 0; y < height; y += gap) {
      const jitterX = (Math.random() - 0.5) * gap * 0.955
      const jitterY = (Math.random() - 0.5) * gap * 0.76
      const posX = x + jitterX
      const posY = y + jitterY
      const color = colorsArray[Math.floor(Math.random() * colorsArray.length)]
      const delay = reducedMotion ? 0 : Math.sqrt(posX ** 2 + posY ** 2)

      pxs.push(new Pixel(canvasRef.value!, ctx, posX, posY, color, finalSpeed.value * 0.001, delay))
    }
  }

  pixelsRef.value = pxs
  handleAnimation('appear')
}

const doAnimate = (fnName: keyof Pixel) => {
  animationRef.value = requestAnimationFrame(() => doAnimate(fnName))

  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  pixelsRef.value.forEach(pixel => pixel[fnName]())
}

const handleAnimation = (name: keyof Pixel) => {
  if (animationRef.value !== null) {
    cancelAnimationFrame(animationRef.value)
  }
  animationRef.value = requestAnimationFrame(() => doAnimate(name))
}

onMounted(() => {
  initPixels()

  const observer = new ResizeObserver(initPixels)
  if (containerRef.value) {
    observer.observe(containerRef.value)
  }

  onBeforeUnmount(() => {
    observer.disconnect()
  })
})
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