import { onBeforeUnmount, onMounted } from "vue";

/**
 * Whether a modal is on screen above whatever is asking.
 *
 * <b>For window-level Escape handlers.</b> The settings windows listen on `window`, so a dialog
 * opened inside one of them shares the key with it: reka closes the dialog, the listener closes the
 * window underneath, and one press undoes two things — the second of which nobody asked for.
 *
 * Asked of the DOM rather than of a store, because a dialog's open state belongs to whichever
 * component owns it and there is no register of them. `data-slot="dialog-content"` is set by our own
 * `DialogContent`, and reka unmounts the portal when the dialog closes, so the element is present
 * exactly while one is up.
 */
export function isModalLayerOpen(): boolean {
  if (typeof document === "undefined") return false;

  return document.querySelector('[data-slot="dialog-content"], [role="alertdialog"][data-state="open"]') !== null;
}

/**
 * Closes a dialog on Escape, ahead of everything else that wants the key.
 *
 * <b>Reka already does this, and here it cannot.</b> Its dismissable layer listens on `window` and
 * only dismisses when `event.defaultPrevented` is false — but the settings windows are vaul drawers
 * opened with `dismissible: false`, and vaul's own Escape handler calls `preventDefault()` to stop
 * itself being dismissed. It runs first, because the drawer mounted first, so every dialog opened
 * inside one of these windows is unreachable by the key that is supposed to close it.
 *
 * The listener is registered in the capture phase, which is the only position ahead of both of them,
 * and stops the event there: the drawer never sees it, so neither its handler nor the window's own
 * Escape shortcut runs, and one press closes exactly one thing.
 *
 * Two stacked dialogs would both close, since a capture listener on `window` cannot stop a sibling
 * on the same node. Not worth guarding until something actually stacks them.
 */
export function useEscapeDismiss(isOpen: () => boolean, dismiss: () => void): void {
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || !isOpen()) return;

    event.preventDefault();
    event.stopPropagation();
    dismiss();
  }

  onMounted(() => window.addEventListener("keydown", onKeyDown, true));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown, true));
}
