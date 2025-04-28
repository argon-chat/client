<template>
  <div class="app-container flex h-screen gap-4 p-7" style="width: 100svw; height: 100svh;">
    <div class="channel-container flex flex-col justify-between rounded-xl shadow-md w-55 min-w-[230px] max-w-[230px]">
      <ChatList v-pex="'AddReactions'" v-pex-behaviour="'hide'" />
      <ControlBar />
      <UserBar />
    </div>

    <div class="chat-container flex-1 flex-col rounded-xl shadow-md justify-between">
      <ChannelChat :channel-id="''" />
    </div>
    <div v-if="dataPool.selectedServer"
      class="user-list-container rounded-xl p-4 shadow-md w-56 overflow-y-auto scrollbar-thin scrollbar-hide scrollbar-thumb-gray-600 scrollbar-track-gray-800"
      style="background-color: #161616;
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);">
      <h3 class="text-lg text-white mb-4">{{ t("users") }}</h3>
      <ul class="text-gray-400 space-y-2">
        <li v-for="user in dataPool.activeServerUsers.value" :key="user.UserId"
          class="flex items-center space-x-3 hover:text-white">
          <div class="relative" style="width: 40px; height: 45px;">
            <ArgonAvatar :fallback="user.DisplayName" :file-id="user.AvatarFileId!" :user-id="user.UserId" />
            <span :class="me.statusClass(user.status)"
              class="absolute bottom-0 right-0 w-4 h-3 rounded-full border-2 border-gray-800"></span>
          </div>
          <div class="flex flex-col items-start overflow-hidden">
            <span>{{ user.DisplayName }}</span>
            <span class="text-[10px] flex"
              v-if="user.activity">
              {{ t(getTextForActivityKind(user.activity.Kind)) }}
              <marquee direction="left" hspace="3" behavior="alternate" class="font-bold" scrolldelay="300" truespeed="10">
                {{ user.activity.TitleName }}
              </marquee>

            </span>

          </div>

        </li>
      </ul>
    </div>
    <SettingsWindow />
    <ServerSettingsWindow />
    <FloatingMiniVideo :src="'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'" />

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
import ArgonAvatar from '@/components/ArgonAvatar.vue';
import { usePoolStore } from '@/store/poolStore';
import { onMounted } from 'vue';
import { useMe } from '@/store/meStore';
import FloatingMiniVideo from '@/components/FloatingMiniVideo.vue';
import ControlBar from '@/components/ControlBar.vue';
import { useLocale } from '@/store/localeStore';
import { ActivityPresenceKind } from '@/lib/glue/ActivityPresenceKind';

const dataPool = usePoolStore();
const me = useMe();
const { t } = useLocale();

const getTextForActivityKind = (activityKind: ActivityPresenceKind) => {
  switch (activityKind) {
    case "GAME": return "activity_play_in";
    case "SOFTWARE": return "activity_work_in";
    case "STREAMING": return "activity_stream";
    case "LISTEN": return "activity_listen";
    default: return "error";
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