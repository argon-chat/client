<script setup lang="ts">
import { TabType, useAuthForm } from "@/composables/useAuthForm";

import LoginForm from "./LoginForm.vue";
import RegisterForm from "./RegisterForm.vue";
import OtpForm from "./OtpForm.vue";
import ResetRequestForm from "./ResetRequestForm.vue";
import ResetConfirmForm from "./ResetConfirmForm.vue";
import { computed } from "vue";

const auth = useAuthForm();

const tabValueForTabs = computed({
  get: () => auth.tabValue.value,
  set: (val: string) => { auth.tabValue.value = val as TabType }
});
</script>

<template>
  <div class="mx-auto flex w-full flex-col items-center justify-center flex-1 min-h-0">
    <Transition name="fade-scale" mode="out-in">
      <LoginForm v-if="tabValueForTabs == 'login'" key="login" :auth="auth" />
      <RegisterForm v-else-if="tabValueForTabs == 'register'" key="register" :auth="auth" />
      <OtpForm v-else-if="tabValueForTabs == 'otp-code'" key="otp" :auth="auth" />
      <ResetRequestForm v-else-if="tabValueForTabs === 'pass-reset'" key="reset-request" :auth="auth" />
      <ResetConfirmForm v-else-if="tabValueForTabs === 'otp-reset'" key="reset-confirm" :auth="auth" />
      <div v-else key="error">error {{ tabValueForTabs }}</div>
    </Transition>
  </div>
</template>

<style scoped>
/* Fade + scale transition for switching between auth forms. */
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: opacity 0.28s ease, transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: opacity, transform;
}

.fade-scale-enter-from {
  opacity: 0;
  transform: scale(0.97) translateY(8px);
}

.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.98) translateY(-6px);
}
</style>
