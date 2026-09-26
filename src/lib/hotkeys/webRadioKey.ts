/**
 * The radio key on the web build.
 *
 * A browser tab has no global hotkeys, so the radio gets a focused-window key instead: held while
 * the tab has focus and nothing is being typed. Everything that can take the key-up away from us
 * — the window losing focus, the tab being hidden, a cancelled pointer — releases the key, or a
 * transmission would stay open with nobody holding anything. The desktop app binds the same
 * action through the host's hotkeys (see actions.ts) and never installs this.
 */

import { supports } from "@/lib/platform";
import { useHotkeys } from "@/store/ui/hotKeyStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";

let installed = false;

/** Whether a key press belongs to something the user is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Wires the key to `radioKeyDown`/`radioKeyUp`. Returns the uninstaller; a no-op on the desktop
 * build and when already installed.
 */
export function initWebRadioKey(): () => void {
  if (installed || supports("globalHotkeys") || typeof window === "undefined") return () => {};
  installed = true;

  const hotkeys = useHotkeys();
  const call = useUnifiedCall();
  // The code that went down, so a key rebound while held still releases on that key's key-up.
  let heldCode: string | null = null;

  const keyOf = () => hotkeys.options.radioWebKey || "Backquote";

  const release = () => {
    if (heldCode === null) return;
    heldCode = null;
    call.radioKeyUp();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== keyOf() || e.repeat || e.isComposing) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    if (heldCode !== null) return;
    heldCode = e.code;
    call.radioKeyDown();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== (heldCode ?? keyOf())) return;
    if (heldCode !== null) e.preventDefault();
    release();
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") release();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", release);
  window.addEventListener("pointercancel", release);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    installed = false;
    release();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", release);
    window.removeEventListener("pointercancel", release);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
