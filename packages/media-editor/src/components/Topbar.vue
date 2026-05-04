<template>
  <div class="flex items-center justify-between gap-6 shrink-0 h-14 px-4">
    <button class="size-10 rounded-full bg-transparent border-none text-foreground cursor-pointer flex items-center justify-center transition-colors hover:bg-muted disabled:opacity-30 disabled:cursor-default disabled:pointer-events-none" @click="$emit('close')">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>

    <div class="flex items-center gap-4">
      <button
        class="size-10 rounded-full bg-transparent border-none text-foreground cursor-pointer flex items-center justify-center transition-colors hover:bg-muted disabled:opacity-30 disabled:cursor-default disabled:pointer-events-none"
        :disabled="!store.mediaState.history.length"
        @click="store.undo()"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 10h10a5 5 0 0 1 0 10H9"/>
          <path d="M3 10l4-4M3 10l4 4"/>
        </svg>
      </button>
      <button
        class="size-10 rounded-full bg-transparent border-none text-foreground cursor-pointer flex items-center justify-center transition-colors hover:bg-muted disabled:opacity-30 disabled:cursor-default disabled:pointer-events-none"
        :disabled="!store.mediaState.redoHistory.length"
        @click="store.redo()"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10H11a5 5 0 0 0 0 10h4"/>
          <path d="M21 10l-4-4M21 10l-4 4"/>
        </svg>
      </button>
    </div>

    <button
      class="text-base font-medium text-primary bg-transparent border-none py-2 px-4 rounded-lg cursor-pointer transition-opacity hover:opacity-80 disabled:opacity-30 disabled:cursor-default disabled:pointer-events-none"
      :disabled="!store.canFinish"
      @click="$emit('done')"
    >
      Done
    </button>
  </div>
</template>

<script setup lang="ts">
import { useMediaEditorContext } from '../composables/useMediaEditorContext';

const { store } = useMediaEditorContext();

defineEmits<{
  (e: 'close'): void;
  (e: 'done'): void;
}>();
</script>
