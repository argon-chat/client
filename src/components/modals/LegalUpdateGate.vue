<!--
  Forced TOS/Privacy re-acceptance gate. Shown as a non-dismissable overlay when
  meStore.legalOutdated is set (the user's accepted version is older than the
  current one). The user must Accept to proceed; declining shows a guilt panel
  pointing them at the console to delete their account (no in-app deletion).
-->
<script setup lang="ts">
import { ref, computed } from "vue";
import { storeToRefs } from "pinia";
import { Dialog, DialogContent } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { ShieldCheckIcon, FileTextIcon, FrownIcon } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";
import { useMe } from "@/store/auth/meStore";
import { LEGAL } from "@/legal/generated";
import LegalDocModal from "./LegalDocModal.vue";

const { t } = useLocale();
const me = useMe();
const { legalOutdated } = storeToRefs(me);

const open = computed(() => legalOutdated.value !== null);
const declined = ref(false);
const accepting = ref(false);

const viewerOpen = ref(false);
const viewerDoc = ref<"terms" | "privacy">("terms");
function view(doc: "terms" | "privacy") {
  viewerDoc.value = doc;
  viewerOpen.value = true;
}

async function accept() {
  accepting.value = true;
  try {
    await me.acceptLegal();
    declined.value = false;
  } catch {
    // Leave the gate open so the user can retry — never let it slip closed unaccepted.
  } finally {
    accepting.value = false;
  }
}

function openConsole() {
  window.open("https://console.argon.gl", "_blank", "noopener,noreferrer");
}
</script>

<template>
  <Dialog :open="open">
    <DialogContent
      :show-close-button="false"
      titlebar-safe
      class="w-[520px] max-w-[520px]"
      @interact-outside.prevent
      @escape-key-down.prevent
      @pointer-down-outside.prevent
    >
      <!-- Updated notice -->
      <template v-if="!declined">
        <div class="flex flex-col items-center text-center gap-3">
          <div class="w-12 h-12 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
            <ShieldCheckIcon class="w-6 h-6 text-primary" />
          </div>
          <h2 class="text-xl font-bold">{{ t("legal_updated_title") }}</h2>
          <p class="text-sm text-muted-foreground">{{ t("legal_updated_desc") }}</p>
        </div>

        <div class="flex flex-col gap-2 mt-2">
          <button
            v-if="legalOutdated?.terms"
            type="button"
            class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-4 py-3 text-left hover:border-primary/40 transition-colors"
            @click="view('terms')"
          >
            <span class="flex items-center gap-2 text-sm font-medium">
              <FileTextIcon class="w-4 h-4 text-primary" /> {{ t("terms") }}
            </span>
            <span class="text-xs text-muted-foreground">{{ LEGAL.terms.current }} · {{ t("legal_view") }}</span>
          </button>
          <button
            v-if="legalOutdated?.privacy"
            type="button"
            class="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-4 py-3 text-left hover:border-primary/40 transition-colors"
            @click="view('privacy')"
          >
            <span class="flex items-center gap-2 text-sm font-medium">
              <FileTextIcon class="w-4 h-4 text-primary" /> {{ t("privacy_policy") }}
            </span>
            <span class="text-xs text-muted-foreground">{{ LEGAL.privacy.current }} · {{ t("legal_view") }}</span>
          </button>
        </div>

        <div class="flex flex-col gap-2 mt-3">
          <Button :disabled="accepting" class="w-full" @click="accept">
            {{ t("legal_accept") }}
          </Button>
          <Button variant="ghost" :disabled="accepting" class="w-full text-muted-foreground" @click="declined = true">
            {{ t("legal_decline") }}
          </Button>
        </div>
      </template>

      <!-- Declined: guilt panel -->
      <template v-else>
        <div class="flex flex-col items-center text-center gap-3">
          <div class="w-12 h-12 rounded-xl bg-destructive/15 border border-destructive/25 flex items-center justify-center">
            <FrownIcon class="w-6 h-6 text-destructive" />
          </div>
          <h2 class="text-xl font-bold">{{ t("legal_decline_title") }}</h2>
          <p class="text-sm text-muted-foreground whitespace-pre-line">{{ t("legal_decline_body") }}</p>
        </div>
        <div class="flex flex-col gap-2 mt-3">
          <Button class="w-full" @click="declined = false">
            {{ t("legal_keep_account") }}
          </Button>
          <Button variant="outline" class="w-full" @click="openConsole">
            {{ t("legal_open_console") }}
          </Button>
        </div>
      </template>
    </DialogContent>
  </Dialog>

  <LegalDocModal v-model:open="viewerOpen" :doc="viewerDoc" />
</template>
