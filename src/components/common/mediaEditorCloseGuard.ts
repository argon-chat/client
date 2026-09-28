import { ref, watch } from "vue";

/** What a host needs of an open media editor. */
export type MediaEditorHandle = { isDirty: boolean; beforeClose(): Promise<boolean> };
type ConfirmHandle = { ask(signal?: AbortSignal): Promise<boolean> };

export type EditorHost = {
  /** Whether whatever holds the editor (a settings drawer) is open, and a way to set it. */
  open: () => boolean;
  setOpen: (open: boolean) => void;
  editorOpen: () => boolean;
  closeEditor: () => void;
};

/**
 * The close guard's wiring for a host of the media editor: bind `editor` and `closeConfirm` as
 * template refs and pass `confirmDiscard` to the editor. With `host`, the thing holding the editor
 * cannot close under unsaved changes either: its closing is undone at once and the editor asks;
 * a yes then closes both.
 */
export function useMediaEditorCloseGuard(host?: EditorHost) {
  const editor = ref<MediaEditorHandle | null>(null);
  const closeConfirm = ref<ConfirmHandle | null>(null);

  const confirmDiscard = (signal: AbortSignal) => closeConfirm.value?.ask(signal) ?? Promise.resolve(true);

  if (host) {
    let passing = false;
    watch(
      host.open,
      (open) => {
        const current = editor.value;
        if (open || passing || !host.editorOpen() || !current?.isDirty) return;
        host.setOpen(true);
        void current.beforeClose().then((close) => {
          if (!close) return;
          passing = true;
          try {
            host.closeEditor();
            host.setOpen(false);
          } finally {
            passing = false;
          }
        });
      },
      { flush: "sync" },
    );
  }

  return { editor, closeConfirm, confirmDiscard };
}
