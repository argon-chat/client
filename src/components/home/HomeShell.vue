<script setup lang="ts">
import { usePoolStore } from '@/store/poolStore';
import HomeSideShell from './HomeSideShell.vue';
import { ref } from 'vue';
import ChannelChat from '../ChannelChat.vue';
import ProfileShell from './views/ProfileShell.vue';
import FriendsShell from './views/FriendsShell.vue';
import InventoryShell from './views/InventoryShell.vue';
import NotificationShell from './views/NotificationShell.vue';
const dataPool = usePoolStore();
const currentTab = ref("profile" as "profile" | "friends" | "notifications" | "inventory");

function select(tab: "profile" | "friends" | "notifications" | "inventory") {
    currentTab.value = tab;
}

</script>

<template>
    <div class="home-workspace flex flex-1 gap-4">
        <HomeSideShell @select="select" v-model:tab="currentTab" />
        <ProfileShell v-if="currentTab == 'profile'" class="shell-container flex-1 flex-col justify-between" />
        <FriendsShell v-if="currentTab == 'friends'" class="shell-container flex-1 flex-col justify-between" />
        <InventoryShell v-if="currentTab == 'inventory'" class="shell-container flex-1 flex-col justify-between" />
        <NotificationShell v-if="currentTab == 'notifications'" class="shell-container flex-1 flex-col justify-between" />
    </div>
</template>

<style lang="css" scoped>
</style>