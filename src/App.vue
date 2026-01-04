<script setup lang="ts">
import { Toaster } from "@/components/ui/toast/";
import { useColorMode, useMagicKeys } from "@vueuse/core";
import { useSystemStore } from "./store/systemStore";
import { MinusIcon, XIcon, FullscreenIcon } from "lucide-vue-next";
import { ref, watch, onMounted } from "vue";
import { usePreference } from "./store/preferenceStore";
import Island from "./components/shared/Island.vue";
import { NConfigProvider, darkTheme } from 'naive-ui'
import { useSleepWatcher } from "./composables/useSleepWatcher";
import { native } from "./lib/glue/nativeGlue";
import { useAppState } from "./store/appState";
import IncomingCallOverlay from "./components/calls/IncomingCallOverlay.vue";
import { useTheme } from "@/composables/useTheme";

const sys = useSystemStore();
const appState = useAppState();
const preferences = usePreference();
const keys = useMagicKeys();
const isRestored = ref(false);

const mode = useColorMode();
const { applyAppearanceSettings, currentTheme } = useTheme();

const wakeWatcher = useSleepWatcher(async () => {
  location.reload();
});

mode.value = "dark";

// Apply all appearance settings on app start
onMounted(() => {
  applyAppearanceSettings();
  
  if (argon.isArgonHost) {
    // Set initial background based on theme
    const updateBackground = (theme: string) => {
      if (theme === "oled") {
        document.body.style.setProperty("background", "#000000", "important");
      } else {
        document.body.style.setProperty("background", "transparent", "important");
      }
    };
    
    // Apply initial theme
    updateBackground(currentTheme.value);
    
    // Watch for theme changes
    watch(currentTheme, (newTheme) => {
      updateBackground(newTheme);
    });
  }
});

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

const reloadPage = () => {
  location.reload();
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
        <Transition name="spinner-fade" mode="out-in">
          <div v-if="!appState.hasInitError" key="spinner" class="loading-spinner"></div>
          <div v-else key="error" class="error-icon-wrapper">
            <div class="error-icon">⚠</div>
          </div>
        </Transition>
        
        <Transition name="title-fade" mode="out-in">
          <h2 v-if="!appState.hasInitError" key="loading" class="loading-title">
            Initializing Argon
          </h2>
          <h2 v-else key="error" class="loading-title error-title">
            Initialization Failed
          </h2>
        </Transition>
        
        <Transition name="fade-slide" mode="out-in">
          <p v-if="!appState.hasInitError" key="step" class="loading-step">
            {{ appState.loadingStep }}
          </p>
          <p v-else key="error-msg" class="error-message">
            {{ appState.initError }}
          </p>
        </Transition>
        
        <Transition name="bar-fade">
          <div v-if="!appState.hasInitError" class="loading-bar" :class="{ 'loading-bar-error': appState.hasInitError }">
            <div class="loading-progress" 
                 :class="{ 'loading-progress-error': appState.hasInitError }"
                 :style="{ width: `${(appState.loadingProgress / appState.totalSteps) * 100}%` }">
            </div>
          </div>
        </Transition>
        
        <Transition name="fade">
          <p v-if="!appState.hasInitError" class="loading-percent">
            {{ Math.round((appState.loadingProgress / appState.totalSteps) * 100) }}%
          </p>
        </Transition>
        
        <Transition name="button-bounce">
          <button v-if="appState.hasInitError" @click="reloadPage" class="retry-button">
            Retry
          </button>
        </Transition>
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

.error-icon-wrapper {
  position: relative;
}

.error-icon {
  font-size: 4rem;
  color: #ef4444;
  animation: error-shake 0.5s ease-in-out, error-pulse 2s ease-in-out infinite;
  display: inline-block;
}

@keyframes error-shake {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  25% { transform: translateX(-10px) rotate(-5deg); }
  75% { transform: translateX(10px) rotate(5deg); }
}

@keyframes error-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.9; }
}

.loading-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #fafafa;
  margin: 0;
  transition: color 0.5s ease;
}

.error-title {
  color: #ef4444;
  animation: title-glow 1.5s ease-in-out;
}

@keyframes title-glow {
  0% { text-shadow: 0 0 0 transparent; }
  50% { text-shadow: 0 0 20px rgba(239, 68, 68, 0.5); }
  100% { text-shadow: 0 0 0 transparent; }
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
  transition: background 0.5s ease;
}

.loading-bar-error {
  background: rgba(239, 68, 68, 0.2);
}

.loading-progress {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #818cf8);
  transition: width 0.3s ease, background 0.5s ease;
  border-radius: 2px;
}

.loading-progress-error {
  background: linear-gradient(90deg, #ef4444, #f87171);
  animation: progress-error-flash 0.5s ease-in-out;
}

@keyframes progress-error-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.loading-percent {
  font-size: 0.75rem;
  color: #71717a;
  margin: 0;
  font-weight: 500;
}

.error-icon {
  font-size: 4rem;
  color: #ef4444;
}

.error-title {
  color: #ef4444;
}

.error-message {
  font-size: 0.875rem;
  color: #fca5a5;
  margin: 0;
  text-align: center;
  max-width: 400px;
  line-height: 1.5;
}

.retry-button {
  margin-top: 1rem;
  padding: 0.75rem 2rem;
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.retry-button:hover {
  background: #818cf8;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
}

.retry-button:active {
  background: #4f46e5;
  transform: translateY(0);
}

.retry-icon {
  font-size: 1.2rem;
  display: inline-block;
  animation: rotate-icon 1s ease-in-out infinite;
}

@keyframes rotate-icon {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(180deg); }
}

/* Transition animations */
.spinner-fade-enter-active,
.spinner-fade-leave-active {
  transition: all 0.5s ease;
}

.spinner-fade-enter-from {
  opacity: 0;
  transform: scale(0.5) rotate(-180deg);
}

.spinner-fade-leave-to {
  opacity: 0;
  transform: scale(1.5) rotate(180deg);
}

.title-fade-enter-active,
.title-fade-leave-active {
  transition: all 0.4s ease;
}

.title-fade-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

.title-fade-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.bar-fade-leave-active {
  transition: all 0.5s ease;
}

.bar-fade-leave-to {
  opacity: 0;
  transform: scaleY(0);
}

.button-bounce-enter-active {
  animation: bounce-in 0.6s ease;
}

@keyframes bounce-in {
  0% {
    opacity: 0;
    transform: scale(0.3) translateY(50px);
  }
  50% {
    transform: scale(1.05) translateY(-10px);
  }
  70% {
    transform: scale(0.95) translateY(5px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
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
