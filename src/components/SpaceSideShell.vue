<script setup lang="ts">
import ChatList from './ChatList.vue';
import ControlBar from './ControlBar.vue';
import SidebarHeader from './SidebarHeader.vue';
import UserBar from './UserBar.vue';


const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
})
const selectedChannelId = defineModel<string>('selectedChannelId', {
    type: String, required: true
})

</script>

<template>
    <div class="channel-container flex flex-col gap-3 w-72 min-w-72">
        <!-- Unified panel: header + channel list, flush (no gap / inner rounding) -->
        <div class="channel-panel flex flex-col flex-1 min-h-0">
            <SidebarHeader v-model:selected-space="selectedSpaceId" />
            <ChatList class="flex-1 min-h-0" v-model:selected-space="selectedSpaceId" v-model:selected-channel-id="selectedChannelId"/>
        </div>
        <ControlBar />
        <UserBar/>
    </div>
</template>

<style scoped>
.channel-panel {
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: 15px;
    overflow: hidden;
}
</style>