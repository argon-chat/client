<script setup lang="ts">
import { Toaster } from '@/components/ui/toast/'
import { useColorMode, useMagicKeys } from '@vueuse/core';
import DevPanel from './components/DevPanel.vue';
import { useSystemStore } from './store/systemStore';
import {
  MinusIcon,
  XIcon,
  FullscreenIcon
} from 'lucide-vue-next';
import { ref, watch } from 'vue';
import { usePreference } from './store/preferenceStore';
import Island from './components/Island.vue';
const sys = useSystemStore();
const preferences = usePreference();
const keys = useMagicKeys();
const isRestored = ref(false);

let mode = useColorMode();

mode.value = 'dark';


if (argon.isArgonHost) {
  document.body.style.setProperty('background', 'transparent', 'important');
}

const shiftCtrlA = keys["Shift+Ctrl+Digit9"];

const nativeControlsActive = ref(true);

watch(shiftCtrlA, (_) => {
  native.toggleDevTools();
});


const beginMove = () => {
  native.beginMoveWindow();
}

const pressSystemKey = (key: number) => {
  native.pressSystemKey(key);
}

const pressMaximize = () => {
  if (isRestored.value) {
    pressSystemKey(4);
  } else {
    pressSystemKey(3);
  }

  isRestored.value = !isRestored.value;
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
  <Island class="select-none"  v-if="sys.isRequestRetrying" :title="`Reconnecting`"/>

  <div class="top-container  flex-col rounded-xl p-2 shadow-md justify-between" v-if="!nativeControlsActive">
    <div class="sys-keyholder">
      <MinusIcon height="16" width="16" class="close-icon" @click="pressSystemKey(1)" />
      <FullscreenIcon height="16" width="16" class="close-icon" @click="pressMaximize"/>
      <XIcon height="16" width="16" class="close-icon" @click="closeWindow" />
    </div>
  </div>

  <div class="topbar-collider" @mousedown="beginMove" @mouseup="endMove" v-if="!nativeControlsActive" />
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
  width: calc(100% - 90px);
  height: 25px;
}

.sys-keyholder {
  justify-content: center;
  display: flex;
  gap: 10px;
  flex: auto;
}
</style>
