<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[540px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-0 overflow-hidden">
      <!-- Header gradient -->
      <div class="relative px-8 pt-8 pb-6">
        <div class="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/10 pointer-events-none"></div>

        <div class="relative flex items-center gap-4">
          <div class="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/20">
            <IconDownload class="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h2 class="text-xl font-bold text-foreground">{{ t('linux_update_title') }}</h2>
            <p class="text-sm text-muted-foreground mt-0.5">
              {{ t('linux_update_subtitle') }}
            </p>
          </div>
        </div>
      </div>

      <!-- Version info -->
      <div class="px-8 pb-4">
        <div class="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border border-border/50">
          <div class="flex-1 flex items-center gap-2">
            <span class="text-xs font-medium text-muted-foreground">{{ t('linux_update_current') }}</span>
            <code class="text-xs px-2 py-0.5 rounded-md bg-muted text-foreground font-mono">
              {{ currentVersion || 'dev' }}
            </code>
          </div>
          <IconArrowRight class="w-4 h-4 text-muted-foreground" />
          <div class="flex-1 flex items-center gap-2 justify-end">
            <span class="text-xs font-medium text-muted-foreground">{{ t('linux_update_new') }}</span>
            <code class="text-xs px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-mono">
              {{ latestVersion || '…' }}
            </code>
          </div>
        </div>
      </div>

      <!-- Instruction -->
      <div class="px-8 pb-4">
        <p class="text-sm text-muted-foreground mb-3">
          {{ t('linux_update_instruction') }}
        </p>

        <div class="relative group">
          <div class="rounded-xl bg-zinc-950 dark:bg-zinc-900 border border-zinc-800 p-4 font-mono text-[13px] text-emerald-400 leading-relaxed break-all select-all overflow-x-auto">
            {{ command }}
          </div>
          <button
            @click="copyCommand"
            class="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
            :class="copied
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700 hover:text-zinc-300'"
          >
            <IconCheck v-if="copied" class="w-3.5 h-3.5" />
            <IconCopy v-else class="w-3.5 h-3.5" />
            {{ copied ? t('linux_update_copied') : t('linux_update_copy') }}
          </button>
        </div>
      </div>

      <!-- Footer hint -->
      <div class="px-8 pb-8 pt-2">
        <div class="flex items-start gap-2 text-xs text-muted-foreground/70">
          <IconInfoCircle class="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>
            {{ t('linux_update_hint') }}
          </p>
        </div>
      </div>

      <DialogFooter class="px-8 pb-6 flex justify-end">
        <Button variant="ghost" @click="open = false">{{ t('close') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Dialog, DialogContent, DialogFooter } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { IconDownload, IconArrowRight, IconCopy, IconCheck, IconInfoCircle } from "@tabler/icons-vue";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();
const open = defineModel<boolean>("open", { required: true });

const props = defineProps<{
  currentVersion?: string;
  latestVersion?: string | null;
  command?: string | null;
}>();

const copied = ref(false);
let copyTimeout: ReturnType<typeof setTimeout> | null = null;

async function copyCommand() {
  if (!props.command) return;
  try {
    await navigator.clipboard.writeText(props.command);
    copied.value = true;
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = props.command;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    copied.value = true;
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => { copied.value = false; }, 2000);
  }
}
</script>
