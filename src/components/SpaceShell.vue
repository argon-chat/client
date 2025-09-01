<script setup lang="ts">
import { usePoolStore } from '@/store/poolStore';
import ChannelChat from './ChannelChat.vue';
import LeftSideUserList from './LeftSideUserList.vue';
import SpaceSideShell from './SpaceSideShell.vue';
const dataPool = usePoolStore();
</script>

<template>
    <div class="server-workspace flex flex-1 gap-4">
        <SpaceSideShell />
        <ChannelChat :channel-id="''" class="chat-container flex-1 flex-col rounded-xl shadow-md justify-between" />
        <LeftSideUserList v-if="dataPool.selectedServer" />
    </div>
</template>

<style lang="css" scoped>
.chat-container {
  background-color: #161616f5;
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style>