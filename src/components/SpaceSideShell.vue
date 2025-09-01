<script setup lang="ts">
import AdminControlBar from './AdminControlBar.vue';
import ChatList from './ChatList.vue';
import ControlBar from './ControlBar.vue';
import SidebarHeader from './SidebarHeader.vue';
import UserBar from './UserBar.vue';

</script>

<template>
    <div class="channel-container flex flex-col justify-between rounded-xl space-y-3 w-55 min-w-60">
        <SidebarHeader />
        <AdminControlBar />
        <ChatList />
        <ControlBar/>
        <UserBar/>
    </div>
</template>