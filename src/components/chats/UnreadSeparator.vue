<template>
  <div class="flex items-center gap-3 py-2 select-none">
    <div class="flex-1 h-px bg-destructive/40" />
    <span class="text-[11px] font-semibold text-destructive/70 uppercase tracking-wide">
      {{ t('new_messages') || 'New messages' }}
    </span>
    <div class="flex-1 h-px bg-destructive/40" />
  </div>
</template>

<script setup lang="ts">
import { useLocale } from "@/store/system/localeStore";
const { t } = useLocale();
</script>
