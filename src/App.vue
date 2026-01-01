<script setup lang="ts">
import { Toaster } from "@/components/ui/toast/";
import { useColorMode, useMagicKeys } from "@vueuse/core";
import { useSystemStore } from "./store/systemStore";
import { MinusIcon, XIcon, FullscreenIcon } from "lucide-vue-next";
import { ref, watch } from "vue";
import { usePreference } from "./store/preferenceStore";
import Island from "./components/shared/Island.vue";
import { NConfigProvider, darkTheme } from 'naive-ui'
import { useSleepWatcher } from "./composables/useSleepWatcher";
import { native } from "./lib/glue/nativeGlue";
import { useAppState } from "./store/appState";
import IncomingCallOverlay from "./components/calls/IncomingCallOverlay.vue";
const sys = useSystemStore();
const appState = useAppState();
const preferences = usePreference();
const keys = useMagicKeys();
const isRestored = ref(false);

const mode = useColorMode();


const wakeWatcher = useSleepWatcher(async () => {
  location.reload();
});

mode.value = "dark";

if (argon.isArgonHost) {
  document.body.style.setProperty("background", "transparent", "important");
}

const shiftCtrlA = keys["Shift+Ctrl+Digit9"];

const nativeControlsActive = ref(true);

watch(shiftCtrlA, (_) => {
  native.hostProc.toggleDevTools();
});

const beginMove = () => {
  //native.hostProc.beginMoveWindow();
};

const pressSystemKey = (key: number) => {
  //native.hostProc.pressSystemKey(key);
};

const pressMaximize = () => {
  if (isRestored.value) {
    pressSystemKey(4);
  } else {
    pressSystemKey(3);
  }

  isRestored.value = !isRestored.value;
};

const endMove = () => {
  //native.endMoveWindow();
};

const closeWindow = () => {
  if (preferences.minimizeToTrayOnClose) {
    pressSystemKey(2);
  } else {
    pressSystemKey(0);
  }
};
const themeOverrides = {
  common: {
    bodyColor: '#000000',
    cardColor: '#000000',
    modalColor: '#000000',
    popoverColor: '#000000',
    tableColor: '#000000',
    inputColor: '#09090b',
    tagColor: '#000000',

    textColorBase: '#fafafa',
    textColor1: '#fafafa',
    textColor2: '#a1a1aa',
    placeholderColor: '#71717a',
    borderColor: '#27272a',
    borderColorHover: '#3f3f46',
    dividerColor: '#27272a',

    primaryColor: '#6366f1',
    primaryColorHover: '#818cf8',
    primaryColorPressed: '#4f46e5',
    primaryColorSuppl: '#6366f1',

    borderRadius: '0.375rem',
    boxShadow1: 'none',
    boxShadow2: 'none',
    boxShadow3: 'none',
  },

  Input: {
    color: '#000000',
    colorFocus: '#000000',
    borderHover: '#3f3f46',
    borderRadius: '0.375rem',
    textColor: '#fafafa',
    placeholderColor: '#71717a',
    heightMedium: '2.5rem',
    boxShadowFocus: '0 0 0 2px rgba(99,102,241,0.6)'
  },

  Button: {
    borderRadiusMedium: '0.375rem',
    colorPrimary: '#6366f1',
    colorHoverPrimary: '#818cf8',
    colorPressedPrimary: '#4f46e5',
    textColorPrimary: '#fff',
    textColorHoverPrimary: '#fff',
    textColorPressedPrimary: '#fff',
    border: '1px solid #6366f1',
    boxShadow: '0 0 0 2px rgba(99,102,241,0.6)'
  },

  DatePicker: {
    panelColor: '#000000',
    borderRadius: '0.375rem',
    itemTextColorHover: '#fafafa',
    itemTextColorActive: '#ffffff',
    boxShadow: '0 0 0 2px rgba(99,102,241,0.6)',


    panelTextColor: '#fafafa',
    panelActionTextColor: '#fafafa',
    panelHeaderTextColor: '#fafafa',
    panelHeaderColor: '#000000',
    panelActionColor: '#000000',

    itemTextColorOverlay: '#fafafa',
    itemTextColorActiveOverlay: '#ffffff',
    itemColorOverlayHover: '#18181b',
    itemColorOverlayActive: '#18181b',

    itemColorHover: '#fff',
    itemColorActive: '#1e1e1e',

    itemTextColorCurrent: '#a1a1aa',
    itemTextColorDisabled: '#3f3f46',

  },

  Select: {
    peers: {
      InternalSelection: {
        borderRadius: '0.375rem',
        color: '#000000',
        boxShadow: '0 0 0 2px rgba(99,102,241,0.6)',
      },
    },
  },
}
</script>

