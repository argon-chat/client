<script setup lang="ts">
import { Toaster } from '@/components/ui/toast/'
import { useColorMode, useMagicKeys } from '@vueuse/core';
import DevPanel from './components/DevPanel.vue';
import { useSystemStore } from './store/systemStore';
import {
  MinusIcon,
  XIcon
} from 'lucide-vue-next';
import { watch } from 'vue';
import { usePreference } from './store/preferenceStore';
const sys = useSystemStore();
const preferences = usePreference();
const keys = useMagicKeys();

let mode = useColorMode();

mode.value = 'dark';


const shiftCtrlA = keys["Shift+Ctrl+Digit9"];

watch(shiftCtrlA, (_) => {
  native.toggleDevTools();
});


const beginMove = () => {
  native.beginMoveWindow();
}

const pressSystemKey = (key: number) => {
  native.pressSystemKey(key);
}

const endMove = () => {
  native.endMoveWindow();
}

const closeWindow = () => {
  if (preferences.minimizeToTrayOnClose) {
    pressSystemKey(2);
  } else {
    pressSystemKey(0);
  }
}
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

  <div class="top-container  flex-col rounded-xl p-2 shadow-md justify-between">
    <div class="sys-keyholder">
      <MinusIcon height="16" width="16" class="close-icon" @click="pressSystemKey(1)" />
      <XIcon height="16" width="16" class="close-icon" @click="closeWindow" />
    </div>
  </div>

  <div class="topbar-collider" @mousedown="beginMove" @mouseup="endMove" />
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
.top-container {
  position: absolute;
  right: 0;
  top: 0;
}


.close-icon {
  color: #686868;
}

.close-icon:hover {
  color: #bebebe;
  cursor: pointer;
}

.close-icon:active {
  color: #0f9ed6;
  cursor: pointer;
}

.topbar-collider {
  position: absolute;
  top: 0;
  left: 0;
  width: calc(100% - 60px);
  height: 25px;
}

.sys-keyholder {
  justify-content: center;
  display: flex;
  gap: 10px;
  flex: auto;
}
</style>
