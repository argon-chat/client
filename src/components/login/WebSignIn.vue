<script setup lang="ts">
/**
 * The browser build's entire sign-in screen.
 *
 * There is no form here, and that is the point: the web app never handles a password. It sends the
 * browser to Aegis and takes the tokens that come back, which is also why there is no registration
 * tab, no QR pairing (that pairs a device, and a tab is not one) and no self-hosted entry — the web
 * build serves the official instance only.
 */
import { computed, ref } from "vue";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@argon/ui/card";
import { Button } from "@argon/ui/button";
import { ArrowRightIcon, Loader2Icon, MonitorDownIcon, ShieldCheckIcon } from "lucide-vue-next";
import { beginSignIn, forgetSession, lastSignInError } from "@/lib/webAuth";
import { DOWNLOAD_URL } from "@/lib/platform";
import { useLocale } from "@/store/system/localeStore";
import { useConfig } from "@/store/system/remoteConfig";
import { logger } from "@argon/core";

const { t } = useLocale();
const cfg = useConfig();

const isLeaving = ref(false);
const failed = ref(false);

// A sign-in that failed on the way back has already been forgotten by the time this screen renders
// — the code is spent and the address bar cleaned — so the reason is picked up here instead of the
// user being shown the same button with no explanation of why they are looking at it again.
const returnedError = ref<string | null>(lastSignInError());

async function signIn() {
  if (isLeaving.value) return;
  isLeaving.value = true;
  failed.value = false;
  returnedError.value = null;
  try {
    // The identity server that goes with the selected API, never a fixed one: a token the live Aegis
    // signed is refused by a server running on this machine, and the reverse is just as true.
    await beginSignIn({ baseUrl: cfg.aegisEndpoint, clientId: cfg.webClientId });
    // The page is navigating away; the spinner stays up until it does.
  } catch (e) {
    logger.error("[web-auth] could not start sign-in", e);
    isLeaving.value = false;
    failed.value = true;
  }
}

function openDownload() {
  window.open(DOWNLOAD_URL, "_blank", "noopener");
}

// ── the stand switcher, development builds only ──────────────────────────────────────────────────
//
// `import.meta.env.DEV` is resolved at build time, so this block and its markup are dropped from a
// production bundle rather than merely hidden in it. There is deliberately no translation: it is a
// tool for whoever is working on the app, and never reaches a user.
//
// It lives on the sign-in screen because that is the only place it is usable. The endpoint selector
// in settings is behind a session, and a browser pointed at a local stand has none yet — which left
// the web build with no way to reach a local server at all.
const showStands = import.meta.env.DEV;

const STANDS = [
  { id: "live", label: "live" },
  { id: "dev", label: "dev" },
  { id: "local", label: "local" },
] as const;

const stand = computed(() => cfg.endpoint);

function useStand(next: (typeof STANDS)[number]["id"]) {
  if (next === stand.value) return;

  // The session marker belongs to the stand being left. Kept across the switch it would send the
  // next boot down the cookie path against a server that has never heard of this browser, so the
  // app would start by failing a refresh instead of showing this screen.
  forgetSession();
  localStorage.setItem("api_endpoint", next);
  window.location.reload();
}
</script>

<template>
  <Card class="web-signin-card w-[420px]">
    <CardHeader class="text-center pb-2">
      <div class="flex justify-center mb-3">
        <div class="icon-box">
          <ShieldCheckIcon class="w-6 h-6 text-primary" />
        </div>
      </div>
      <CardTitle class="text-2xl font-bold text-white">{{ t("web_signin_title") }}</CardTitle>
      <CardDescription class="text-muted-foreground">{{ t("web_signin_desc") }}</CardDescription>
    </CardHeader>

    <CardContent class="pt-4">
      <Button class="w-full btn-primary" :disabled="isLeaving" @click="signIn">
        <Loader2Icon v-if="isLeaving" class="w-4 h-4 mr-2 animate-spin" />
        <template v-else>
          {{ t("web_signin_continue") }}
          <ArrowRightIcon class="w-4 h-4 ml-2" />
        </template>
      </Button>

      <p v-if="failed || returnedError" role="alert" class="mt-3 text-center text-xs text-red-400">
        {{ t("web_signin_failed") }}
        <span v-if="returnedError" class="block mt-0.5 font-mono text-[11px] opacity-70">{{ returnedError }}</span>
      </p>
    </CardContent>

    <CardFooter class="flex flex-col gap-2 pt-2">
      <div class="h-px w-full bg-border/50" />
      <button type="button" class="download-link" @click="openDownload">
        <MonitorDownIcon class="w-3.5 h-3.5" />
        {{ t("web_signin_get_desktop") }}
      </button>

      <!-- Development builds only; compiled out of a production bundle. -->
      <div v-if="showStands" class="stand-switch">
        <span class="stand-label">stand</span>
        <button v-for="option in STANDS" :key="option.id" type="button" class="stand-chip"
          :class="{ 'stand-chip--on': stand === option.id }" @click="useStand(option.id)">
          {{ option.label }}
        </button>
        <span class="stand-host">{{ cfg.apiEndpoint }}</span>
      </div>
    </CardFooter>
  </Card>
</template>

<style scoped>
.web-signin-card {
  @apply rounded-2xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl;
}

.icon-box {
  @apply inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20;
}

.btn-primary {
  @apply bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70
         text-primary-foreground shadow-lg shadow-primary/20 transition-all duration-300
         active:scale-[0.98];
}

.download-link {
  @apply inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground
         hover:text-primary transition-colors;
}

.stand-switch {
  @apply mt-1 flex w-full flex-wrap items-center justify-center gap-1.5
         rounded-lg border border-dashed border-border/60 px-2 py-1.5;
}

.stand-label {
  @apply text-[10px] uppercase tracking-wider text-muted-foreground/70;
}

.stand-chip {
  @apply rounded px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground
         hover:text-foreground transition-colors;
}

.stand-chip--on {
  @apply bg-primary/15 text-primary;
}

.stand-host {
  @apply w-full text-center font-mono text-[10px] text-muted-foreground/60;
}
</style>
