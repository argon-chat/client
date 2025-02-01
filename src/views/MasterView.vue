<template>
  <div class="app-container flex h-screen gap-4 p-5" :style="usePaddingTop ? 'padding-top: 40px;' : ''">
    <div
      class="top-bar fixed top-0 left-0 right-0 mx-auto w-full h-8 rounded-b-lg shadow-md flex items-center justify-center"
      style="background-color: #2f3136; max-width: 500px;">
      <h1 class="text-lg font-semibold text-white ">Argon <span style="color: orange;">Beta {{ version }}</span></h1>
    </div>
    <Sidebar />
    <div class="channel-container flex flex-col justify-between rounded-xl shadow-md w-55">
      <ChatList v-pex="'AddReactions'" v-pex-behaviour="'hide'" />
      <UserBar />
    </div>

    <div class="chat-container flex-1 flex-col rounded-xl p-5 shadow-md justify-between">
      <ChannelChat />
    </div>

    <div v-if="dataPool.selectedServer" class="user-list-container rounded-xl p-4 shadow-md w-56" style="background-color: #2f3136;
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);">
      <h3 class="text-lg text-white mb-4">Users</h3>
      <ul class="text-gray-400 space-y-2">
        <li v-for="user in dataPool.activeServerUsers.value" :key="user.Id"
          class="flex items-center space-x-3 hover:text-white">
          <div class="relative">
            <ArgonAvatar :fallback="user.DisplayName" :file-id="user.AvatarFileId!" :user-id="user.Id" />
            <span :class="statusClass(user.status)"
              class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-800"></span>
          </div>
          <span>{{ user.DisplayName }}</span>
        </li>
      </ul>
    </div>
    <SettingsWindow />
    <ServerSettingsWindow />

    <div class="overlay" v-if="!me.WelcomeCommanderHasReceived">
      Waiting for connection, please wait...
    </div>
  </div>
</template>

<script setup lang="ts">
import Sidebar from '@/components/Sidebar.vue';
import UserBar from '@/components/UserBar.vue';
import ChatList from '@/components/ChatList.vue';
import ChannelChat from '@/components/ChannelChat.vue';
import SettingsWindow from '@/components/SettingsWindow.vue';
import ServerSettingsWindow from '@/components/ServerSettingsWindow.vue';
import ArgonAvatar from '@/components/ArgonAvatar.vue';
import { usePoolStore } from '@/store/poolStore';
import { UserStatus } from '@/lib/glue/UserStatus';
import { onMounted, ref } from 'vue';
import { useMe } from '@/store/meStore';

const dataPool = usePoolStore();
const version = ref("");
const me = useMe();


const usePaddingTop = ref(false);
const statusClass = (status: UserStatus) => {
  return {
    'bg-green-500': status === 'Online',
    'bg-yellow-500': status === 'Away',
    'bg-gray-500': status === 'Offline'
  };
};

onMounted(async () => {
  if ('argon_host_version' in window) {
    version.value = window["argon_host_version"] as string;
  } else {
    version.value = "[dev]";
  }
  const s = await dataPool.allServerAsync;
  dataPool.selectedServer = s[0].Id;
  usePaddingTop.value = true;
})

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

.chat-container {
  background-color: #2f3136;
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
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
</style>