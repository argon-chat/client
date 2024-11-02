<template>
  <div class="relative min-w-[250px]" style="z-index: 1;">
    <div class="user-bar">
      <div class="user-info">
        <img :src="user.avatar" alt="User Avatar" class="user-avatar" />
        <div class="user-details">
          <span class="user-name">{{ user.name }}</span>
          <span :class="['user-status', user.isOnline ? 'online' : 'offline']">
            {{ user.isOnline ? 'Online' : 'Offline' }}
          </span>
        </div>
      </div>
      <div class="controls">
        <button v-if="server.isConnected" @click="sys.toggleHeadphoneMute" class="active">
          <PhoneOffIcon class="w-5 h-5" />
        </button>
        <button @click="sys.toggleMicrophoneMute" :class="{ active: sys.microphoneMuted }">
          <MicOff v-if="sys.microphoneMuted" class="w-5 h-5" />
          <Mic v-else class="w-5 h-5" />
        </button>
        <button @click="sys.toggleHeadphoneMute" :class="{ active: sys.headphoneMuted }">
          <HeadphoneOff v-if="sys.headphoneMuted" class="w-5 h-5" />
          <Headphones v-else class="w-5 h-5" />
        </button>
        
      </div>
    </div>
    <transition name="slide-up">
      <div
        v-show="server.isConnected"
        class="connection-card absolute transform text-white rounded-t-lg p-3 shadow-2xl flex flex-col items-center z-[-1]"
        style="bottom: 100%; margin-bottom: -5px;"
      >
        <div class="flex items-center space-x-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <Signal class="w-4 h-4 text-green-500" />
              </TooltipTrigger>
              <TooltipContent>
                <p>{{ server.ping }}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span class="font-semibold">{{ server.connectedChannel.name }}</span>
        </div>
        <span class="text-xs text-gray-400 mt-1">Connected</span>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useSystemStore } from "@/store/systemStore";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Mic, MicOff, HeadphoneOff, Headphones, Signal, PhoneOffIcon } from 'lucide-vue-next';
import { useServerStore } from "@/store/serverStore";
const sys = useSystemStore();
const server = useServerStore();
const user = ref({
  name: 'Yuuki Wesp',
  avatar: 'https://avatars.githubusercontent.com/u/13326808?v=4',
  isOnline: true,
});
onMounted(() => {
  setInterval(() => {
    server.isConnected = !server.isConnected;
  }, 2000);
})

</script>

<style scoped>
.user-bar {
  background-color: #2f3136;
  border-radius: 15px;
  padding: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  position: relative;
}

.user-info {
  display: flex;
  align-items: center;
}

.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  margin-right: 10px;
}

.user-details {
  display: flex;
  flex-direction: column;
}

.user-name {
  font-size: 14px;
  color: #fff;
}

.user-status {
  font-size: 12px;
  color: #bbb;
}

.online {
  color: #43b581;
}

.offline {
  color: #f04747;
}

.controls button {
  background: none;
  border: none;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  margin-left: 5px;
  transition: color 0.3s;
  margin: 5px;
}

.controls {
  justify-content: center;
  display: flex;
}

.controls button:hover {
  color: #5865f2;
}

.controls button.active {
  color: #f04747;
}

.connection-card {
  background-color: #414242;
  text-align: center;
  margin-bottom: -5px;
  left: 50%;
  bottom: 100%;
  transform: translateX(-50%);
  width: calc(100% - 50px);
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.5s ease, opacity 0.5s ease;
  will-change: transform;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translate(-50%, 100%);
  opacity: 0;
}

.slide-up-enter-to {
  transform: translate(-50%, 0%);
  opacity: 1;
}
</style>
