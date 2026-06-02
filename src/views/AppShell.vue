<template>
  <div class="app-container flex flex-col" style="width: 100svw; height: 100svh;">
    <AppTitlebar v-if="showTitlebar" @home="onHome" @feedback="feedbackOpened = true" />

    <div class="shell-content relative flex flex-1 min-h-0">
      <RouterView />
    </div>

    <SendUserFeedback v-model:open="feedbackOpened" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, provide, ref } from "vue";
import AppTitlebar from "@/components/AppTitlebar.vue";
import SendUserFeedback from "@/components/modals/SendUserFeedback.vue";
import { usePoolStore } from "@/store/data/poolStore";
import { useAppState } from "@/store/system/appState";
import router from "@/router";

const pool = usePoolStore();
const appState = useAppState();
const feedbackOpened = ref(false);

// Shell mounts once at app start — boot the app here (replaces the old Entry view).
onMounted(() => {
  appState.initApp();
});

// Unified titlebar — present on every view in the shell, gated only by the host flag.
const showTitlebar = computed(() => (window as any).devolution_titlebar === 0x1);

// Children read this to pad their content for the OS titlebar overlay area.
provide("titlebarVisible", showTitlebar);

function onHome() {
  pool.selectedServer = null;
  router.push({ name: "HomeShellView" });
}
</script>

<style scoped>
.app-container {
  background-color: #202225;
}
</style>
