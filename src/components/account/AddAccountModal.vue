<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@argon/ui/dialog";
import { VisuallyHidden } from "@argon/ui/visually-hidden";
import AuthTabs from "@/components/login/AuthTabs.vue";
import { useLocale } from "@/store/system/localeStore";

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();

const { t } = useLocale();
</script>

<template>
  <!-- "Add account" reuses the real login flow (AuthTabs) in enroll mode: same email/password, OTP and
       self-hosted forms, but run against a one-off client so the current session is untouched. On
       success the new account is registered and switched into (reload). -->
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="w-auto max-w-fit border-0 bg-transparent p-0 shadow-none">
      <VisuallyHidden>
        <DialogTitle>{{ t("add_account_title") }}</DialogTitle>
        <DialogDescription>{{ t("add_account") }}</DialogDescription>
      </VisuallyHidden>
      <AuthTabs mode="enroll" />
    </DialogContent>
  </Dialog>
</template>
