import type { PickerCell } from "./pickerModel";

/**
 * Telegram's sticker viewer (tweb `stickerViewer.ts`): the left button held on a sticker for 125 ms
 * opens its preview; moving while held switches it to the sticker underneath; letting go closes it,
 * and the click that ends the hold is not a pick. A finger does the same after 400 ms; one that moves
 * or scrolls first is a scroll. A finger held on anything else asks for its menu (skin tones).
 */

export const HOLD_MOUSE_MS = 125;
export const HOLD_TOUCH_MS = 400;
/** A finger that moves this far before the hold fires is scrolling. */
export const HOLD_TOUCH_SLOP = 10;
/** Mouse events a touch sends after it are not a second gesture. */
const TOUCH_COMPAT_MS = 800;

export interface HoldTarget {
  cell: PickerCell;
  el: HTMLElement;
}

export interface HoldPreviewOptions {
  /** The cell at `el`, when it is one of the grid's. */
  hit: (el: Element | null) => HoldTarget | null;
  /** The held sticker; null when the hold ends. */
  preview: (cell: PickerCell | null) => void;
  longPress: (target: HoldTarget) => void;
}

interface Hold {
  touch: boolean;
  target: HoldTarget;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** The preview is up. */
  opened: boolean;
  /** A finger's hold fired on something that is not a sticker. */
  pressed: boolean;
  x: number;
  y: number;
  touchId: number;
}

const isSticker = (target: HoldTarget | null): target is HoldTarget => target?.cell.type === "sticker";

/**
 * Eats the click that ends a hold, wherever it lands. A new press means that click never came; after
 * a finger, the mouse events it is followed by are still part of it.
 */
function swallowNextClick(touch: boolean) {
  const presses = touch ? ["touchstart"] : ["mousedown", "touchstart"];
  const eat = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const done = () => {
    clearTimeout(expiry);
    window.removeEventListener("click", eat, true);
    for (const type of presses) window.removeEventListener(type, done, true);
  };
  const expiry = setTimeout(done, 1000);
  window.addEventListener("click", eat, true);
  for (const type of presses) window.addEventListener(type, done, true);
}

export function useHoldPreview({ hit, preview, longPress }: HoldPreviewOptions) {
  let hold: Hold | null = null;
  let touchedAt = -Infinity;

  function stopListening() {
    document.removeEventListener("mousemove", onDocumentMouseMove);
    document.removeEventListener("mouseup", onDocumentMouseUp, true);
  }

  /** Ends the hold; `release`: it ended by letting go, so its click is swallowed. */
  function end(release: boolean) {
    const current = hold;
    if (!current) return;
    hold = null;
    clearTimeout(current.timer);
    stopListening();
    if (current.opened) preview(null);
    if (release && (current.opened || current.pressed)) swallowNextClick(current.touch);
  }

  function start(target: HoldTarget, touch: boolean, x: number, y: number, touchId = -1) {
    end(false);
    const next: Hold = { touch, target, timer: undefined, opened: false, pressed: false, x, y, touchId };
    next.timer = setTimeout(() => fire(next), touch ? HOLD_TOUCH_MS : HOLD_MOUSE_MS);
    hold = next;
  }

  function fire(current: Hold) {
    if (hold !== current) return;
    current.timer = undefined;
    if (isSticker(current.target)) {
      current.opened = true;
      preview(current.target.cell);
    } else {
      current.pressed = true;
      longPress(current.target);
    }
  }

  function switchTo(target: HoldTarget | null) {
    const current = hold;
    if (!current?.opened || !isSticker(target) || target.el === current.target.el) return;
    current.target = target;
    preview(target.cell);
  }

  // ── mouse ──

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 || e.buttons > 1 || performance.now() - touchedAt < TOUCH_COMPAT_MS) return;
    const target = hit(e.target as Element | null);
    if (!isSticker(target)) return;
    start(target, false, e.clientX, e.clientY);
    document.addEventListener("mousemove", onDocumentMouseMove);
    document.addEventListener("mouseup", onDocumentMouseUp, true);
  }

  function onDocumentMouseMove(e: MouseEvent) {
    const current = hold;
    if (!current || current.touch) return;
    // Leaving the sticker before the preview is up is not a hold.
    if (!current.opened) {
      if (!current.target.el.contains(e.target as Node | null)) end(false);
      return;
    }
    switchTo(hit(e.target as Element | null));
  }

  function onDocumentMouseUp() {
    if (hold && !hold.touch) end(true);
  }

  // ── touch ──

  const touchOf = (e: TouchEvent, id: number) => [...e.changedTouches].find((t) => t.identifier === id) ?? null;

  function onTouchStart(e: TouchEvent) {
    touchedAt = performance.now();
    if (e.touches.length !== 1) {
      end(false);
      return;
    }
    const touch = e.touches[0];
    const target = hit(e.target as Element | null);
    if (target) start(target, true, touch.clientX, touch.clientY, touch.identifier);
  }

  function onTouchMove(e: TouchEvent) {
    const current = hold;
    if (!current?.touch) return;
    const touch = touchOf(e, current.touchId);
    if (!touch) return;
    if (current.opened) {
      // The finger now points at stickers; the grid stays put.
      if (e.cancelable) e.preventDefault();
      switchTo(hit(document.elementFromPoint(touch.clientX, touch.clientY)));
    } else if (!current.pressed && Math.hypot(touch.clientX - current.x, touch.clientY - current.y) > HOLD_TOUCH_SLOP) {
      end(false);
    }
  }

  function onTouchEnd(e: TouchEvent) {
    touchedAt = performance.now();
    const current = hold;
    if (!current?.touch || !touchOf(e, current.touchId)) return;
    // The mouse events and the click a lifted finger would send.
    if ((current.opened || current.pressed) && e.cancelable) e.preventDefault();
    end(true);
  }

  function onTouchCancel() {
    if (hold?.touch) end(false);
  }

  /** A scroll before the preview is up means the press was a scroll. */
  function onScroll() {
    if (hold && !hold.opened && !hold.pressed) end(false);
  }

  /** A touch is down or has just lifted: the browser's own long-press menu is not a second one. */
  const touching = () => !!hold?.touch || performance.now() - touchedAt < TOUCH_COMPAT_MS;

  return {
    onMouseDown,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onScroll,
    touching,
    dispose: () => end(false),
  };
}
