<template>
  <div class="w-full h-full bg-black absolute">
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useAppState } from "@/store/appState";
import { useWebGLBackground } from "@/composables/useWebGLBackground";
import { generateFragmentShader } from "@/lib/shaders/backgroundShader";

const app = useAppState();
const canvas = ref<HTMLCanvasElement | null>(null);

const webgl = useWebGLBackground(canvas, {
  fragmentShaderSource: generateFragmentShader(),
});

onMounted(async () => {
  webgl.start();
  await app.initApp();
});

onBeforeUnmount(() => {
  webgl.stop();
});
</script>

<style scoped>
canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
</style>
