<script setup lang="ts">
import { usePoolStore } from '@/store/poolStore';
import ChannelChat from './ChannelChat.vue';
import LeftSideUserList from './LeftSideUserList.vue';
import SpaceSideShell from './SpaceSideShell.vue';

const model = defineModel<string | null>('selectedSpace', {
    type: String, required: false
})

</script>

<template>
    <div class="server-workspace flex flex-1 gap-4" v-if="model">
        <SpaceSideShell :selected-space="model" />
        <ChannelChat :channel-id="''" :selected-space="model" class="chat-container flex-1 flex-col rounded-xl shadow-md justify-between" />
        <LeftSideUserList :selected-space="model"/>
    </div>
</template>

<style lang="css" scoped>
.chat-container {
  background-color: #161616f5;
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style>