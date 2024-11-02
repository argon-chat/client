<template>
  <div class="chat-list min-w-[250px]">
    <div class="flex flex-col">
      <!-- Заголовок сервера и кнопка добавления канала -->
      <div class="p-4 border-b border-gray-700 flex justify-between items-center">
        <h2 class="text-lg font-bold">Я ебал свою мать</h2>
        <button class="text-gray-400 hover:text-white" @click="addChannel">
          <PlusIcon class="w-5 h-5" />
        </button>
      </div>

      <!-- Список каналов -->
      <div class="flex-1 overflow-y-auto py-4 space-y-2">
        <div
          v-for="channel in channels"
          :key="channel.id"
          class="px-4 py-2 hover:bg-gray-700 cursor-pointer flex flex-col space-y-2"
        >
          <div class="flex items-center justify-between group">
            <div class="flex items-center space-x-2">
              <HashIcon v-if="channel.type === 'text'" class="w-5 h-5 text-gray-400" />
              <Volume2Icon v-else-if="channel.type === 'voice'" class="w-5 h-5 text-gray-400" />
              <span>{{ channel.name }}</span>
            </div>
            <button class="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-white">
              <MoreVerticalIcon class="w-5 h-5" />
            </button>
          </div>

          <ul v-if="channel.type === 'voice' && channel.users" class="ml-7 space-y-1">
            <li
              v-for="user in channel.users"
              :key="user.id"
              class="flex items-center text-gray-400 hover:text-white"
            >
              <img :src="user.avatar" alt="User Avatar" class="w-6 h-6 rounded-full mr-2" />
              <span>{{ user.name }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { 
  HashIcon, Volume2Icon, PlusIcon, MoreVerticalIcon 
} from 'lucide-vue-next';

const channels = ref([
  { id: 1, name: 'Ебать ваш хуй', type: 'voice', users: [
      { id: 1, name: 'Свацк сука', avatar: 'https://avatars.githubusercontent.com/u/25629578?v=4' },
      { id: 2, name: 'Yuuki Wesp', avatar: 'https://avatars.githubusercontent.com/u/13326808?v=4' },
    ] 
  }
]);

const addChannel = () => {
  alert('Add new channel');
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