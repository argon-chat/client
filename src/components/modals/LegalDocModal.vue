<!--
  Read-only legal document viewer. Renders the current Terms / Privacy body
  (the native Vue component synced from the landing). Used by the registration
  screen and by the forced LegalUpdateGate.

  Uses a fixed-height DialogContent with its own scroll region (not
  DialogScrollContent) so the content scrolls with the app's custom scrollbar
  instead of the default browser one, and stays clear of the OS titlebar.
-->
<script setup lang="ts">
import { computed } from "vue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@argon/ui/dialog";
import { useLocale } from "@/store/system/localeStore";
import { LEGAL, type LegalDoc } from "@/legal/generated";

const props = defineProps<{ doc: LegalDoc }>();
const open = defineModel<boolean>("open", { default: false });
const { t } = useLocale();

const entry = computed(() => LEGAL[props.doc]);
const title = computed(() => (props.doc === "terms" ? t("terms") : t("privacy_policy")));
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      titlebar-safe
      class="w-[680px] max-w-[680px] max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden"
    >
      <DialogHeader class="px-6 pt-6 pb-3 border-b border-border/50 text-left">
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ entry.current }}</DialogDescription>
      </DialogHeader>

      <div class="legal-doc legal-scroll flex-1 min-h-0 overflow-y-auto px-6 py-5">
        <component :is="entry.component" />
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* App-style scrollbar (mirrors the convention used elsewhere in the client),
   replacing the default Chrome one on the policy content. */
.legal-scroll {
  scrollbar-width: thin; /* Firefox */
  scrollbar-color: hsl(var(--foreground) / 0.18) transparent;
}
.legal-scroll::-webkit-scrollbar {
  width: 10px;
}
.legal-scroll::-webkit-scrollbar-track {
  background: transparent;
}
.legal-scroll::-webkit-scrollbar-thumb {
  background: hsl(var(--foreground) / 0.15);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: padding-box;
}
.legal-scroll::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--foreground) / 0.28);
  background-clip: padding-box;
}
</style>
