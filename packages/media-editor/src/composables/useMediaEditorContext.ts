import type { ComputedRef, InjectionKey } from 'vue';
import type { useMediaEditorStore } from '../store/editorStore';
import type { BackgroundRemover, EditorMode } from '../types';
import { inject, onBeforeUnmount } from 'vue';

/** Cancels something in progress (a lasso being drawn, a text being typed); false when nothing was. */
export type EscapeHandler = () => boolean;

/** What Esc cancels, the most recently registered first. */
export interface Interactions {
  register(handler: EscapeHandler): () => void;
  /** Esc: the first handler that had something to cancel; false when none had. */
  cancel(): boolean;
}

export function createInteractions(): Interactions {
  const handlers: EscapeHandler[] = [];
  return {
    register(handler) {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    cancel() {
      for (let i = handlers.length - 1; i >= 0; i--) if (handlers[i]()) return true;
      return false;
    }
  };
}

export type MediaEditorContext = {
  store: ReturnType<typeof useMediaEditorStore>;
  mode: EditorMode;
  /** Sticker modes: the host's background removal, when it has one. */
  backgroundRemover?: BackgroundRemover;
  interactions: Interactions;
  /** A video's quality steps from the host (output short sides, ascending); undefined for the editor's own presets. */
  videoQualitySteps?: ComputedRef<readonly number[] | undefined>;
};

export const MEDIA_EDITOR_INJECTION_KEY: InjectionKey<MediaEditorContext> = Symbol('media-editor');

export function useMediaEditorContext(): MediaEditorContext {
  const ctx = inject(MEDIA_EDITOR_INJECTION_KEY);
  if (!ctx) throw new Error('useMediaEditorContext must be used within MediaEditor');
  return ctx;
}

/** Registers what Esc cancels for as long as the component is mounted. */
export function useEscape(handler: EscapeHandler): void {
  const ctx = inject(MEDIA_EDITOR_INJECTION_KEY, null);
  if (!ctx) return;
  onBeforeUnmount(ctx.interactions.register(handler));
}
