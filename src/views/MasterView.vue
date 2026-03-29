<template>
  <div class="app-container flex flex-col h-screen" style="width: 100svw; height: 100svh;">
    <AppTitlebar v-if="showDevolutionTitlebar" @home="selectHome" @feedback="feedbackOpened = true" />
    <div class="flex flex-1 gap-4 min-h-0 pb-4 pr-4 pl-4" :class="showDevolutionTitlebar ? 'pt-2' : 'pt-7'">
    <ServerSelector :selected-space="dataPool.selectedServer" @select="selectServer"
      :spaces="spaces" />

    <RouterView v-slot="{ Component, route }">
      <Transition name="shell-switch" mode="out-in">
        <component :is="Component" :key="getTransitionKey(route)" />
      </Transition>
    </RouterView>

    <SettingsWindow />
    <ServerSettingsWindow />
    <SendUserFeedback v-model:open="feedbackOpened" />
    </div>
  </div>
</template>

<script setup lang="ts">
import SettingsWindow from "@/components/SettingsWindow.vue";
import ServerSettingsWindow from "@/components/ServerSettingsWindow.vue";
import SendUserFeedback from "@/components/modals/SendUserFeedback.vue";
import { usePoolStore } from "@/store/poolStore";
import ServerSelector from "@/components/ServerSelector.vue";
import AppTitlebar from "@/components/AppTitlebar.vue";
import { Guid } from "@argon-chat/ion.webcore";
import router from "@/router";
import { computed, ref } from "vue";

const showDevolutionTitlebar = computed(() => (window as any).devolution_titlebar === 0x1);
const feedbackOpened = ref(false);

function getTransitionKey(route: any): string {
  const name = route.matched[1]?.name;
  if (name === 'SpaceShellView' || name === 'SpaceChannel') {
    return `space-${route.params.id}`;
  }
  return name ?? route.path;
}

const dataPool = usePoolStore();

const spaces = dataPool.useAllServers();

function selectServer(id: Guid) {
  const current = router.currentRoute.value;
  if (String(current.params.id) === String(id)) return;
  router.push({ name: "SpaceShellView", params: { id } });
}

function selectHome() {
  dataPool.selectedServer = null;
  router.push({ name: "HomeShellView" });
}

</script>

<style scoped>
html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  background-color: #202225;
}

/* Shell switch transition */
.shell-switch-enter-active,
.shell-switch-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.shell-switch-enter-from {
  opacity: 0;
  transform: translateX(8px);
}

.shell-switch-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

@keyframes marquee {
  from {
    transform: translateX(0%);
  }

  to {
    transform: translateX(10%);
  }
}

.marquee {
  animation: marquee 5s linear infinite;
}

.overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  z-index: 1000;
}


.settings-content::-webkit-scrollbar {
  width: 8px !important;
}

.settings-content::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.settings-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  transition: background 0.2s;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
}
</style>