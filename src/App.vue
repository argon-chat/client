<script setup lang="ts">
import { Toaster } from "@argon/ui/toast";
import NativeOverlays from "@/components/overlays/NativeOverlays.vue";
import { isSk } from "@/lib/sk";
import { useColorMode, useEventListener } from "@vueuse/core";
import { ref, watch, onMounted, computed } from "vue";
import Island from "./components/shared/Island.vue";
import { useSleepWatcher } from "./composables/useSleepWatcher";
import { useTabLifecycle } from "./composables/useTabLifecycle";
import { isWeb } from "@/lib/platform";
import { openDevtools } from "@/lib/shell/desktop";
import IncomingCallOverlay from "./components/calls/IncomingCallOverlay.vue";
import DiagnosticsOverlay from "./components/overlays/DiagnosticsOverlay.vue";
import { useAppLogger } from "./composables/useAppLogger";
import LoadingOverlay from "./components/overlays/LoadingOverlay.vue";
import ErrorBoundary from "./components/shared/ErrorBoundary.vue";
import ReconnectOverlay from "./components/overlays/ReconnectOverlay.vue";
import DvdBounce from "./components/overlays/DvdBounce.vue";
import GamePicker from "./components/playframe/GamePicker.vue";
import PlayFrameOverlay from "./components/playframe/PlayFrameOverlay.vue";
import BotInteractionModal from "./components/modals/BotInteractionModal.vue";
import AudioDeviceErrorModal from "./components/modals/AudioDeviceErrorModal.vue";
import CallSystemErrorModal from "./components/modals/CallSystemErrorModal.vue";
import LegalUpdateGate from "./components/modals/LegalUpdateGate.vue";
import InvitePreviewModal from "./components/modals/InvitePreviewModal.vue";
import { initDeepLinks } from "@/lib/deeplink";
import { initPowerSaver } from "@/lib/powerSaver";
import { initDecorativeMotion } from "@/lib/decorativeMotion";
import { useTheme } from "@/composables/useTheme";
import { useOverlayPublisher } from "@/composables/useOverlayPublisher";
import { useOverlayChatPublisher } from "@/composables/useOverlayChatPublisher";
import { useOverlayNotificationsPublisher } from "@/composables/useOverlayNotificationsPublisher";
import { logger } from "@argon/core";
import { useSystemStore } from "./store";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { useLocale } from "@/store/system/localeStore";
import { initHotkeyActions } from "@/lib/hotkeys/actions";
import { initWebRadioKey } from "@/lib/hotkeys/webRadioKey";
import { createStoreResolver, provideExpressionResolver } from "@/lib/expressions/resolver";

const { t } = useLocale();
provideExpressionResolver(createStoreResolver());
const sys = useSystemStore();
const call = useUnifiedCall();
const showDiagnostics = ref(false);
const recentErrors = useAppLogger();

const mode = useColorMode();
const { applyAppearanceSettings, currentTheme } = useTheme();

// Stream voice-channel state + chat peek + toasts to the native in-game overlay
// (native desktop only).
useOverlayPublisher();
useOverlayChatPublisher();
useOverlayNotificationsPublisher();



// Waking up, on each platform's terms. The desktop app comes back from machine sleep into a window
// it fully controls and can afford to reload; a tab cannot — the user switched back to it and would
// lose their scroll position and half-typed message over what is usually a one-second repair.
if (isWeb) useTabLifecycle();
else
  useSleepWatcher(async () => {
    logger.error("THROW WAKE RELOAD");
    location.reload();
  });

mode.value = "dark";

// Apply all appearance settings on app start
onMounted(() => {
  applyAppearanceSettings();
  // A low battery or a running game takes the animations down; see lib/powerSaver.ts.
  initPowerSaver();
  // So does a window nobody is looking at, for the looping cosmetics; see lib/decorativeMotion.ts.
  initDecorativeMotion();
  initDeepLinks();
  initHotkeyActions();
  // The browser build has no global hotkeys: the radio key is a focused-window key instead.
  initWebRadioKey();
  // If this load followed a renderer crash, rejoin the voice channel we were in.
  void call.maybeRecoverVoiceAfterCrash();
});

useEventListener("keydown", (event: KeyboardEvent) => {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.repeat) return;
  // Skathi can deliver a chord in one event with the modifiers set and no physical key code.
  const key = event.code || event.key;
  if (key === "Digit7" || key === "7" || key === "&" || key === "?") {
    showDiagnostics.value = !showDiagnostics.value;
  } else if (key === "Digit9" || key === "9" || key === "(") {
    openDevtools();
  }
});

const showAudioDeviceError = ref(false);

// Cleared once a microphone attaches (or the call ends), which closes the dialog with it.
watch(() => call.audioDeviceError, (err) => {
  showAudioDeviceError.value = !!err;
});

const showCallSystemError = ref(false);

watch(() => call.connectError, (err) => {
  if (err) showCallSystemError.value = true;
});

</script>

<template>
  <ErrorBoundary>
    <RouterView />
  </ErrorBoundary>
  <NativeOverlays v-if="isSk" />
  <IncomingCallOverlay />
  <DiagnosticsOverlay v-if="showDiagnostics" :errors="recentErrors" />
  <ReconnectOverlay />
  <GamePicker />
  <PlayFrameOverlay />
  <DvdBounce />
  <BotInteractionModal />
  <AudioDeviceErrorModal
    v-model:open="showAudioDeviceError"
    :error-type="call.audioDeviceError?.type ?? null"
  />
  <CallSystemErrorModal
    v-model:open="showCallSystemError"
    :message="call.connectError?.message ?? null"
  />
  <LegalUpdateGate />
  <InvitePreviewModal />
  <Island class="select-none" v-if="sys.isRequestRetrying && !sys.isLongReconnecting" :title="`Reconnecting`" />
  <Island class="select-none" v-if="call.isCpuConstrained && call.isSharing" :title="t('cpu_throttling')">
    <template #icon>
      <span class="i-lucide-cpu text-lg" style="color: wheat;" />
    </template>
  </Island>
  <!-- Autoplay policy silenced (or blanked) the call; the click on this banner is the
       gesture that unblocks it. -->
  <div v-if="call.playbackBlocked" @click="call.unblockPlayback()">
    <Island class="select-none" :title="t(call.audioPlaybackBlocked ? 'audio_blocked_click' : 'video_blocked_click')">
      <template #icon>
        <span class="i-lucide-volume-x text-lg" style="color: wheat;" />
      </template>
    </Island>
  </div>

  <LoadingOverlay />

  <!-- Toaster moved outside NConfigProvider for highest z-index -->
  <Toaster />
</template>

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
