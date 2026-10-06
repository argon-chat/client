<template>
  <Teleport to="body">
    <Transition name="media-editor-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 top-[84px] z-[9999] flex items-end justify-center text-foreground outline-none backdrop-blur-sm bg-black/40"
        tabindex="-1"
        ref="overlayEl"
        data-media-editor
        @pointerdown.self="requestClose"
      >
        <div class="media-editor__container relative w-full h-full max-w-[1682px] bg-background rounded-t-[var(--radius,0.5rem)] shadow-lg flex outline-none overflow-hidden max-md:flex-col" tabindex="0" ref="containerEl">
          <div class="flex flex-col flex-1 min-w-0">
            <MainCanvas />
            <VideoControls v-if="props.mediaType === 'video'" />
          </div>
          <div class="bg-card flex-[0_0_400px] flex flex-col overflow-hidden max-md:absolute max-md:left-1/2 max-md:-translate-x-1/2 max-md:bottom-0 max-md:w-screen max-md:max-w-[400px] max-md:h-[50vh] max-md:rounded-t-2xl">
            <Topbar :dev-mode="props.devMode" @close="requestClose" @done="handleDone" />
            <Toolbar />
            <FinishButton v-if="!isMobile" @click="handleDone" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount, provide } from 'vue';
import { plainClone, useMediaEditorStore, type EditingMediaState } from '../store/editorStore';
import { createFinalResult, type VideoBitrateFn } from '../finalRender/createFinalResult';
import { loadEditorFonts } from '../fonts';
import { isExpressionMode, type BackgroundRemover, type EditorMode, type ExpressionExportFormat, type MediaType } from '../types';
import MainCanvas from './MainCanvas.vue';
import Topbar from './Topbar.vue';
import Toolbar from './Toolbar.vue';
import FinishButton from './FinishButton.vue';
import VideoControls from './VideoControls.vue';
import { MEDIA_EDITOR_INJECTION_KEY, createInteractions } from '../composables/useMediaEditorContext';

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
  /**
   * Asked before closing with unsaved changes; resolves true to close and lose them. The editor
   * aborts `signal` when the question goes away (Esc while it shows): answer false then. Without
   * it the editor closes.
   */
  confirmDiscard?: (signal: AbortSignal) => Promise<boolean>;
  /** The state to open with: a previous result's `editingMediaState`, or a few fields of it. */
  initialState?: Partial<EditingMediaState>;
  /** The file behind `src`: a rendered video takes its audio from it. Fetched from `src` when absent. */
  mediaBlob?: Blob;
  /** A rendered video's bitrate; the editor's own profile by default. */
  videoBitrate?: VideoBitrateFn;
}

