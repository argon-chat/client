import type { InjectionKey } from 'vue';
import type { useMediaEditorStore } from '../store/editorStore';
import { inject } from 'vue';

export type MediaEditorContext = {
  store: ReturnType<typeof useMediaEditorStore>;
  mode: string;
};

export const MEDIA_EDITOR_INJECTION_KEY: InjectionKey<MediaEditorContext> = Symbol('media-editor');

export function useMediaEditorContext(): MediaEditorContext {
  const ctx = inject(MEDIA_EDITOR_INJECTION_KEY);
  if (!ctx) throw new Error('useMediaEditorContext must be used within MediaEditor');
  return ctx;
}
