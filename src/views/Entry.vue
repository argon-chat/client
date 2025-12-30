<template>
  <div class="w-full h-full bg-black absolute">
    <canvas ref="canvas" class="w-full h-full"></canvas>

    <div class="fixed bottom-4 left-4 right-4 z-20">
      <blockquote class="space-y-1 text-center sm:text-left">
        <p class="text-base sm:text-lg">
          &ldquo;{{ randomQuote.text }}.&rdquo;
        </p>
        <footer class="text-xs sm:text-sm">
          {{ randomQuote.author }}
        </footer>
      </blockquote>
    </div>

    <div 
      v-if="logs.length > 0"
      class="fixed top-2 right-2 left-2 sm:left-auto sm:right-4 sm:w-80
             bg-gray-900 text-white p-2 sm:p-4 rounded-lg shadow-lg 
             overflow-y-auto max-h-40 sm:max-h-64 text-xs sm:text-sm">
      <div 
        v-for="(log, index) in logs" 
        :key="index" 
        :class="log.type === 'error' ? 'text-red-400' : 'text-green-400'">
        [{{ log.time }}] {{ log.message }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { useAppState } from "@/store/appState";
import { useWebGLBackground } from "@/composables/useWebGLBackground";
import { useAppLogger } from "@/composables/useAppLogger";
import { getRandomQuote } from "@/lib/quotes";
import { generateFragmentShader } from "@/lib/shaders/backgroundShader";

const app = useAppState();
const canvas = ref<HTMLCanvasElement | null>(null);
const randomQuote = getRandomQuote();
const { logs, initLogger } = useAppLogger();

const webgl = useWebGLBackground(canvas, {
  fragmentShaderSource: generateFragmentShader(),
});

onMounted(async () => {
  initLogger();
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
  top: 50%;
  left: 50%;
  width: auto;
  height: 100%;
  aspect-ratio: 1 / 1;
  transform: translate(-50%, -50%);
}
</style>
