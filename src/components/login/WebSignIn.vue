<script setup lang="ts">
/**
 * The browser build's entire sign-in screen.
 *
 * There is no form here, and that is the point: the web app never handles a password. It sends the
 * browser to Aegis and takes the tokens that come back, which is also why there is no registration
 * tab, no QR pairing (that pairs a device, and a tab is not one) and no self-hosted entry — the web
 * build serves the official instance only.
 */
import { ref } from "vue";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@argon/ui/card";
import { Button } from "@argon/ui/button";
import { ArrowRightIcon, Loader2Icon, MonitorDownIcon, ShieldCheckIcon } from "lucide-vue-next";
import { beginSignIn, lastSignInError } from "@/lib/webAuth";
import { DOWNLOAD_URL } from "@/lib/platform";
import { useLocale } from "@/store/system/localeStore";
import { logger } from "@argon/core";

const { t } = useLocale();

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
    await beginSignIn();
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

      <p class="mt-3 text-center text-xs leading-5 text-muted-foreground">
        {{ t("web_signin_hint") }}
      </p>
    </CardContent>

    <CardFooter class="flex flex-col gap-2 pt-2">
      <div class="h-px w-full bg-border/50" />
      <button type="button" class="download-link" @click="openDownload">
        <MonitorDownIcon class="w-3.5 h-3.5" />
        {{ t("web_signin_get_desktop") }}
      </button>
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
</style>
