/**
 * The media viewer's own window under vue-native (vue-native docs/MULTIWINDOW.md §7.9). It works the
 * way Telegram Desktop's viewer does:
 *
 * - a window with no frame over the whole monitor the main window is on;
 * - owned by the main window: no taskbar button, one Alt-Tab entry;
 * - dimmed per pixel over whatever is behind it.
 *
 * The window is made hidden once the app is idle, and an open SHOWS it: a frame, not a window. The
 * picture grows out of its thumbnail and shrinks back into it. Ctrl+wheel zooms about the pointer (a
 * plain wheel does nothing, as in Electron), a drag pans a zoomed picture no further than its edges
 * (Telegram's clamp), and a double click goes between the fit and one picture pixel per screen pixel.
 * A drag that ends on the dim is not a click on it. The pictures keep their full decode while the
 * viewer shows them.
 *
 * ImageLightbox asks for this only when `import.meta.env.VN` is true. Vite replaces that with
 * `undefined`, so in Electron and the browser neither the call nor this module is in the bundle, and
 * the viewer stays the overlay teleported into the page.
 */
import { computed, defineComponent, h, markRaw, nextTick, onMounted, reactive, ref, type Component } from "vue";
import type { ChatMediaItem } from "@/lib/media/mediaItem";
import type { VnWindowHandle } from "./vnWindow";

/**
 * Topmost while it is up. Off: a full-screen window that is the foreground one is already above the
 * taskbar. This is the fallback should the taskbar be seen over the viewer all the same.
 */
const TOPMOST = false;
const MAX_ZOOM = 8;
/** Zoom per wheel delta: one notch (120) is ×1.2. */
const WHEEL_RATE = 0.0015;
/** A press that moves further than this is a drag, not a click. */
const DRAG_SLOP = 4;

export interface ViewerSource {
  /** What the viewer shows now. */
  item(): ChatMediaItem | undefined;
  /** It is a video: no zoom and no thumbnail to grow from. */
  video(): boolean;
}

