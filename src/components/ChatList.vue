<template>
  <div class="chat-list min-w-[250px]">
    <div class="flex flex-col">
      <div class="p-4 border-b border-gray-700 flex justify-between items-center">
        <h2 class="text-lg font-bold">{{ servers.activeServer?.Name }}</h2>
        <button class="text-gray-400 hover:text-white" @click="addChannel">
          <PlusIcon class="w-5 h-5" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto py-4 space-y-2">
        <div v-if="servers.activeServer"
          v-for="channel in servers.activeServer.Channels"
          :key="channel.Id"
          class="px-4 py-2 hover:bg-gray-700 cursor-pointer flex flex-col space-y-2"
        >
          <div class="flex items-center justify-between group" v-on:click="connectToChannel(channel.Id)">
            <div class="flex items-center space-x-2">
              <HashIcon v-if="channel.ChannelType === 'Text'" class="w-5 h-5 text-gray-400" />
              <Volume2Icon v-else-if="channel.ChannelType === 'Voice'" class="w-5 h-5 text-gray-400" />
              <span>{{ channel?.Name }}</span>
            </div>
            <button class="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-white">
              <MoreVerticalIcon class="w-5 h-5" />
            </button>
          </div>

         <ul v-if="channel.ChannelType === 'Voice'" class="ml-7 space-y-1">
            <li
              v-for="user in servers.currentChannelUsers"
              :key="user.Id"
              class="flex items-center text-gray-400 hover:text-white"
            >
              <img :src="user.AvatarFileId" alt="User Avatar" class="w-6 h-6 rounded-full mr-2" />
              <span>{{ user.DisplayName }}</span>
            </li>
          </ul> 
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useServerStore } from '@/store/serverStore';
import { 
  HashIcon, Volume2Icon, PlusIcon, MoreVerticalIcon 
} from 'lucide-vue-next';

const servers = useServerStore();

const addChannel = () => {
  alert('Add new channel');
};

const connectToChannel = (channelId: string) => {
  servers.connectTo(channelId);
};
</script>

<style scoped>
.chat-list {
  background-color: #2f3136;
  padding: 10px;
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  margin-bottom: 10px;
  height: 95%;
}
.hover\:bg-gray-700:hover {
    border-radius: 5px;
}
</style>