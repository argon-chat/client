<template>
  <div class="app-container relative flex flex-col" style="width: 100svw; height: 100svh;">
    <AppTitlebar v-if="showTitlebar" @home="onHome" @feedback="feedbackOpened = true" />

    <div class="shell-content relative flex flex-1 min-h-0">
      <RouterView v-slot="{ Component }">
        <Transition name="shell-view" mode="out-in">
          <!-- Keyed by sessionEpoch so a seamless account switch remounts the whole authed tree,
               rebinding component-scoped Dexie liveQueries to the new account's DB. -->
          <component :is="Component" :key="sessionEpoch" />
        </Transition>
      </RouterView>
    </div>

    <Transition name="switch-fade">
      <div v-if="isSwitchingAccount" class="account-switch-overlay">
        <div class="account-switch-card">
          <Loader2Icon class="w-6 h-6 animate-spin text-primary" />
          <span>{{ t("switching_account") }}</span>
        </div>
      </div>
    </Transition>

    <SendUserFeedback v-model:open="feedbackOpened" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, provide, ref, watchEffect } from "vue";
import AppTitlebar from "@/components/AppTitlebar.vue";
import SendUserFeedback from "@/components/modals/SendUserFeedback.vue";
import { usePoolStore } from "@/store/data/poolStore";
import { useAppState } from "@/store/system/appState";
import { sessionEpoch, isSwitchingAccount } from "@/store/system/sessionLifecycle";
import { useLocale } from "@/store/system/localeStore";
import { useToast } from "@argon/ui/toast";
import { consumeSwitchFailure } from "@/store/auth/accountsStore";
import { Loader2Icon } from "lucide-vue-next";
import router from "@/router";
import { useRoute } from "vue-router";
import { isWeb } from "@/lib/platform";

const { t } = useLocale();
const { toast } = useToast();
const pool = usePoolStore();
const appState = useAppState();
const feedbackOpened = ref(false);

const route = useRoute();

// Unified titlebar — present on every view in the shell except sign-in.
//
// The host flag is what the desktop sets; the browser has no host to set it, and hiding the bar
// there took the home button, the breadcrumb and the unread badge with it. Those are not window
// chrome — they are the app. What a tab genuinely has no use for is the close/minimize/maximize
// group, and that is dropped inside AppTitlebar rather than by hiding the whole bar.
//
// Sign-in is the exception on every build: there is no home to go to, no breadcrumb to show and
// nothing unread, so the bar would be a strip of disabled affordances above a login form.
const showTitlebar = computed(() =>
  route.name !== "Login" && (window.devolution_titlebar === 0x1 || isWeb));

// Shell mounts once at app start — boot the app here (replaces the old Entry view).
onMounted(() => {
  // A switch that could not be completed puts the user back where they were, which without a word
  // looks like the click did nothing. Told once the app is up, so the message is not spent behind
  // the loading screen.
  void appState.initApp().then(() => {
    const name = consumeSwitchFailure();
    if (name) {
      toast({
        title: t("account_switch_failed_title"),
        description: t("account_switch_failed_desc", { name }),
        duration: 8000,
      });
    }
  });
});

// Expose the titlebar height (0 when absent) so modals can keep clear of the window controls. The
// titlebar is 38px tall — see AppTitlebar.vue.
//
// Recomputed rather than set once at mount: the bar now comes and goes with the route, and a value
// frozen on the sign-in screen would leave every modal in the app padding for a bar that is there.
watchEffect(() => {
  document.documentElement.style.setProperty(
    "--app-titlebar-height",
    showTitlebar.value ? "38px" : "0px"
  );
});

// Children read this to pad their content for the OS titlebar overlay area.
provide("titlebarVisible", showTitlebar);

function onHome() {
  pool.selectedServer = null;
  router.push({ name: "HomeShellView" });
}
</script>

<!--
  Shell-level view transition (Login ↔ Master ↔ Lockdown). NOT scoped: the
  classes are applied to the route component's root, which lives outside this
  component's scope. Gives the "materialize into the app" feel post-login.
  Auto-neutralized under prefers-reduced-motion by the global stylesheet.
-->
<style>
.shell-view-enter-active {
  transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.16, 1, 0.3, 1),
    filter 0.35s ease;
}
.shell-view-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease, filter 0.2s ease;
}
.shell-view-enter-from {
  opacity: 0;
  transform: scale(0.985);
  filter: blur(6px);
}
.shell-view-leave-to {
  opacity: 0;
  transform: scale(1.012);
  filter: blur(3px);
}

/* Account-switch masking overlay. */
.account-switch-overlay {
  position: absolute;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: hsl(var(--background) / 0.85);
  backdrop-filter: blur(8px);
}
.account-switch-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-radius: var(--radius);
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.5);
  color: hsl(var(--foreground));
  font-size: 14px;
  box-shadow: 0 10px 40px rgb(0 0 0 / 0.35);
}
.switch-fade-enter-active,
.switch-fade-leave-active {
  transition: opacity 0.2s ease;
}
.switch-fade-enter-from,
.switch-fade-leave-to {
  opacity: 0;
}
</style>
