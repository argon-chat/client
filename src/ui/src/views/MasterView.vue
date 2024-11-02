<template>
  <div class="app-container flex h-screen gap-4 p-5">
    <Sidebar />
    <div class="channel-container flex flex-col justify-between rounded-xl shadow-md w-55">
      <ChatList v-if="serverStore.serverSelected" />
      <UserBar />
    </div>

    <div class="chat-container flex-1 flex-col rounded-xl p-5 shadow-md justify-between">
      <ChannelChat v-if="serverStore.serverSelected" />
    </div>

    <div v-if="serverStore.serverSelected" class="user-list-container rounded-xl p-4 shadow-md w-56" style="background-color: #2f3136;
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);">
      <h3 class="text-lg text-white mb-4">Users</h3>
      <ul class="text-gray-400 space-y-2">
        <li v-for="user in sortedUsers" :key="user.id" class="flex items-center space-x-3 hover:text-white">
          <div class="relative">
            <img :src="user.avatar" alt="User Avatar" class="w-10 h-10 rounded-full">
            <span :class="statusClass(user.status)"
              class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-800"></span>
          </div>
          <span>{{ user.name }}</span>
        </li>
      </ul>
    </div>
    <SettingsWindow />
  </div>
</template>

<script setup lang="ts">
import Sidebar from '@/components/Sidebar.vue';
import UserBar from '@/components/UserBar.vue';
import ChatList from '@/components/ChatList.vue';
import ChannelChat from '@/components/ChannelChat.vue';
import SettingsWindow from '@/components/SettingsWindow.vue';
import { ref, computed } from 'vue';
import { useServerStore } from '@/store/serverStore';
const serverStore = useServerStore();

const users = ref([
  { id: 1, name: 'Admin 1', role: 'admin', status: 'online', avatar: 'https://avatars.githubusercontent.com/u/13326808?v=4' },
  { id: 2, name: 'User 1', role: 'online', status: 'online', avatar: 'https://avatars.githubusercontent.com/u/13326808?v=4' },
  { id: 3, name: 'User 2', role: 'online', status: 'away', avatar: 'https://avatars.githubusercontent.com/u/13326808?v=4' },
  { id: 4, name: 'User 3', role: 'offline', status: 'offline', avatar: 'https://avatars.githubusercontent.com/u/13326808?v=4' },
  { id: 5, name: 'Admin 2', role: 'admin', status: 'online', avatar: 'https://avatars.githubusercontent.com/u/13326808?v=4' },
  { id: 6, name: 'User 4', role: 'offline', status: 'offline', avatar: 'https://avatars.githubusercontent.com/u/13326808?v=4' }
]);

const sortedUsers = computed(() => {
  return [
    ...users.value.filter(user => user.role === 'admin'),
    ...users.value.filter(user => user.role === 'online'),
    ...users.value.filter(user => user.role === 'offline')
  ];
});

const statusClass = (status) => {
  return {
    'bg-green-500': status === 'online',
    'bg-yellow-500': status === 'away',
    'bg-gray-500': status === 'offline'
  };
};
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
</style>