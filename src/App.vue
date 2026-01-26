<script setup lang="ts">
import { Toaster } from "@argon/ui/toast";
import { useColorMode, useMagicKeys } from "@vueuse/core";
import { useSystemStore } from "./store/systemStore";
import { ref, watch, onMounted } from "vue";
import Island from "./components/shared/Island.vue";
import { NConfigProvider, darkTheme } from 'naive-ui'
import { useSleepWatcher } from "./composables/useSleepWatcher";
import { native } from "@argon/glue/native";
import { useAppState } from "./store/appState";
import IncomingCallOverlay from "./components/calls/IncomingCallOverlay.vue";
import DiagnosticsOverlay from "./components/DiagnosticsOverlay.vue";
import ReconnectOverlay from "./components/ReconnectOverlay.vue";
import { useTheme } from "@/composables/useTheme";
import { logger } from "@argon/core";

const sys = useSystemStore();
const appState = useAppState();
const keys = useMagicKeys();
const showDiagnostics = ref(false);

const mode = useColorMode();
const { applyAppearanceSettings, currentTheme } = useTheme();

const wakeWatcher = useSleepWatcher(async () => {
  logger.error("THROW WAKE RELOAD");
  location.reload();
});

mode.value = "dark";

// Apply all appearance settings on app start
onMounted(() => {
  applyAppearanceSettings();
});

const shiftCtrlA = keys["Shift+Ctrl+Digit9"];
const altShift7 = keys["Shift+Ctrl+Digit7"];

watch(shiftCtrlA, (_) => {
  native.hostProc.toggleDevTools();
});

watch(altShift7, (v) => {

  if (v) {
    logger.info("Toggling diagnostics overlay:", v);
    showDiagnostics.value = !showDiagnostics.value;
  }
});


const reloadPage = () => {
  location.reload();
};

</script>

<template>
  <RouterView />
  <IncomingCallOverlay />
  <DiagnosticsOverlay v-if="showDiagnostics" />
  <ReconnectOverlay />
  <Island class="select-none" v-if="sys.isRequestRetrying && !sys.isLongReconnecting" :title="`Reconnecting`" />

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
          <div class="loading-progress" :class="{ 'loading-progress-error': appState.hasInitError }"
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

  <!-- Toaster moved outside NConfigProvider for highest z-index -->
  <Toaster />
</template>
<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
</style>

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
  to {
    transform: rotate(360deg);
  }
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

  0%,
  100% {
    transform: translateX(0) rotate(0deg);
  }

  25% {
    transform: translateX(-10px) rotate(-5deg);
  }

  75% {
    transform: translateX(10px) rotate(5deg);
  }
}

@keyframes error-pulse {

  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }

  50% {
    transform: scale(1.05);
    opacity: 0.9;
  }
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
  0% {
    text-shadow: 0 0 0 transparent;
  }

  50% {
    text-shadow: 0 0 20px rgba(239, 68, 68, 0.5);
  }

  100% {
    text-shadow: 0 0 0 transparent;
  }
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

  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.5;
  }
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

  0%,
  100% {
    transform: rotate(0deg);
  }

  50% {
    transform: rotate(180deg);
  }
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
</style>