<template>
  <NConfigProvider :theme="darkTheme" :theme-overrides="themeOverrides">

    <RouterView />
    <Toaster />
    <IncomingCallOverlay/>
    <Island class="select-none" v-if="sys.isRequestRetrying && !sys.isLongReconnecting" :title="`Reconnecting`" />
    
    <!-- Long reconnect overlay -->
    <div v-if="sys.isLongReconnecting" class="reconnect-overlay">
      <div class="reconnect-content">
        <div class="reconnect-spinner"></div>
        <h2 class="reconnect-title">Connection Lost</h2>
        <p class="reconnect-message">Reconnecting to Argon...</p>
      </div>
    </div>
    
    <!-- Loading overlay -->
    <div v-if="appState.isInitializing" class="loading-overlay">
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <h2 class="loading-title">Initializing Argon</h2>
        <p class="loading-step">{{ appState.loadingStep }}</p>
        <div class="loading-bar">
          <div class="loading-progress" :style="{ width: `${(appState.loadingProgress / appState.totalSteps) * 100}%` }"></div>
        </div>
        <p class="loading-percent">{{ Math.round((appState.loadingProgress / appState.totalSteps) * 100) }}%</p>
      </div>
    </div>

    <div class="top-container  flex-col rounded-xl p-2 shadow-md justify-between" v-if="!nativeControlsActive">
      <div class="sys-keyholder">
        <MinusIcon height="16" width="16" class="close-icon" @click="pressSystemKey(1)" />
        <FullscreenIcon height="16" width="16" class="close-icon" @click="pressMaximize" />
        <XIcon height="16" width="16" class="close-icon" @click="closeWindow" />
      </div>
    </div>

    <div class="topbar-collider" @mousedown="beginMove" @mouseup="endMove" v-if="!nativeControlsActive" />
  </NConfigProvider>

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

/* Loading overlay styles */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.95);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  max-width: 400px;
  padding: 2rem;
}

.loading-spinner {
  width: 60px;
  height: 60px;
  border: 4px solid rgba(99, 102, 241, 0.1);
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #fafafa;
  margin: 0;
}

.loading-step {
  font-size: 0.875rem;
  color: #a1a1aa;
  margin: 0;
  text-align: center;
  min-height: 1.5rem;
}

.loading-bar {
  width: 100%;
  height: 4px;
  background: rgba(99, 102, 241, 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.loading-progress {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
  transition: width 0.3s ease;
  border-radius: 2px;
}

.loading-percent {
  font-size: 0.75rem;
  color: #71717a;
  margin: 0;
  font-weight: 500;
}

/* Reconnect overlay styles */
.reconnect-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9998;
}

.reconnect-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 2rem;
}

.reconnect-spinner {
  width: 50px;
  height: 50px;
  border: 3px solid rgba(239, 68, 68, 0.1);
  border-top-color: #ef4444;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.reconnect-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #fafafa;
  margin: 0;
}

.reconnect-message {
  font-size: 0.875rem;
  color: #a1a1aa;
  margin: 0;
  text-align: center;
}
</style>
