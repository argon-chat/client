<script setup lang="ts">
import AdminControlBar from './AdminControlBar.vue';
import ChatList from './ChatList.vue';
import ControlBar from './ControlBar.vue';
import SidebarHeader from './SidebarHeader.vue';
import UserBar from './UserBar.vue';


const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
})


</script>

<template>
    <div class="channel-container flex flex-col justify-between rounded-xl space-y-3 w-55 min-w-60">
        <SidebarHeader :selected-space="selectedSpaceId" />
        <AdminControlBar :selected-space="selectedSpaceId"/>
        <ChatList :selected-space="selectedSpaceId"/>
        <ControlBar />
        <UserBar/>
    </div>
</template>