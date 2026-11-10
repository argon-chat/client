/**
 * Decorative motion holds still while nobody is looking at it.
 *
 * A looping flourish — a name's travelling colours, a frame's bob, an animated emoji — is there to be
 * seen, and it costs a redraw of the window on every display frame to keep it going: a 60×19 px
 * name drift was enough to keep the whole window repainting at the monitor's rate, unfocused, all
 * day. So it stops when the window loses focus, when the page is hidden, and under power saving
 * (lib/powerSaver.ts), and picks up again when the user comes back.
 *
 * Two readers. `decor-paused` on <html> pauses the cosmetics' CSS animations in place
 * (styles/decor-paused.css). The animation intersector reads `userAway` and holds stickers and
 * custom emoji on their first frame — power saving reaches those through the expression settings
 * already, where a hover may still play one; away, nothing plays.
 *
 * Read at import rather than at `init`: the intersector is made by whatever sticker renders first,
 * which may be before the app shell mounts.
 */
import { computed, ref, watchEffect } from "vue";
import { powerSaveActive } from "@/lib/powerSaver";

/** The class on <html> while decorative motion is paused. */
export const DECOR_PAUSED_CLASS = "decor-paused";

function focusNow(): boolean {
  try {
    return typeof document === "undefined" || document.hasFocus();
  } catch {
    return true;
  }
}

function hiddenNow(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

const focused = ref(focusNow());
const hidden = ref(hiddenNow());

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => (focused.value = true));
  window.addEventListener("blur", () => (focused.value = false));
  // Read focus again on the way back: a window restored from the taskbar is not always told twice.
  document.addEventListener("visibilitychange", () => {
    hidden.value = hiddenNow();
    focused.value = focusNow();
  });
}

/** The window has focus — in a browser, the tab is the active one in a focused window. */
export const windowFocused = computed(() => focused.value);

/** The page is hidden: a background tab, a minimised window. */
export const pageHidden = computed(() => hidden.value);

/** Nobody is looking: the window is not focused, or the page is not shown. */
export const userAway = computed(() => !focused.value || hidden.value);

/** Whether looping decoration should hold still: the user is away, or power saving is on. */
export const decorativeMotionPaused = computed(() => userAway.value || powerSaveActive.value);

let started = false;

/** Keeps the <html> class in step. Idempotent, as `initPowerSaver` is. */
export function initDecorativeMotion(): void {
  if (started) return;
  started = true;
  watchEffect(() => {
    document.documentElement.classList.toggle(DECOR_PAUSED_CLASS, decorativeMotionPaused.value);
  });
}
