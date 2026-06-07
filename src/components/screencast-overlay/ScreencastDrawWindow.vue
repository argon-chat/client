<template>
  <canvas ref="canvasEl" class="screencast-canvas"></canvas>
</template>

<script setup lang="ts">
/**
 * Lean offscreen view that renders screencast-drawing strokes for the streamer's
 * physical screen. Rendered inside a dedicated offscreen Electron BrowserWindow whose
 * painted output is handed (as a shared D3D11 texture) to the native overlay plugin
 * (libsdraw). Receives stroke packets over the `argonScreencastDraw` preload bridge;
 * owns no stores/socket. Sized to the full shared monitor, so normalized [0,1] points
 * map directly to canvas pixels.
 */
import { onMounted, onUnmounted, ref } from "vue";
import { StrokeCanvas } from "@/lib/screencast-draw/StrokeCanvas";
import type { DrawPacket } from "@/lib/screencast-draw/types";

const canvasEl = ref<HTMLCanvasElement | null>(null);
let surface: StrokeCanvas | null = null;

function sizeCanvas(): void {
  if (!canvasEl.value || !surface) return;
  const dpr = window.devicePixelRatio || 1;
  // Backing store at physical resolution → 1 canvas px ≈ 1 physical screen px.
  surface.resize(window.innerWidth * dpr, window.innerHeight * dpr);
  surface.kick();
}

function onResize(): void {
  sizeCanvas();
}

onMounted(() => {
  if (!canvasEl.value) return;
  surface = new StrokeCanvas(canvasEl.value);
  sizeCanvas();

  const bridge = (window as any).argonScreencastDraw;
  bridge?.onStroke?.((packet: DrawPacket) => {
    if (!surface) return;
    if (surface.ingest(packet)) surface.kick();
  });
  bridge?.requestState?.();

  window.addEventListener("resize", onResize);
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  surface?.dispose();
  surface = null;
});
</script>

<style scoped>
.screencast-canvas {
  display: block;
  width: 100vw;
  height: 100vh;
  background: transparent;
}
</style>
