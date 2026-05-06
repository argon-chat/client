<template>
  <div class="flex items-center justify-between gap-6 shrink-0 h-14 px-4">
    <button class="size-10 rounded-full bg-transparent border-none text-foreground cursor-pointer flex items-center justify-center transition-colors hover:bg-muted disabled:opacity-30 disabled:cursor-default disabled:pointer-events-none" @click="$emit('close')">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>

    <div class="flex items-center gap-4">
      <!-- Before/After toggle -->
      <button
        class="size-10 rounded-full border-none cursor-pointer flex items-center justify-center transition-colors hover:bg-muted"
        :class="store.uiState.showBeforeAfter ? 'bg-primary/20 text-primary' : 'bg-transparent text-foreground/50'"
        title="Before / After"
        @click="store.uiState.showBeforeAfter = !store.uiState.showBeforeAfter"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="18" rx="2"/>
          <line x1="12" y1="3" x2="12" y2="21"/>
        </svg>
      </button>
      <!-- Debug gizmo toggle (dev mode only) -->
      <button
        v-if="devMode"
        class="size-10 rounded-full border-none cursor-pointer flex items-center justify-center transition-colors hover:bg-muted"
        :class="store.uiState.debugGizmos ? 'bg-green-500/20 text-green-400' : 'bg-transparent text-foreground/50'"
        title="Toggle debug gizmos"
        @click="store.uiState.debugGizmos = !store.uiState.debugGizmos"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
      </button>
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

defineProps<{
  devMode?: boolean;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'done'): void;
}>();
</script>
