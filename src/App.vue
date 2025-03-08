<script setup lang="ts">
import { Toaster } from '@/components/ui/toast/'
import { useColorMode, useMagicKeys } from '@vueuse/core';
import DevPanel from './components/DevPanel.vue';
import { useSystemStore } from './store/systemStore';
import { watch } from 'vue';
const sys = useSystemStore();
let mode = useColorMode();
mode.value = 'auto';

const keys = useMagicKeys();

const shiftCtrlA = keys["Shift+Ctrl+P"];

watch(shiftCtrlA, (v) => {
  if (v) native.toggleDevTools();
});
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
