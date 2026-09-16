<script setup lang="ts">
import router from "@/router";
import { useAuthStore } from "@/store/auth/authStore";
import { onMounted } from "vue";
import { useLocale } from "@/store/system/localeStore";
import { useToast } from "@argon/ui/toast";
import { consumeSignOutReason, signOutReasonMessageKey } from "@/lib/net/sessionRecovery";
import AuthTabs from "@/components/login/AuthTabs.vue";
import SignedInAccounts from "@/components/account/SignedInAccounts.vue";
import { useAccounts } from "@/store/auth/accountsStore";
import { supports } from "@/lib/platform";
import { computed } from "vue";
import { isSwitchingAccount } from "@/store/system/sessionLifecycle";
import IconSw from "@argon/assets/icons/icon_cat.svg"

const authStore = useAuthStore();
const accounts = useAccounts();
const { t } = useLocale();
const { toast } = useToast();

/**
 * The accounts already on this device, so a session refused by the server (revoked, or the account
 * deleted outright) does not strand the user here with no way back into the others.
 *
 * **Not while a sign-in is succeeding**, which is what `isAuthenticated` rules out. Signing in for
 * the first time adopts the account into the registry and only then leaves for home, and in the gap
 * between those two the list stopped being empty while the sign-in screen was still on top of it —
 * so the panel appeared for a moment on a screen the user was already leaving, advertising the
 * account they had just that second created. It is a way back in, and someone who is already in
 * does not need one.
 *
 * `isSwitchingAccount` covers the same shape for a deliberate switch, where the overlay is what the
 * user is meant to be looking at.
 */
const showAccounts = computed(() =>
  supports("multiAccount")
  && accounts.accounts.length > 0
  && !authStore.isAuthenticated
  && !isSwitchingAccount.value);

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
</script>

<template>
  <div v-motion-slide-visible-once-top :duration="200"
    class="auth-page relative flex h-full w-full items-center justify-center overflow-hidden p-10 text-white">
    <!-- The panel stands beside the form as the other way in, and is absent entirely when there is
         no account on the device to offer — which is the ordinary case. -->
    <!-- Width fixed by the row, not by what the form happens to be showing: the panel would
         otherwise slide sideways every time a form of a different width takes over. -->
    <div class="flex w-full max-w-[1000px] items-center justify-center gap-5">
      <SignedInAccounts v-if="showAccounts" />
      <AuthTabs />
    </div>
  </div>
</template>
