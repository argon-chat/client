<script setup lang="ts">
import router from "@/router";
import { useAuthStore } from "@/store/auth/authStore";
import { onMounted } from "vue";
import { useConfig } from "@/store/system/remoteConfig";
import { useLocale } from "@/store/system/localeStore";
import { useToast } from "@argon/ui/toast";
import { consumeSignOutReason, signOutReasonMessageKey } from "@/lib/net/sessionRecovery";
import AuthTabs from "@/components/login/AuthTabs.vue";
import IconSw from "@argon/assets/icons/icon_cat.svg"

const cfg = useConfig();
const authStore = useAuthStore();
const { t } = useLocale();
const { toast } = useToast();

onMounted(() => {
  if (authStore.isAuthenticated) {
    router.push({ path: "/master.pg" });
    return;
  }

  // Landing here because the server ended the session — signed out from another device, a password
  // change — deserves a sentence, or the user is left guessing why they are looking at a sign-in
  // form. The reason travelled across the reload as a code; it is spelled out in the app's language
  // here, and shown once.
  const reason = consumeSignOutReason();
  if (reason) {
    toast({ title: t("session_ended_title"), description: t(signOutReasonMessageKey(reason)), duration: 8000 });
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