const props = withDefaults(defineProps<MediaEditorProps>(), {
  mediaType: 'image',
  mode: 'full',
  initialTab: undefined,
  devMode: false,
  backgroundRemover: undefined,
  exportFormat: 'auto',
  maxBytes: undefined,
  confirmDiscard: undefined,
  initialState: undefined,
  mediaBlob: undefined,
  videoBitrate: undefined
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
const interactions = createInteractions();
let finishing = false;
let confirming: AbortController | null = null;
let listening = false;

provide(MEDIA_EDITOR_INJECTION_KEY, { store, mode: props.mode, backgroundRemover: props.backgroundRemover, interactions });

watch(() => props.modelValue, (open) => {
  if (open) {
    store.init({
      src: props.src,
      type: props.mediaType,
      mode: props.mode,
      // Merged over the defaults by init(); cloned out of whatever reactivity the host keeps it in.
      initialState: props.initialState ? (plainClone(props.initialState) as EditingMediaState) : undefined,
      initialTab: props.initialTab ?? (expression ? 'cutout' : 'adjustments')
    });
    nextTick(() => {
      overlayEl.value?.focus();
      containerEl.value?.focus();
    });
    void loadEditorFonts();
    listen(true);
  } else {
    confirming?.abort();
    listen(false);
    store.reset();
  }
}, { immediate: true });

function close() {
  emit('update:modelValue', false);
  emit('cancel');
}

/**
 * Whether the editor may close now: yes when nothing is unsaved, otherwise the host's confirmation
 * decides. Hosts call it before closing whatever holds the editor.
 */
async function beforeClose(): Promise<boolean> {
  if (!props.modelValue) return true;
  if (confirming) return false;
  store.cancelGesture();
  if (!store.isDirty || !props.confirmDiscard) return true;
  const controller = new AbortController();
  confirming = controller;
  store.uiState.confirmingClose = true;
  try {
    return (await props.confirmDiscard(controller.signal)) && !controller.signal.aborted;
  } catch {
    return false;
  } finally {
    if (confirming === controller) confirming = null;
    store.uiState.confirmingClose = false;
    if (props.modelValue) nextTick(() => containerEl.value?.focus({ preventScroll: true }));
  }
}

/** The close button, the backdrop, Esc with nothing to cancel: close, asking first when needed. */
async function requestClose() {
  if (await beforeClose()) close();
}

const isDirty = computed(() => store.isDirty);

defineExpose({ isDirty, beforeClose, requestClose });

async function handleDone() {
  if (!store.uiState.renderingPayload || !store.uiState.canvasSize || finishing) return;
  finishing = true;
  // Taken now: the host may let go of the file once the editor closes, and a video renders after.
  const mediaBlob = props.mediaBlob;

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
      pixelRatio: store.uiState.pixelRatio,
      getMediaBlob: mediaBlob ? async () => mediaBlob : undefined,
      videoBitrate: props.videoBitrate
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

// ─── Keys ──────────────────────────────────────────────────────────
// On the window, capturing: the editor is modal, and whatever holds it (a settings drawer that
// closes on Esc) must never see its keys.

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url']);

function isTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && TEXT_INPUTS.has((el as HTMLInputElement).type);
}

/** The letter of a shortcut, by the key on Latin layouts and by its position on the others (Russian). */
function shortcutLetter(e: KeyboardEvent): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase();
  return e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : '';
}

function swallow(e: KeyboardEvent) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

function onEscape() {
  if (store.cancelGesture()) return;
  if (interactions.cancel()) return;
  void requestClose();
}

function selectAll() {
  if (store.uiState.currentTab !== 'cutout') return;
  const tool = store.uiState.cutoutTool;
  if (tool === 'lasso' || tool === 'magneticLasso') {
    store.selectAll();
    return;
  }
  // The selection shows with the lasso tools; switching clears it first.
  store.uiState.cutoutTool = 'lasso';
  void nextTick(() => store.selectAll());
}

function onKeydownCapture(e: KeyboardEvent) {
  if (!props.modelValue) return;
  if (e.key === 'Escape') {
    swallow(e);
    if (confirming) confirming.abort();
    else if (!e.repeat) onEscape();
    return;
  }
  // While the confirmation shows, its buttons have the keys.
  if (confirming || isTextInput(e.target)) return;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  switch (shortcutLetter(e)) {
    case 'z':
      swallow(e);
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    case 'y':
      if (e.shiftKey) return;
      swallow(e);
      store.redo();
      return;
    case 'd':
      if (e.shiftKey) return;
      swallow(e);
      store.deselect();
      return;
    case 'a':
      if (e.shiftKey) return;
      swallow(e);
      selectAll();
      return;
  }
}

// Bubbling, so a tool that takes Backspace (a lasso taking a point back) has it first.
function onKeydown(e: KeyboardEvent) {
  if (!props.modelValue || confirming || e.defaultPrevented) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !isTextInput(e.target)) {
    const layer = store.uiState.selectedResizableLayer;
    if (layer != null && store.removeLayer(layer)) e.preventDefault();
  }
}

function listen(on: boolean) {
  if (on === listening) return;
  listening = on;
  if (on) {
    window.addEventListener('keydown', onKeydownCapture, true);
    window.addEventListener('keydown', onKeydown);
  } else {
    window.removeEventListener('keydown', onKeydownCapture, true);
    window.removeEventListener('keydown', onKeydown);
  }
}

function handleResize() {
  isMobile.value = window.innerWidth <= 800;
}

window.addEventListener('resize', handleResize);
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  confirming?.abort();
  listen(false);
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
