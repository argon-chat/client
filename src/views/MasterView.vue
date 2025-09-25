<template>
  <div class="app-container flex h-screen gap-4 pt-7 pb-7 pr-4 pl-4" style="width: 100svw; height: 100svh;">
    <ServerSelector :selected-space="dataPool.selectedServer" @select="selectServer" @home="selectHome"
      :spaces="spaces" class="shrink-0" />
    <SpaceShell v-show="dataPool.selectedServer" />
    <HomeShell v-show="!dataPool.selectedServer" />
    <SettingsWindow />
    <ServerSettingsWindow />
    <FloatingMiniVideo />
  </div>
</template>

<script setup lang="ts">
import SettingsWindow from "@/components/SettingsWindow.vue";
import ServerSettingsWindow from "@/components/ServerSettingsWindow.vue";
import { usePoolStore } from "@/store/poolStore";
import { onMounted, ref } from "vue";
import FloatingMiniVideo from "@/components/FloatingMiniVideo.vue";
import ServerSelector from "@/components/ServerSelector.vue";
import SpaceShell from "@/components/SpaceShell.vue";
import { ArgonSpaceBase } from "@/lib/glue/argonChat";
import { Guid } from "@argon-chat/ion.webcore";
import HomeShell from "@/components/home/HomeShell.vue";
import { useApi } from "@/store/apiStore";

const dataPool = usePoolStore();
const api = useApi();
const spaces = ref([] as ArgonSpaceBase[]);
onMounted(async () => {
  spaces.value = await dataPool.allServerAsync;
});
function selectServer(id: Guid) {
  console.log("Selected server:", id)
  dataPool.selectedServer = id;
}

function selectHome() {
  dataPool.selectedServer = null;
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
  /* Ширина скроллбара */
}

.settings-content::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
  /* Темный фон */
  border-radius: 10px;
}

.settings-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  /* Цвет ползунка */
  border-radius: 10px;
  transition: background 0.2s;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
  /* Светлее при наведении */
}
</style>