export function useViewerWindow(VnWindow: Component, src: ViewerSource) {
  /** The window exists, hidden until shown. Made at idle, or by the first open if that is sooner. */
  const warm = ref(false);
  /** The window is up: from the open until the leave transition has finished. */
  const shown = ref(false);
  const viewer = ref<VnWindowHandle | null>(null);
  /**
   * The viewer's viewport in CSS px: the monitor's. `vw` / `vh` are the main window's in a vue-native
   * pop-out (vue-native A-M05), so the viewer's sizes are worked out from this instead.
   */
  const viewport = reactive({ width: 0, height: 0 });
  /** The viewer's device px per CSS px: what one picture pixel per screen pixel is measured in. */
  let scale = 1;
  const zoom = ref(1);
  const pan = reactive({ x: 0, y: 0 });
  const dragging = ref(false);
  let drag: { x: number; y: number; px: number; py: number } | null = null;
  /** The last press moved the picture: the click it ends in is no click on the dim. */
  let dragged = false;
  /** The picture's element, from the `image` binding. */
  let picture: HTMLElement | null = null;
  const setPicture = (el: unknown) => (picture = (el as HTMLElement | null) ?? null);
  /**
   * Where the thumbnail is, as a transform of the fitted picture: the open grows the picture out of it
   * and the close shrinks it back. `null`: in place.
   */
  const fromThumb = ref<string | null>(null);

  /** The viewer's window. Its slot is the overlay, which it paints. */
  const Host = markRaw(
    defineComponent({
      inheritAttrs: false,
      setup(_, { slots, attrs }) {
        return () => (warm.value ? h(VnWindow, { ...attrs, ref: viewer }, slots) : null);
      },
    }),
  );

  onMounted(() => {
    const make = () => (warm.value = true);
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(make, { timeout: 3000 });
    else setTimeout(make, 1500);
  });

  function onShow(e: { width: number; height: number; scale?: number }) {
    onResize(e);
    // On screen with the picture over its thumbnail: now it grows into place.
    if (fromThumb.value) requestAnimationFrame(() => (fromThumb.value = null));
  }

  function onResize(e: { width: number; height: number; scale?: number }) {
    // A hidden viewer waits small; only a shown one's size is the monitor's.
    if (!shown.value || e.width <= 0 || e.height <= 0) return;
    viewport.width = e.width;
    viewport.height = e.height;
    if (e.scale && e.scale > 0) scale = e.scale;
  }

  /** The picture's box: its own size within 90 % × 85 % of the viewer, as `max-width: 90vw` says in a page. */
  function fitted(item: ChatMediaItem | undefined): { width: number; height: number } | null {
    const w = item?.width ?? 0;
    const hh = item?.height ?? 0;
    if (!(w > 0 && hh > 0) || !viewport.width) return null;
    const k = Math.min(1, (0.9 * viewport.width) / w, (0.85 * viewport.height) / hh);
    return { width: w * k, height: hh * k };
  }

  /** The transform that puts the fitted picture over its thumbnail in the main window, if it is there. */
  function thumbTransform(): string | null {
    const item = src.item();
    const fit = fitted(item);
    if (!item || src.video() || !viewer.value || !fit) return null;
    const thumb = document.querySelector(`[data-attachment-id="${item.fileId}"]`);
    const rect = thumb ? viewer.value.mapFromMain(thumb) : null;
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const dx = rect.x + rect.width / 2 - viewport.width / 2;
    const dy = rect.y + rect.height / 2 - viewport.height / 2;
    const s = Math.max(rect.width / fit.width, rect.height / fit.height);
    return `translate(${dx}px, ${dy}px) scale(${s})`;
  }

  function zoomReset() {
    zoom.value = 1;
    pan.x = 0;
    pan.y = 0;
    drag = null;
    dragging.value = false;
  }

  /**
   * The picture's box before its transform — its parent's, which is sized to it and centred in the
   * viewer — in the viewer's CSS px. The zoom and the pan are worked out about its centre, which is
   * where the transform's origin is.
   */
  function frame(): { cx: number; cy: number; w: number; h: number } | null {
    const box = picture?.parentElement?.getBoundingClientRect();
    if (!box || !(box.width > 0 && box.height > 0)) return null;
    return { cx: box.left + box.width / 2, cy: box.top + box.height / 2, w: box.width, h: box.height };
  }

  /**
   * Telegram's clamp, per axis: a picture bigger than the viewer pans no further than its edges, so no
   * dim comes in at a side; one that fits is centred.
   */
  function clampPan() {
    const f = frame();
    if (!f || !viewport.width) return;
    const axis = (p: number, size: number, centre: number, view: number) => {
      const s = size * zoom.value;
      if (s <= view) return view / 2 - centre;
      return Math.min(s / 2 - centre, Math.max(view - centre - s / 2, p));
    };
    pan.x = axis(pan.x, f.w, f.cx, viewport.width);
    pan.y = axis(pan.y, f.h, f.cy, viewport.height);
  }

  /** Zooms to `z`, keeping the picture's point under (`x`, `y`) where it is, then clamps. */
  function zoomAt(z: number, x: number, y: number) {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    const f = frame();
    if (next === 1 || !f) return zoomReset();
    const ox = x - f.cx;
    const oy = y - f.cy;
    const k = next / zoom.value;
    pan.x = ox - (ox - pan.x) * k;
    pan.y = oy - (oy - pan.y) * k;
    zoom.value = next;
    clampPan();
  }

  /** Ctrl+wheel zooms; a plain wheel does what Electron's viewer does with it, nothing. */
  function onWheel(e: WheelEvent) {
    if (src.video() || !e.ctrlKey) return;
    e.preventDefault();
    zoomAt(zoom.value * Math.exp(-e.deltaY * WHEEL_RATE), e.clientX, e.clientY);
  }

  function onDragStart(e: MouseEvent) {
    dragged = false;
    if (zoom.value <= 1 || e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    dragging.value = true;
  }

  function onDragMove(e: MouseEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) dragged = true;
    pan.x = drag.px + dx;
    pan.y = drag.py + dy;
    clampPan();
  }

  function onDragEnd() {
    drag = null;
    dragging.value = false;
  }

  function onDblclick(e: MouseEvent) {
    if (zoom.value > 1.01) return zoomReset();
    const drawn = frame()?.w ?? 0;
    const natural = (e.currentTarget as HTMLImageElement).naturalWidth || src.item()?.width || 0;
    // One picture pixel per screen pixel: the picture's own width over its drawn width in device px.
    const oneToOne = drawn > 0 && natural > 0 ? natural / (drawn * scale) : 2;
    zoomAt(oneToOne > 1.01 ? oneToOne : 2, e.clientX, e.clientY);
  }

  /** What the viewer's elements take, by `v-bind`: the window's props, and the overlay's, content's and picture's. */
  const bind = reactive({
    host: computed(() => ({
      title: "Argon",
      visible: shown.value,
      cover: "monitor",
      taskbar: false,
      fullResolution: true,
      activate: true,
      alwaysOnTop: TOPMOST && shown.value,
      chrome: "hidden",
      resizable: false,
      backdrop: "transparent",
      onShow,
      onResize,
    })),
    // The overlay is the window's whole content, so the window's root places it.
    // Every press starts with no drag: one that ended over the picture leaves no
    // swallowed click behind for the dim.
    overlay: computed(() => ({
      style: { position: "absolute" as const },
      onWheel,
      onMousedown: () => (dragged = false),
      onMousemove: onDragMove,
      onMouseup: onDragEnd,
    })),
    content: computed(() =>
      viewport.width > 0 ? { style: { maxWidth: `${0.9 * viewport.width}px`, maxHeight: `${0.9 * viewport.height}px` } } : {},
    ),
    image: computed(() => ({
      ref: setPicture,
      style: {
        ...(viewport.width > 0 ? { maxWidth: `${0.9 * viewport.width}px`, maxHeight: `${0.85 * viewport.height}px` } : {}),
        transform: fromThumb.value ?? `translate(${pan.x}px, ${pan.y}px) scale(${zoom.value})`,
        transition: dragging.value ? "opacity 0.2s ease" : "opacity 0.2s ease, transform 0.2s ease",
        cursor: zoom.value > 1 ? (dragging.value ? "grabbing" : "grab") : "auto",
      },
      onMousedown: onDragStart,
      onDblclick,
    })),
  });

  return {
    Host,
    bind,
    /** The viewer opened: the window shows, over the main window's monitor. */
    opened() {
      warm.value = true;
      // The main window's monitor is the one it covers. The show's own size follows.
      viewport.width = window.screen.width;
      viewport.height = window.screen.height;
      shown.value = true;
      zoomReset();
      fromThumb.value = thumbTransform();
    },
    /** Another picture: back to the fit. */
    stepped: zoomReset,
    /** Whether the click about to close the viewer ends a drag — it is not a click on the dim then. Asks once. */
    consumeDrag(): boolean {
      const was = dragged;
      dragged = false;
      return was;
    },
    /** Before the close: the picture shrinks back toward its thumbnail as the viewer fades. A frame
     *  first, because a leaving element is no longer patched. */
    async beforeClose() {
      if (fromThumb.value) return;
      fromThumb.value = thumbTransform();
      if (fromThumb.value) await nextTick();
    },
    /** The leave transition ended: the window hides. */
    afterLeave() {
      shown.value = false;
      fromThumb.value = null;
    },
    /** The video's width: its own, within 90 % × 85 % of the viewer and at least `min`. */
    videoWidth(w: number, hh: number, min: number): string | null {
      if (!(viewport.width > 0)) return null;
      return `${Math.min(Math.max(w, min), 0.9 * viewport.width, 0.85 * viewport.height * (w / hh))}px`;
    },
  };
}
