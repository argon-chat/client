<script setup lang="ts">
import AdminControlBar from './AdminControlBar.vue';
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
    <div class="channel-container flex flex-col justify-between rounded-xl space-y-3 w-55 min-w-60">
        <SidebarHeader v-model:selected-space="selectedSpaceId" />
        <AdminControlBar v-model:selected-space="selectedSpaceId"/>
        <ChatList v-model:selected-space="selectedSpaceId" v-model:selected-channel-id="selectedChannelId"/>
        <ControlBar />
        <UserBar/>
    </div>
</template>