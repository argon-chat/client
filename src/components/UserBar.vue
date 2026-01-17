<template>
  <div class="user-bar" v-if="me.me">
    <div class="user-info" style="width: 150px;">
      <ArgonAvatar class="user-avatar" :fallback="me.me.displayName" :file-id="me.me?.avatarFileId"
        :user-id="me.me.userId" />
      <div class="user-details items-start">
        <span class="user-name">{{ me.me?.displayName }}</span>
        <span :class="['user-status', me.statusClass(me.me!.currentStatus, false)]">
          {{ t(`status_${me.me?.currentStatus}`) }}
        </span>
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
</template>

<script setup lang="ts">
import { useMe } from "@/store/meStore";
import ArgonAvatar from "./ArgonAvatar.vue";
import { useWindow } from "@/store/windowStore";
import { Settings } from "lucide-vue-next";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
const windows = useWindow();
const me = useMe();
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
  background-color: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.5);
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
  display: block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;

  mask-image: linear-gradient(to right, black 90%, transparent 100%);
  mask-repeat: no-repeat;
  mask-size: 100% 100%;

  -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%);
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;

  font-size: 14px;
  color: hsl(var(--foreground));
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
  color: hsl(var(--muted-foreground));
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
  color: hsl(var(--foreground));
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
  color: hsl(var(--primary));
}

.controls button.active {
  color: hsl(var(--destructive));
}

.connection-card {
  background-color: hsl(var(--muted));
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
