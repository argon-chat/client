<script setup lang="ts">
import { Toaster } from "@argon/ui/toast";
import { useColorMode, useMagicKeys } from "@vueuse/core";
import { ref, watch, onMounted, computed } from "vue";
import Island from "./components/shared/Island.vue";
import { useSleepWatcher } from "./composables/useSleepWatcher";
import { native } from "@argon/glue/native";
import IncomingCallOverlay from "./components/calls/IncomingCallOverlay.vue";
import DiagnosticsOverlay from "./components/overlays/DiagnosticsOverlay.vue";
import LoadingOverlay from "./components/overlays/LoadingOverlay.vue";
import ErrorBoundary from "./components/shared/ErrorBoundary.vue";
import ReconnectOverlay from "./components/overlays/ReconnectOverlay.vue";
import DvdBounce from "./components/overlays/DvdBounce.vue";
import GamePicker from "./components/playframe/GamePicker.vue";
import PlayFrameOverlay from "./components/playframe/PlayFrameOverlay.vue";
import BotInteractionModal from "./components/modals/BotInteractionModal.vue";
import AudioDeviceErrorModal from "./components/modals/AudioDeviceErrorModal.vue";
import { useTheme } from "@/composables/useTheme";
import { useOverlayPublisher } from "@/composables/useOverlayPublisher";
import { logger } from "@argon/core";
import { useSystemStore } from "./store";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();
const sys = useSystemStore();
const call = useUnifiedCall();
const keys = useMagicKeys();
const showDiagnostics = ref(false);

const mode = useColorMode();
const { applyAppearanceSettings, currentTheme } = useTheme();

// Stream voice-channel state to the native in-game overlay (Electron only; no-op otherwise).
useOverlayPublisher();



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
  // @ts-ignore
  native.hostProc.toggleDevTools();
});

watch(altShift7, (v) => {

  if (v) {
    logger.info("Toggling diagnostics overlay:", v);
    showDiagnostics.value = !showDiagnostics.value;
  }
});

const showAudioDeviceError = ref(false);

watch(() => call.audioDeviceError, (err) => {
  if (err) showAudioDeviceError.value = true;
});

</script>

<template>
  <ErrorBoundary>
    <RouterView />
  </ErrorBoundary>
  <IncomingCallOverlay />
  <DiagnosticsOverlay v-if="showDiagnostics" />
  <ReconnectOverlay />
  <GamePicker />
  <PlayFrameOverlay />
  <DvdBounce />
  <BotInteractionModal />
  <AudioDeviceErrorModal 
    v-model:open="showAudioDeviceError" 
    :error-type="call.audioDeviceError?.type ?? null" 
  />
  <Island class="select-none" v-if="sys.isRequestRetrying && !sys.isLongReconnecting" :title="`Reconnecting`" />
  <Island class="select-none" v-if="call.isCpuConstrained && call.isSharing" :title="t('cpu_throttling')">
    <template #icon>
      <span class="i-lucide-cpu text-lg" style="color: wheat;" />
    </template>
  </Island>

  <LoadingOverlay />

  <!-- Toaster moved outside NConfigProvider for highest z-index -->
  <Toaster />
</template>
<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
</style>

<style scoped>
/* Window chrome */
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
