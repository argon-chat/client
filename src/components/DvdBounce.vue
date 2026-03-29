<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useIdleStore } from "@/store/idleStore";

const DVD_IDLE_THRESHOLD = 8 * 60 * 60;

const idleStore = useIdleStore();
const show = computed(() => idleStore.idleSeconds >= DVD_IDLE_THRESHOLD);

const x = ref(100);
const y = ref(100);
const dx = ref(2);
const dy = ref(2);
const hue = ref(0);
const logoWidth = 150;
const logoHeight = 150;

let animFrame: number | null = null;

function randomHue() {
  hue.value = Math.floor(Math.random() * 360);
}

function animate() {
  x.value += dx.value;
  y.value += dy.value;

  const maxX = window.innerWidth - logoWidth;
  const maxY = window.innerHeight - logoHeight;

  if (x.value <= 0 || x.value >= maxX) {
    dx.value = -dx.value;
    randomHue();
    x.value = Math.max(0, Math.min(x.value, maxX));
  }

  if (y.value <= 0 || y.value >= maxY) {
    dy.value = -dy.value;
    randomHue();
    y.value = Math.max(0, Math.min(y.value, maxY));
  }

  animFrame = requestAnimationFrame(animate);
}

onMounted(() => {
  x.value = Math.random() * (window.innerWidth - logoWidth);
  y.value = Math.random() * (window.innerHeight - logoHeight);
  randomHue();
  animFrame = requestAnimationFrame(animate);
});

onUnmounted(() => {
  if (animFrame !== null) cancelAnimationFrame(animFrame);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="dvd-overlay" @click.stop>
      <svg
        class="dvd-logo"
        :style="{
          transform: `translate(${x}px, ${y}px)`,
          filter: `hue-rotate(${hue}deg)`,
        }"
        viewBox="0 0 15.465 15.465"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g fill="#6366f1">
          <path d="M7.4,8.959c-4.132,0-7.4,0.55-7.4,1.227c0,0.678,3.268,1.227,7.4,1.227s7.543-0.549,7.543-1.227C14.944,9.508,11.533,8.959,7.4,8.959z M7.263,10.51c-0.957,0-1.733-0.237-1.733-0.53s0.776-0.53,1.733-0.53s1.732,0.237,1.732,0.53S8.219,10.51,7.263,10.51z M13.319,4.052H9.701L7.769,6.291l-0.92-2.208H1.145L0.933,5.045h2.269c0,0,1.037-0.136,1.071,0.694c0,1.438-2.376,1.316-2.376,1.316l0.444-1.5H0.869L0.194,7.988h2.668c0,0,2.821-0.25,2.821-2.218c0,0,0.114-0.574,0.066-0.827L7.124,8.62l3.435-3.565h2.606c0,0,0.798,0.068,0.798,0.685c0,1.438-2.359,1.288-2.359,1.288l0.365-1.472h-1.287L9.946,7.989h2.453c0,0,3.066-0.19,3.066-2.279C15.465,5.709,15.404,4.052,13.319,4.052z" />
        </g>
      </svg>
    </div>
  </Teleport>
</template>

<style scoped>
.dvd-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 99999;
  pointer-events: none;
}

.dvd-logo {
  position: absolute;
  top: 0;
  left: 0;
  width: 150px;
  height: 150px;
  will-change: transform, filter;
  transition: filter 0.3s ease;
}
</style>
