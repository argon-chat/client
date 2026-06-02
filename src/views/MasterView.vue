<template>
  <div class="master-shell flex flex-1 gap-4 min-h-0 pb-4 pr-4 pl-4" :class="titlebarVisible ? 'pt-2' : 'pt-7'">
    <ServerSelector :selected-space="dataPool.selectedServer" @select="selectServer" @home="selectHome"
      :spaces="spaces" />

    <RouterView v-slot="{ Component, route }">
      <RouteTransition>
        <component :is="Component" :key="getTransitionKey(route)" />
      </RouteTransition>
    </RouterView>

    <SettingsWindow />
    <ServerSettingsWindow />
  </div>
</template>

<script setup lang="ts">
import SettingsWindow from "@/components/SettingsWindow.vue";
import ServerSettingsWindow from "@/components/ServerSettingsWindow.vue";
import RouteTransition from "@/components/shared/RouteTransition.vue";
import { usePoolStore } from "@/store/data/poolStore";
import ServerSelector from "@/components/ServerSelector.vue";
import { Guid } from "@argon-chat/ion.webcore";
import router from "@/router";
import { computed, inject, type ComputedRef } from "vue";

// Provided by AppShell; controls top padding for the OS titlebar overlay area.
const titlebarVisible = inject<ComputedRef<boolean>>("titlebarVisible", computed(() => false));

function getTransitionKey(route: any): string {
  // matched: [AppShell, MasterView, <shell child>, ...] -> index 2 is the shell-level view.
  const name = route.matched[2]?.name;
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