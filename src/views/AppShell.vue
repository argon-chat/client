<template>
  <div class="app-container relative flex flex-col" style="width: 100svw; height: 100svh;">
    <AppTitlebar v-if="showTitlebar" @home="onHome" @feedback="feedbackOpened = true" />

    <div class="shell-content relative flex flex-1 min-h-0">
      <RouterView v-slot="{ Component }">
        <Transition name="shell-view" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
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

// Unified titlebar — present on every view in the shell, gated only by the host flag.
const showTitlebar = computed(() => window.devolution_titlebar === 0x1);

// Shell mounts once at app start — boot the app here (replaces the old Entry view).
onMounted(() => {
  appState.initApp();
  // Expose the titlebar height (0 when absent) so modals can keep clear of the
  // window controls. The titlebar is 38px tall — see AppTitlebar.vue.
  document.documentElement.style.setProperty(
    "--app-titlebar-height",
    showTitlebar.value ? "38px" : "0px"
  );
});

// Children read this to pad their content for the OS titlebar overlay area.
provide("titlebarVisible", showTitlebar);

function onHome() {
  pool.selectedServer = null;
  router.push({ name: "HomeShellView" });
}
</script>

<!--
  Shell-level view transition (Login ↔ Master ↔ Lockdown). NOT scoped: the
  classes are applied to the route component's root, which lives outside this
  component's scope. Gives the "materialize into the app" feel post-login.
  Auto-neutralized under prefers-reduced-motion by the global stylesheet.
-->
<style>
.shell-view-enter-active {
  transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    filter 0.35s ease;
}
.shell-view-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease, filter 0.2s ease;
}
.shell-view-enter-from {
  opacity: 0;
  transform: scale(0.985);
  filter: blur(6px);
}
.shell-view-leave-to {
  opacity: 0;
  transform: scale(1.012);
  filter: blur(3px);
}
</style>
