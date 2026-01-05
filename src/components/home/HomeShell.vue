<script setup lang="ts">
import HomeSideShell from './HomeSideShell.vue';
import { computed, ref } from 'vue';
import router from '@/router';

function select(tab: "dashboard" | "friends" | "notifications" | "inventory") {
  router.push({ path: `/master.pg/home/${tab}` });
  tabRef.value = tab;
}
const tabRef = ref("dashboard" as "dashboard" | "friends" | "notifications" | "inventory");

</script>

<template>
    <div class="home-workspace flex flex-1 gap-4">
        <HomeSideShell @select="select" v-model:tab="tabRef" />
        <RouterView class="shell-container flex-1 flex flex-row"/>
    </div>
</template>

<style lang="css" scoped>
</style>