<script setup lang="ts">
import { Toaster } from '@/components/ui/toast/'
import { useColorMode } from '@vueuse/core';
import DevPanel from './components/DevPanel.vue';
import { useSystemStore } from './store/systemStore';
const sys = useSystemStore();
let mode = useColorMode();
mode.value = 'auto';
</script>

<template>
  <RouterView />
  <Toaster />
  <DevPanel />
  <div v-if="sys.isRequestRetrying" class="warn-text select-none">

    <div v-for="i in sys.activeRetries" :key="i">
      [{{ i }}] Reconnecting...
    </div>
  </div>
</template>

<style scoped>
.warn-text {
  position: fixed;
  bottom: 10px;
  left: 10px;
  color: red;
  font-size: 20px;
  font-weight: bold;
  white-space: nowrap;
}
</style>
