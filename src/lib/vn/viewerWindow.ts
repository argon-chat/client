/**
 * The media viewer's own window under vue-native (vue-native docs/MULTIWINDOW.md §7.9). It works the
 * way Telegram Desktop's viewer does:
 *
 * - a window with no frame over the whole monitor the main window is on;
 * - owned by the main window: no taskbar button, one Alt-Tab entry;
 * - dimmed per pixel over whatever is behind it.
 *
 * The window is made hidden once the app is idle, and an open SHOWS it: a frame, not a window. The
 * picture grows out of its thumbnail and shrinks back into it. The wheel zooms about the pointer, a
 * drag pans a zoomed picture, and a double click goes between the fit and one picture pixel per
 * screen pixel. The pictures keep their full decode while the viewer shows them.
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
  const zoom = ref(1);
  const pan = reactive({ x: 0, y: 0 });
  const dragging = ref(false);
  let drag: { x: number; y: number; px: number; py: number } | null = null;
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

  function onShow(e: { width: number; height: number }) {
    onResize(e);
    // On screen with the picture over its thumbnail: now it grows into place.
    if (fromThumb.value) requestAnimationFrame(() => (fromThumb.value = null));
  }

  function onResize(e: { width: number; height: number }) {
    // A hidden viewer waits small; only a shown one's size is the monitor's.
    if (!shown.value || e.width <= 0 || e.height <= 0) return;
    viewport.width = e.width;
    viewport.height = e.height;
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

  /** Zooms to `z`, keeping the picture's point under (`x`, `y`) where it is. The picture is centred. */
  function zoomAt(z: number, x: number, y: number) {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    if (next === 1) return zoomReset();
    const ox = x - viewport.width / 2;
    const oy = y - viewport.height / 2;
    const k = next / zoom.value;
    pan.x = ox - (ox - pan.x) * k;
    pan.y = oy - (oy - pan.y) * k;
    zoom.value = next;
  }

  function onWheel(e: WheelEvent) {
    if (src.video()) return;
    e.preventDefault();
    zoomAt(zoom.value * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }

  function onDragStart(e: MouseEvent) {
    if (zoom.value <= 1 || e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    dragging.value = true;
  }

  function onDragMove(e: MouseEvent) {
    if (!drag) return;
    pan.x = drag.px + e.clientX - drag.x;
    pan.y = drag.py + e.clientY - drag.y;
  }

  function onDragEnd() {
    drag = null;
    dragging.value = false;
  }

  function onDblclick(e: MouseEvent) {
    if (zoom.value > 1.01) return zoomReset();
    const img = e.currentTarget as HTMLImageElement;
    const drawn = img.getBoundingClientRect().width;
    const natural = img.naturalWidth || src.item()?.width || 0;
    const oneToOne = drawn > 0 && natural > 0 ? natural / (drawn * window.devicePixelRatio) : 2;
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
    overlay: computed(() => ({ style: { position: "absolute" as const }, onWheel, onMousemove: onDragMove, onMouseup: onDragEnd })),
    content: computed(() =>
      viewport.width > 0 ? { style: { maxWidth: `${0.9 * viewport.width}px`, maxHeight: `${0.9 * viewport.height}px` } } : {},
    ),
    image: computed(() => ({
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
