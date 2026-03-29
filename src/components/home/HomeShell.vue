<script setup lang="ts">
import HomeSideShell from './HomeSideShell.vue';
import { ref } from 'vue';
import router from '@/router';

function select(tab: "dashboard" | "friends" | "notifications" | "inventory" | "overlayDebug" | "audioDebug" | "nv12Debug") {
  router.push({ path: `/master.pg/home/${tab}` });
  tabRef.value = tab;
}
const tabRef = ref("dashboard" as "dashboard" | "friends" | "notifications" | "inventory" | "overlayDebug" | "audioDebug" | "nv12Debug");

</script>

<template>
    <div class="home-workspace flex flex-1 gap-4">
        <HomeSideShell @select="select" v-model:tab="tabRef" />
        <RouterView v-slot="{ Component, route }" class="flex-1 min-w-0">
            <div v-if="Component" :key="route.path" class="shell-container flex-1 flex flex-row h-full home-page-in">
                <component :is="Component" class="flex-1 min-w-0" />
            </div>
        </RouterView>
    </div>
</template>

<style lang="css" scoped>
.home-page-in {
    animation: home-enter 0.15s ease;
}

@keyframes home-enter {
    from {
        opacity: 0;
        transform: translateY(6px);
    }
}
</style>