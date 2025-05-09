<template>
  <div class="app-container flex h-screen gap-4 p-7" style="width: 100svw; height: 100svh;">
    <div class="channel-container flex flex-col justify-between rounded-xl shadow-md w-55 min-w-[230px] max-w-[230px]">
      <ChatList />
      <ControlBar />
      <UserBar />
    </div>

    <div class="chat-container flex-1 flex-col rounded-xl shadow-md justify-between">
      <ChannelChat :channel-id="''" />
    </div>
    
    <SettingsWindow />
    <ServerSettingsWindow />
    <FloatingMiniVideo :src="'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'" />
    <LeftSideUserList v-if="dataPool.selectedServer"/>
    <div class="overlay select-none" style="z-index: 99999;" v-if="!me.WelcomeCommanderHasReceived">
      {{ t('wait_connect') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import UserBar from '@/components/UserBar.vue';
import ChatList from '@/components/ChatList.vue';
import ChannelChat from '@/components/ChannelChat.vue';
import SettingsWindow from '@/components/SettingsWindow.vue';
import ServerSettingsWindow from '@/components/ServerSettingsWindow.vue';
import { usePoolStore } from '@/store/poolStore';
import { onMounted } from 'vue';
import { useMe } from '@/store/meStore';
import FloatingMiniVideo from '@/components/FloatingMiniVideo.vue';
import ControlBar from '@/components/ControlBar.vue';
import { useLocale } from '@/store/localeStore';
import LeftSideUserList from '@/components/LeftSideUserList.vue';

const dataPool = usePoolStore();
const me = useMe();
const { t } = useLocale();


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