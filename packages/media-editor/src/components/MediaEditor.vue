<template>
  <Teleport to="body">
    <Transition name="media-editor-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 top-[84px] z-[9999] flex items-end justify-center text-foreground outline-none backdrop-blur-sm bg-black/40"
        @keydown.escape="close"
        tabindex="-1"
        ref="overlayEl"
      >
        <div class="media-editor__container relative w-full h-full max-w-[1682px] bg-background rounded-t-[var(--radius,0.5rem)] shadow-lg flex outline-none overflow-hidden max-md:flex-col" @keydown="onKeydown" tabindex="0" ref="containerEl">
          <div class="flex flex-col flex-1 min-w-0">
            <MainCanvas />
            <VideoControls v-if="props.mediaType === 'video'" />
          </div>
          <div class="bg-card flex-[0_0_400px] flex flex-col overflow-hidden max-md:absolute max-md:left-1/2 max-md:-translate-x-1/2 max-md:bottom-0 max-md:w-screen max-md:max-w-[400px] max-md:h-[50vh] max-md:rounded-t-2xl">
            <Topbar :dev-mode="props.devMode" @close="close" @done="handleDone" />
            <Toolbar />
            <FinishButton v-if="!isMobile" @click="handleDone" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, provide } from 'vue';
import { useMediaEditorStore } from '../store/editorStore';
import { createFinalResult } from '../finalRender/createFinalResult';
import { isExpressionMode, type BackgroundRemover, type EditorMode, type ExpressionExportFormat, type MediaType } from '../types';
import MainCanvas from './MainCanvas.vue';
import Topbar from './Topbar.vue';
import Toolbar from './Toolbar.vue';
import FinishButton from './FinishButton.vue';
import VideoControls from './VideoControls.vue';
import { MEDIA_EDITOR_INJECTION_KEY } from '../composables/useMediaEditorContext';

export type MediaEditorMode = EditorMode;

export interface MediaEditorProps {
  modelValue: boolean;
  src: string;
  mediaType?: MediaType;
  /** `sticker` / `emoji`: transparent canvas, cut-out and outline tools, export at 512 / 100×100. */
  mode?: MediaEditorMode;
  initialTab?: string;
  devMode?: boolean;
  /** Sticker modes: enables "Remove background". */
  backgroundRemover?: BackgroundRemover;
  /** Sticker modes: `auto` is lossless WEBP where the browser encodes it, PNG otherwise. */
  exportFormat?: ExpressionExportFormat;
  /** Sticker modes: the file is re-encoded smaller (lossy WEBP as a last resort) to stay under this. */
  maxBytes?: number;
}

const props = withDefaults(defineProps<MediaEditorProps>(), {
  mediaType: 'image',
  mode: 'full',
  initialTab: undefined,
  devMode: false,
  backgroundRemover: undefined,
  exportFormat: 'auto',
  maxBytes: undefined
});

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'done', result: any): void;
  (e: 'cancel'): void;
  (e: 'error', error: unknown): void;
}>();

const store = useMediaEditorStore();
const overlayEl = ref<HTMLElement | null>(null);
const containerEl = ref<HTMLElement | null>(null);
const isMobile = ref(window.innerWidth <= 800);
const expression = isExpressionMode(props.mode) && props.mediaType === 'image';
let finishing = false;

provide(MEDIA_EDITOR_INJECTION_KEY, { store, mode: props.mode, backgroundRemover: props.backgroundRemover });

watch(() => props.modelValue, (open) => {
  if (open) {
    store.init({
      src: props.src,
      type: props.mediaType,
      mode: props.mode,
      initialTab: props.initialTab ?? (expression ? 'cutout' : 'adjustments')
    });
    nextTick(() => {
      overlayEl.value?.focus();
      containerEl.value?.focus();
    });
    loadEditorFonts();
  } else {
    store.reset();
  }
}, { immediate: true });

function close() {
  emit('update:modelValue', false);
  emit('cancel');
}

async function handleDone() {
  if (!store.uiState.renderingPayload || !store.uiState.canvasSize || finishing) return;
  finishing = true;

  try {
    const result = await createFinalResult({
      mediaSrc: store.mediaSrc,
      mediaType: store.mediaType,
      mediaState: store.mediaState,
      canvasSize: store.uiState.canvasSize,
      mediaRatio: store.uiState.mediaRatio ?? 1,
      renderingPayload: store.uiState.renderingPayload as any,
      mode: props.mode,
      getMaskSource: store.getMaskSource,
      exportFormat: props.exportFormat,
      maxBytes: props.maxBytes,
      pixelRatio: store.uiState.pixelRatio
    });

    emit('done', result);
    emit('update:modelValue', false);
  } catch (e) {
    console.error('[media-editor] export failed', e);
    emit('error', e);
  } finally {
    finishing = false;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    store.undo();
  } else if (e.ctrlKey && e.key === 'z' && e.shiftKey) {
    e.preventDefault();
    store.redo();
  } else if (e.ctrlKey && e.key === 'y') {
    e.preventDefault();
    store.redo();
  } else if (e.key === 'Delete' || (e.key === 'Backspace' && !e.ctrlKey)) {
    const sel = store.uiState.selectedResizableLayer;
    const target = e.target as HTMLElement;
    const isEditing = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;
    if (sel != null && !isEditing) {
      e.preventDefault();
      store.mediaState.resizableLayers = store.mediaState.resizableLayers.filter(l => l.id !== sel);
      store.uiState.selectedResizableLayer = undefined;
    }
  }
}

function loadEditorFonts() {
  if (document.getElementById('media-editor-fonts')) return;
  const link = document.createElement('link');
  link.id = 'media-editor-fonts';
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Chewy&family=Courier+Prime:wght@400;700&family=Fugaz+One&family=Playwrite+BE+VLG&family=Roboto:wght@400;500;700&family=Rubik+Bubbles&family=Sedan&family=Suez+One&display=swap';
  document.head.appendChild(link);
}

function handleResize() {
  isMobile.value = window.innerWidth <= 800;
}

window.addEventListener('resize', handleResize);
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
});
</script>

<style>
.media-editor-fade-enter-active {
  transition: opacity 0.3s ease;
}
.media-editor-fade-enter-active .media-editor__container {
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
.media-editor-fade-leave-active {
  transition: opacity 0.5s ease;
}
.media-editor-fade-leave-active .media-editor__container {
  transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1);
  background-color: transparent;
}
.media-editor-fade-enter-from,
.media-editor-fade-leave-to {
  opacity: 0;
}
.media-editor-fade-enter-from .media-editor__container,
.media-editor-fade-leave-to .media-editor__container {
  transform: translateY(100%);
}
</style>
