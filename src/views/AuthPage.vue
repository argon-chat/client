<script setup lang="ts">
import router from "@/router";
import { useAuthStore } from "@/store/auth/authStore";
import { onMounted } from "vue";
import { useConfig } from "@/store/system/remoteConfig";
import AuthTabs from "@/components/login/AuthTabs.vue";
import IconSw from "@argon/assets/icons/icon_cat.svg"

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
  <div v-motion-slide-visible-once-top :duration="200"
    class="auth-page relative flex h-full w-full items-center justify-center overflow-hidden p-10 text-white">
    <AuthTabs />
  </div>
</template>
