<script setup lang="ts">
import HomeSideShell from './HomeSideShell.vue';
import RouteTransition from '@/components/shared/RouteTransition.vue';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import router from '@/router';

type HomeTab = "dashboard" | "friends" | "notifications" | "inventory" | "overlayDebug" | "audioDebug" | "nv12Debug";

const HOME_TABS: HomeTab[] = ["dashboard", "friends", "notifications", "inventory", "overlayDebug", "audioDebug", "nv12Debug"];

const route = useRoute();

// Active tab is derived from the URL — single source of truth, no local state to desync.
const activeTab = computed<HomeTab>(() => {
  const seg = route.path.split('/master.pg/home/')[1]?.split('/')[0];
  return HOME_TABS.includes(seg as HomeTab) ? (seg as HomeTab) : "dashboard";
});

function select(tab: HomeTab) {
  router.push({ path: `/master.pg/home/${tab}` });
}
</script>

<template>
    <div class="home-workspace flex flex-1 gap-3">
        <HomeSideShell @select="select" :tab="activeTab" />
        <RouterView v-slot="{ Component, route }">
            <RouteTransition>
                <div v-if="Component" :key="route.path" class="shell-container flex-1 flex flex-row h-full">
                    <component :is="Component" class="flex-1 min-w-0" />
                </div>
            </RouteTransition>
        </RouterView>
    </div>
</template>
