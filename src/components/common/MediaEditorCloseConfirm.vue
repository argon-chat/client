<script setup lang="ts">
import { ref } from "vue";
import { useLocale } from "@/store/system/localeStore";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";

/**
 * "Close the editor? Unsaved changes will be lost." for the media editor's hosts: `ask` is what the
 * editor's `confirm-discard` calls. Shown above the editor; Cancel is the default.
 */
const { t } = useLocale();
const open = ref(false);
let settle: ((discard: boolean) => void) | null = null;

function answer(discard: boolean) {
  const resolve = settle;
  settle = null;
  open.value = false;
  resolve?.(discard);
}

/** Resolves true to close and lose the changes; false on Cancel, a click outside, or `signal` aborting. */
function ask(signal?: AbortSignal): Promise<boolean> {
  settle?.(false);
  return new Promise((resolve) => {
    settle = resolve;
    open.value = true;
    signal?.addEventListener(
      "abort",
      () => {
        if (settle === resolve) answer(false);
      },
      { once: true },
    );
  });
}

defineExpose({ ask });
</script>

<template>
  <Dialog :open="open" @update:open="(value: boolean) => { if (!value) answer(false); }">
    <DialogContent class="max-w-md" :show-close-button="false" described data-media-editor-close-confirm>
      <DialogHeader>
        <DialogTitle>{{ t("media_editor_close_title") }}</DialogTitle>
        <DialogDescription>{{ t("media_editor_close_body") }}</DialogDescription>
      </DialogHeader>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" data-close-confirm="cancel" @click="answer(false)">{{ t("media_editor_close_cancel") }}</Button>
        <Button variant="destructive" size="sm" data-close-confirm="discard" @click="answer(true)">{{ t("media_editor_close_discard") }}</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style>
/* The media editor sits at z-index 9999; its confirmation goes above it. */
[data-slot="dialog-frame"]:has([data-media-editor-close-confirm]),
[data-slot="dialog-overlay"]:has(+ [data-slot="dialog-frame"] [data-media-editor-close-confirm]) {
  z-index: 10000;
}
</style>
