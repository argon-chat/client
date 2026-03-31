<script setup lang="ts">
import PixelCard from "@/components/shared/PixelCard.vue";
import router from "@/router";
import { useAuthStore } from "@/store/auth/authStore";
import { computed, onMounted } from "vue";
import { useConfig } from "@/store/system/remoteConfig";
import AuthTabs from "@/components/login/AuthTabs.vue";
import AppTitlebar from "@/components/AppTitlebar.vue";
import IconSw from "@argon/assets/icons/icon_cat.svg"

const showDevolutionTitlebar = computed(() => (window as any).devolution_titlebar === 0x1);

const cfg = useConfig();
const authStore = useAuthStore();
onMounted(() => {
  if (authStore.isAuthenticated) {
    router.push({ path: "/master.pg" });
    return;
  }
});

const changeEndpoint = () => {
  if (cfg.isDev) {
    localStorage.setItem("api_endpoint", "live");
    window.location.reload();
  } else {
    localStorage.setItem("api_endpoint", "local");
    window.location.reload();
  }
};
</script>

<template>
  <div v-motion-slide-visible-once-top :duration="200" style="overflow: hidden; width: 100svw; height: 100svh;"
    class="container relative hidden flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-1 lg:px-0">
    <AppTitlebar v-if="showDevolutionTitlebar" />
    <div class="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">

      <PixelCard class="absolute inset-0 bg-zinc-900 " id="background" style="position: absolute;" />
      <div class="absolute z-20 flex items-center text-lg font-medium" @dblclick="changeEndpoint">
        <IconSw class="w-12 h-12 pr-2 fill-blue-500" />
        Argon Chat {{ cfg.isDev ? '[DEVELOPMENT]' : '' }}
      </div>
      <AuthTabs />
    </div>
  </div>
</template>
