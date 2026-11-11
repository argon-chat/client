<template>
  <canvas ref="canvasEl" class="screencast-canvas"></canvas>
</template>

<script setup lang="ts">
/** Canvas 2D strokes painted inside a capture-excluded VnWindow. */
import { onMounted, onUnmounted, ref, watch } from "vue";
import { onNativeStroke } from "@/lib/shell/overlays";
import { StrokeCanvas } from "@/lib/screencast-draw/StrokeCanvas";
import type { DrawPacket } from "@/lib/screencast-draw/types";

const props = defineProps<{ surfaceWidth?: number; surfaceHeight?: number }>();
let offStroke: (() => void) | undefined;
const canvasEl = ref<HTMLCanvasElement | null>(null);
let surface: StrokeCanvas | null = null;

function sizeCanvas(): void {
  if (!canvasEl.value || !surface) return;
  const dpr = window.devicePixelRatio || 1;
  // Backing store at physical resolution → 1 canvas px ≈ 1 physical screen px.
  surface.resize(props.surfaceWidth ?? window.innerWidth * dpr, props.surfaceHeight ?? window.innerHeight * dpr);
  surface.kick();
}

function onResize(): void {
  sizeCanvas();
}

watch(() => [props.surfaceWidth, props.surfaceHeight], sizeCanvas);

onMounted(() => {
  if (!canvasEl.value) return;
  surface = new StrokeCanvas(canvasEl.value);
  sizeCanvas();

  const accept = (packet: DrawPacket) => {
    if (surface?.ingest(packet)) surface.kick();
  };
  offStroke = onNativeStroke(accept);

  window.addEventListener("resize", onResize);
});

onUnmounted(() => {
  offStroke?.();
  window.removeEventListener("resize", onResize);
  surface?.dispose();
  surface = null;
});
</script>

<style scoped>
/* The overlay window's box, not 100vw/100vh: in a native pop-out those are the MAIN window's
   viewport, which drew the strokes shrunk into a corner, and nowhere once it was minimised. */
.screencast-canvas {
  display: block;
  width: 100%;
  height: 100%;
  background: transparent;
}
</style>
