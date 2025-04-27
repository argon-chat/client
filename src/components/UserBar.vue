<template>
  <div class="relative" style="z-index: 1;" v-if="me.me">
    <div class="user-bar">
      <div class="user-info" style="width: 150px;">
        <ArgonAvatar class="user-avatar" :fallback="me.me.DisplayName" :file-id="me.me?.AvatarFileId!"
          :user-id="me.me.Id" />
        <div class="user-details items-start">
          <span class="user-name">{{ me.me?.DisplayName }}</span>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <span :class="['user-status', me.statusClass(me.me!.currentStatus, false)]">
                {{ me.me?.currentStatus }}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-56">
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup v-model="status">
                <DropdownMenuRadioItem :value="i" v-for="i in availableStatuses" :key="i">
                  {{ i }} <span :class="me.statusClass(i)"
                    class="absolute left-2 w-4 h-4 rounded-full border-2 border-gray-800"></span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div class="control-bar">
        <div class="controls">
          <button @click="windows.settingsOpen = true" style="padding-right: 5px;">
            <Settings class="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMe } from "@/store/meStore";
import ArgonAvatar from "./ArgonAvatar.vue";
import { useWindow } from "@/store/windowStore";
import { Settings } from 'lucide-vue-next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { ref, watch } from "vue";

const windows = useWindow();
const me = useMe();

const status = ref(me.me!.currentStatus);

watch(status, (newStatus) => {
  me.changeStatusTo(newStatus);
})

const availableStatuses = [
  "Online",
  "DoNotDisturb",
]

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
  background-color: #161616;
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
}

.bad {
  color: #f04747;
}

.moderate {
  color: #f0d747
}

.good {
  color: #43b581;
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

@keyframes spinOutline {
  to {
    transform: rotate(360deg);
  }
}

.hover-spin-outline:hover {
  animation: spinOutline 1s linear infinite;
}
</style>
