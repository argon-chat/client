<template>
  <div class="relative min-w-[250px]" style="z-index: 1;" v-if="me.me">
    <div class="user-bar">
      <div class="user-info">
        <ArgonAvatar class="user-avatar"  :fallback="me.me.DisplayName" :file-id="me.me?.AvatarFileId!" :user-id="me.me.Id"/>
        <div class="user-details">
          <span class="user-name">{{ me.me?.DisplayName }}</span>
          <span :class="['user-status', me.me?.currentStatus.toLowerCase()]">
            {{ me.me?.currentStatus }}
          </span>
        </div>
      </div>
      <div class="controls">
        <button v-if="server.isConnected" @click="server.disconnect()" class="active">
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
    <div>
      <div v-show="server.isConnected || server.isBeginConnect" v-motion-slide-visible-bottom
        class="connection-card absolute text-white rounded-t-lg p-3 shadow-2xl flex flex-col items-center z-[-1]"
        style="bottom: 100%; margin-bottom: -5px;">
        <div class="flex items-center space-x-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <Signal class="w-4 h-4 text-green-500" />
              </TooltipTrigger>
              <TooltipContent>
                <p v-if="server.isConnected">{{ server.ping }}</p>
                <p v-if="server.isBeginConnect">??? ms</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span class="font-semibold">{{ server.connectedChannel?.Name }}</span>
        </div>
        <span class="text-xs text-lime-400 mt-1" v-if="server.isConnected">Connected</span>
        <span class="text-xs text-orange-400 mt-1" v-if="server.isBeginConnect">Connecting...</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Mic, MicOff, HeadphoneOff, Headphones, Signal, PhoneOffIcon } from 'lucide-vue-next';


import { useMe } from "@/store/meStore";
import { useSystemStore } from "@/store/systemStore";
import { useServerStore } from "@/store/serverStore";
import ArgonAvatar from "./ArgonAvatar.vue";

const me = useMe();
const sys = useSystemStore();
const server = useServerStore();
</script>

<style scoped>
.audio-visualizer {
  z-index: 3;
  display: block;
  width: 200px !important;
  height: 59px !important;
  margin-left: -20px !important;

}

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
  width: 38px;
  height: 38px;
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

.away {
  color: #276e9e;
}

.ingame {
  color: #279e3b;
}
.offline {
  color: #635d5d;
}
.donotdisturb {
  color: #f04747;
}
.listen {
  color: #279e3b;
}
.touchgrass {
  color: #90279e;
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
  left: 10%;
  bottom: 100%;
  width: calc(100% - 50px);
}
</style>
