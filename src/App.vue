<script setup lang="ts">
import { Toaster } from '@/components/ui/toast/'
import { useColorMode } from '@vueuse/core';
import DevPanel from './components/DevPanel.vue';
let mode = useColorMode();
mode.value = 'auto';
</script>

<template>
  <RouterView />
  <Toaster />
  <DevPanel />
</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}

.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}

.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
