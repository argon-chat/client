<template>
  <GlowBorder
    class="relative flex w-full flex-col items-center justify-center overflow-hidden rounded-lg border md:shadow-xl"
    style="width: 100vw; height: 100vh;" :color="['#A07CFE', '#FE8FB5', '#FFBE7B']">
    <div class="app-container flex h-screen gap-4 p-7" style="width: 100%; height: 100%;">

      <div class="channel-container flex flex-col justify-between rounded-xl shadow-md w-55 min-w-[230px] max-w-[230px]">
        <ChatList v-pex="'AddReactions'" v-pex-behaviour="'hide'" />
        <ControlBar />
        <UserBar />
      </div>

      <div class="chat-container flex-1 flex-col rounded-xl p-5 shadow-md justify-between">
        <ChannelChat v-if="false" />
      </div>
      <div v-if="dataPool.selectedServer"
        class="user-list-container rounded-xl p-4 shadow-md w-56 overflow-y-auto scrollbar-thin scrollbar-hide scrollbar-thumb-gray-600 scrollbar-track-gray-800"
        style="background-color: #161616;
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
      <FloatingMiniVideo :src="'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'" />

      <div class="top-container  flex-col rounded-xl p-2 shadow-md justify-between">
        <div class="sys-keyholder">
          <MinusIcon height="16" width="16" class="close-icon" @click="pressSystemKey(1)" />
          <XIcon height="16" width="16" class="close-icon" @click="closeWindow" />
        </div>
      </div>

      <div class="topbar-collider" @mousedown="beginMove" @mouseup="endMove" />

      <div class="overlay select-none" style="z-index: 99999;" v-if="!me.WelcomeCommanderHasReceived">
        {{ t('wait_connect') }}
      </div>
    </div>

  </GlowBorder>

</template>

<script setup lang="ts">
import UserBar from '@/components/UserBar.vue';
import ChatList from '@/components/ChatList.vue';
import ChannelChat from '@/components/ChannelChat.vue';
import SettingsWindow from '@/components/SettingsWindow.vue';
import ServerSettingsWindow from '@/components/ServerSettingsWindow.vue';
import ArgonAvatar from '@/components/ArgonAvatar.vue';
import { usePoolStore } from '@/store/poolStore';
import { UserStatus } from '@/lib/glue/UserStatus';
import { onMounted } from 'vue';
import { useMe } from '@/store/meStore';
import FloatingMiniVideo from '@/components/FloatingMiniVideo.vue';
import ControlBar from '@/components/ControlBar.vue';
import GlowBorder from '@/components/GlowBorder.vue';
import { useLocale } from '@/store/localeStore';
import {
  MinusIcon,
  XIcon
} from 'lucide-vue-next';
import { usePreference } from '@/store/preferenceStore';

const dataPool = usePoolStore();
const me = useMe();
const { t } = useLocale();
const preferences = usePreference();

const beginMove = () => {
  native.beginMoveWindow();
}

const pressSystemKey = (key: number) => {
  native.pressSystemKey(key);
}

const endMove = () => {
  native.endMoveWindow();
}
const statusClass = (status: UserStatus) => {
  return {
    'bg-green-500': status === 'Online',
    'bg-yellow-500': status === 'Away',
    'bg-gray-500': status === 'Offline'
  };
};

const closeWindow = () => {
  if (preferences.minimizeToTrayOnClose) {
    pressSystemKey(2);
  } else {
    pressSystemKey(0);
  }
}

onMounted(async () => {
  const s = await dataPool.allServerAsync;
  dataPool.selectedServer = s[0].Id;
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
  background-color: #161616;
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.top-container {
  position: absolute;
  right: 0;
  top: 0;
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

.close-icon {
  color: #686868;
}

.close-icon:hover {
  color: #bebebe;
  cursor: pointer;
}

.close-icon:active {
  color: #0f9ed6;
  cursor: pointer;
}

.topbar-collider {
  position: absolute;
  top: 0;
  left: 0;
  width: calc(100% - 60px);
  height: 25px;
}

.sys-keyholder {
  justify-content: center;
  display: flex;
  gap: 10px;
  flex: auto;
}


.settings-content::-webkit-scrollbar {
  width: 8px !important; /* Ширина скроллбара */
}

.settings-content::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1); /* Темный фон */
  border-radius: 10px;
}

.settings-content::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1); /* Цвет ползунка */
  border-radius: 10px;
  transition: background 0.2s;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: #6b7280; /* Светлее при наведении */
}
</style>