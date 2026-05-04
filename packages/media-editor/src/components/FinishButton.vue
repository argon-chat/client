<template>
  <div class="flex justify-center p-4 shrink-0">
    <button
      class="size-14 rounded-full bg-primary border-none text-primary-foreground cursor-pointer flex items-center justify-center transition-all hover:opacity-90 hover:scale-105 disabled:opacity-30 disabled:cursor-default disabled:scale-100"
      :disabled="!store.canFinish"
      @click="$emit('click')"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useMediaEditorContext } from '../composables/useMediaEditorContext';

const { store } = useMediaEditorContext();

defineEmits<{
  (e: 'click'): void;
}>();
</script>
