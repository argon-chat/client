<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, watch } from "vue";
import { SkWindow } from "@/lib/sk/skWindow";
import { isSk } from "@/lib/sk";
import { shell, type ActivityWindow } from "@/lib/shell/host";
import { drawingTarget, hudVoice, hudConfig, targetBounds, stopNativeDrawing } from "@/lib/shell/overlays";
import { useGameOverlaySettings, normalizeGameId } from "@/store/features/gameOverlaySettingsStore";
import NativeGameHud from "./NativeGameHud.vue";
import ScreencastDrawWindow from "@/components/screencast-overlay/ScreencastDrawWindow.vue";

const settings = useGameOverlaySettings();
const game = shallowRef<ActivityWindow | null>(null);
const off: (() => void)[] = [];
const visible = computed(() => {
  if (!game.value?.foreground || !hudVoice.value.inVoice || !settings.overlayEnabled) return false;
  const activity = shell.activity.list().find((item) => item.pid === game.value?.pid);
  const id = activity ? normalizeGameId(activity.path, activity.name) : "";
  return !id || settings.games[id]?.overlayEnabled !== false;
});
watch(() => settings.snapshot().hud, (config) => { hudConfig.value = config; }, { immediate: true, deep: true });

onMounted(() => {
  if (!isSk || !SkWindow || !shell?.activity) return;
  game.value = shell.activity.window();
  off.push(shell.activity.onWindowChanged((value) => { game.value = value; }));
});
onUnmounted(() => { for (const dispose of off) dispose(); stopNativeDrawing(); });
</script>

<template>
  <!-- Unfocusable windows are already hidden from the shell. Keep them unowned so hiding Argon does not hide its overlays. -->
  <component v-if="isSk && SkWindow && visible" :is="SkWindow"
    title="Argon voice overlay" chrome="hidden" backdrop="transparent" cover="monitor"
    :monitor="game!.monitorIndex" :always-on-top="true" :focusable="false"
    :ignore-mouse-events="true" :taskbar="true" :activate="false" :resizable="false" :title-bar-height="0">
    <NativeGameHud />
  </component>
  <component v-if="isSk && SkWindow && drawingTarget" :is="SkWindow"
    title="Argon stream drawing" chrome="hidden" backdrop="transparent"
    :bounds="targetBounds(drawingTarget)" :always-on-top="true" :focusable="false"
    :ignore-mouse-events="true" :content-protection="true" :taskbar="true" :activate="false"
    :resizable="false" :title-bar-height="0">
    <ScreencastDrawWindow :surface-width="drawingTarget.w" :surface-height="drawingTarget.h" />
  </component>
</template>
