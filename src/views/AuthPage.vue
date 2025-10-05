<script setup lang="ts">
import PixelCard from "@/components/PixelCard.vue";
import router from "@/router";
import { useAuthStore } from "@/store/authStore";
import { computed, onMounted } from "vue";
import { useConfig } from "@/store/remoteConfig";
import AuthTabs from "@/components/login/AuthTabs.vue";
import IconSw from "@/assets/icons/icon_cat.svg"

const isMobile = computed(() => argon.isMobileHost);
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
  <div v-motion-slide-visible-once-top :duration="200" style="overflow: hidden;" v-if="!isMobile"
    class="container relative hidden h-screen flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-1 lg:px-0">
    <div class="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">

      <PixelCard class="absolute inset-0 bg-zinc-900 " id="background" style="position: absolute;" />
      <div class="absolute z-20 flex items-center text-lg font-medium" @dblclick="changeEndpoint">
        <IconSw class="w-12 h-12 pr-2 fill-blue-500" />
        Argon Chat {{ cfg.isDev ? '[DEVELOPMENT]' : '' }}
      </div>
      <AuthTabs />
    </div>
  </div>

  <div class="md:hidden relative h-screen w-full overflow-hidden flex flex-col items-center justify-center" v-else>
    <div class="absolute top-4 left-4 z-20 flex items-center text-base font-medium" @dblclick="changeEndpoint">
      <IconSw class="w-8 h-8 pr-2 fill-blue-500" />
      Argon Chat {{ cfg.isDev ? '[DEVELOPMENT]' : '' }}
    </div>
    <div class="relative z-10 w-full max-w-sm px-4">
      <AuthTabs />
    </div>
  </div>
</template>
