<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  <div class="mx-auto flex w-full flex-col justify-center space-y-6">
    <LoginForm v-if="tabValueForTabs == 'login'" :auth="auth" />
    <RegisterForm v-if="tabValueForTabs == 'register'" :auth="auth" />
    <OtpForm v-if="tabValueForTabs == 'otp-code'" :auth="auth" />
    <ResetRequestForm v-if="tabValueForTabs == 'pass-reset'" :auth="auth" />
    <ResetConfirmForm v-if="tabValueForTabs == 'otp-reset'" :auth="auth" />
  </div>
</template>
