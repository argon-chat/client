import { onBeforeUnmount, onMounted, type Ref } from "vue";
import { acquireCustomEmoji, CUSTOM_EMOJI_GROUP, type CustomEmojiLease } from "@/lib/expressions/customEmojiRegistry";
import { registerVideoEmoji, type VideoEmojiLease } from "@/lib/expressions/videoSync";
import { ExpressionFormat } from "@/lib/expressions/types";
import { applyColorOnContext } from "@/lib/expressions/tint";
import { clampPixelRatio } from "@/lib/expressions/lottie/LottiePool";
import { isLottieSupported } from "@/lib/expressions/lottie/support";
import { customEmojiSize } from "@/lib/expressions/sizes";
import { cdnCrossOrigin, cdnFetchUrl, cdnUrl } from "@/store/system/fileStorage";

/** A placeholder: `<span class="ce" data-ce-file data-ce-format [data-ce-text-color] [data-ce-thumb]>`. */
export const CUSTOM_EMOJI_SELECTOR = ".ce[data-ce-file]";

export interface CustomEmojiOverlayOptions {
  /** Playback group of the emoji players (shared across overlays). */
  group?: string;
  /** Display URL of a file (an `<img>`/`<video>` src). Default `cdnUrl`. */
  resolveUrl?: (fileId: string) => string;
  /** URL tried when the display URL cannot be fetched (bytes). Default `cdnFetchUrl`. */
  resolveFetchUrl?: (fileId: string) => string | null;
  crossOrigin?: (url: string) => "anonymous" | undefined;
}

interface Placeholder {
  el: HTMLElement;
  fileId: string;
  format: number;
  tinted: boolean;
  thumbFileId: string | null;
  size: number;
  visible: boolean;
  lottie: CustomEmojiLease | null;
  video: VideoEmojiLease | null;
  child: HTMLElement | null;
  drawn: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

const WATCHED_ATTRIBUTES = ["data-ce-file", "data-ce-format", "data-ce-text-color", "data-ce-thumb"];

/**
 * Custom emoji inside `container`. Static ones get an `<img>` in their placeholder (a mask of the
 * text colour when tinted). Video ones get a canvas fed by one shared `<video>` per file. Lottie
 * ones are drawn on `canvas`, laid over the container: one player per file and size, shared by every
 * overlay on screen, its latest frame drawn at each placeholder's rect. Drawing runs on
 * requestAnimationFrame, only when a frame arrived or the layout moved, and only while a Lottie
 * placeholder is visible.
 *
 * The canvas covers the container's box, so the container is expected not to scroll itself.
 */
export function useCustomEmojiOverlay(
  container: Ref<HTMLElement | null>,
  canvas: Ref<HTMLCanvasElement | null>,
  options: CustomEmojiOverlayOptions = {},
) {
  const resolveUrl = options.resolveUrl ?? ((fileId: string) => cdnUrl(fileId));
  const resolveFetchUrl = options.resolveFetchUrl ?? ((fileId: string) => cdnFetchUrl(fileId));
  const crossOrigin = options.crossOrigin ?? cdnCrossOrigin;
  const group = options.group ?? CUSTOM_EMOJI_GROUP;

  const placeholders = new Map<HTMLElement, Placeholder>();
  let io: IntersectionObserver | null = null;
  let mo: MutationObserver | null = null;
  let ro: ResizeObserver | null = null;
  let raf = 0;
  let layoutDirty = true;
  let drawDirty = true;
  let visibleLottie = 0;
  let scrollListening = false;
  let dpr = 1;
  let color = "";
  let disposed = false;
  /** Something is on the canvas: it must be redrawn when a placeholder goes, even with none visible. */
  let painted = false;

  const textColor = () => color || (container.value ? getComputedStyle(container.value).color : "");

  function sizeOf(el: HTMLElement): number {
    const fromVar = parseFloat(getComputedStyle(el).getPropertyValue("--ce-size"));
    if (fromVar > 0) return Math.round(fromVar);
    const width = el.getBoundingClientRect().width;
    return width > 0 ? Math.round(width) : customEmojiSize();
  }

  function markReady(p: Placeholder) {
    if (!p.el.hasAttribute("data-ce-ready")) p.el.setAttribute("data-ce-ready", "");
  }

  function appendImage(p: Placeholder, fileId: string) {
    const url = resolveUrl(fileId);
    let child: HTMLElement;
    if (p.tinted) {
      child = document.createElement("span");
      child.className = "ce-mask";
      child.style.setProperty("-webkit-mask-image", `url("${url}")`);
      child.style.setProperty("mask-image", `url("${url}")`);
      markReady(p);
    } else {
      const img = document.createElement("img");
      img.className = "ce-img";
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      const co = crossOrigin(url);
      if (co) img.crossOrigin = co;
      img.addEventListener("load", () => markReady(p), { once: true });
      img.src = url;
      child = img;
    }
    p.child = child;
    p.el.appendChild(child);
  }

  function fallbackToThumb(p: Placeholder) {
    if (p.lottie) {
      if (p.visible) visibleLottie--;
      p.lottie.release();
      p.lottie = null;
      updateScrollListener();
    }
    if (!p.thumbFileId || p.child) return;
    p.el.setAttribute("data-ce-fallback", "");
    appendImage(p, p.thumbFileId);
  }

  function attach(el: HTMLElement): Placeholder {
    const p: Placeholder = {
      el,
      fileId: el.dataset.ceFile ?? "",
      format: Number(el.dataset.ceFormat ?? ExpressionFormat.Static),
      tinted: el.hasAttribute("data-ce-text-color"),
      thumbFileId: el.dataset.ceThumb || null,
      size: sizeOf(el),
      visible: false,
      lottie: null,
      video: null,
      child: null,
      drawn: false,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };

    if (p.format === ExpressionFormat.Lottie) {
      if (isLottieSupported()) {
        p.lottie = acquireCustomEmoji(
          { fileId: p.fileId, size: p.size, url: resolveUrl(p.fileId), fallbackUrl: resolveFetchUrl(p.fileId), group },
          () => onFrame(p),
        );
        if (p.lottie.failed) fallbackToThumb(p);
      } else {
        fallbackToThumb(p);
      }
    } else if (p.format === ExpressionFormat.Video) {
      const url = resolveUrl(p.fileId);
      const videoCanvas = document.createElement("canvas");
      videoCanvas.className = "ce-video";
      const backing = Math.round(p.size * clampPixelRatio(devicePixelRatio));
      videoCanvas.width = backing;
      videoCanvas.height = backing;
      p.child = videoCanvas;
      el.appendChild(videoCanvas);
      p.video = registerVideoEmoji(p.fileId, url, videoCanvas, {
        group,
        crossOrigin: crossOrigin(url),
        color: p.tinted ? textColor : undefined,
        onFirstDraw: () => markReady(p),
      });
    } else {
      appendImage(p, p.fileId);
    }

    placeholders.set(el, p);
    io?.observe(el);
    return p;
  }

  function detach(p: Placeholder) {
    placeholders.delete(p.el);
    io?.unobserve(p.el);
    if (p.visible) visibilityChanged(p, false);
    p.lottie?.release();
    p.video?.release();
    p.lottie = null;
    p.video = null;
    if (p.child?.parentNode === p.el) p.el.removeChild(p.child);
    p.child = null;
    p.el.removeAttribute("data-ce-ready");
    p.el.removeAttribute("data-ce-fallback");
  }

  function sameSource(p: Placeholder, el: HTMLElement) {
    return (
      p.fileId === (el.dataset.ceFile ?? "") &&
      p.format === Number(el.dataset.ceFormat ?? ExpressionFormat.Static) &&
      p.tinted === el.hasAttribute("data-ce-text-color") &&
      p.thumbFileId === (el.dataset.ceThumb || null)
    );
  }

  function scan() {
    const root = container.value;
    if (!root || disposed) return;
    const found = new Set<HTMLElement>(root.querySelectorAll<HTMLElement>(CUSTOM_EMOJI_SELECTOR));
    for (const p of [...placeholders.values()]) {
      if (!found.has(p.el) || !sameSource(p, p.el)) detach(p);
    }
    for (const el of found) if (!placeholders.has(el)) attach(el);
    invalidate(true);
  }

  function visibilityChanged(p: Placeholder, visible: boolean) {
    if (p.visible === visible) return;
    p.visible = visible;
    if (p.lottie) {
      visibleLottie += visible ? 1 : -1;
      p.lottie.setVisible(visible);
    }
    p.video?.setVisible(visible);
    updateScrollListener();
    invalidate(true);
  }

  function onFrame(p: Placeholder) {
    if (p.lottie?.failed) {
      fallbackToThumb(p);
      invalidate(false);
      return;
    }
    if (p.visible) invalidate(false);
  }

  function onLayoutChange() {
    invalidate(true);
  }

  function updateScrollListener() {
    const want = visibleLottie > 0 && !disposed;
    if (want === scrollListening) return;
    scrollListening = want;
    if (want) {
      window.addEventListener("scroll", onLayoutChange, { capture: true, passive: true });
      window.addEventListener("resize", onLayoutChange, { passive: true });
    } else {
      window.removeEventListener("scroll", onLayoutChange, { capture: true });
      window.removeEventListener("resize", onLayoutChange);
    }
  }

  function invalidate(layout: boolean) {
    if (layout) layoutDirty = true;
    drawDirty = true;
    if (!raf && (visibleLottie > 0 || painted) && !disposed) raf = requestAnimationFrame(tick);
  }

  function tick() {
    raf = 0;
    if (disposed) return;
    if (layoutDirty) measure();
    if (drawDirty) draw();
  }

  function measure() {
    layoutDirty = false;
    const target = canvas.value;
    const root = container.value;
    if (!target || !root) return;
    dpr = clampPixelRatio(devicePixelRatio);
    const width = Math.round(target.clientWidth * dpr);
    const height = Math.round(target.clientHeight * dpr);
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    color = getComputedStyle(root).color;

    const base = target.getBoundingClientRect();
    for (const p of placeholders.values()) {
      if (!p.lottie || !p.visible) continue;
      const r = p.el.getBoundingClientRect();
      p.x = r.left - base.left;
      p.y = r.top - base.top;
      p.w = r.width;
      p.h = r.height;
    }
  }

  function draw() {
    drawDirty = false;
    const target = canvas.value;
    const ctx = target?.getContext("2d");
    if (!target || !ctx) return;
    ctx.clearRect(0, 0, target.width, target.height);
    painted = false;
    for (const p of placeholders.values()) {
      if (!p.lottie || !p.visible || !p.w || !p.h) continue;
      const frame = p.lottie.frame();
      if (!frame) continue;
      const x = Math.round(p.x * dpr);
      const y = Math.round(p.y * dpr);
      const w = Math.round(p.w * dpr);
      const h = Math.round(p.h * dpr);
      ctx.drawImage(frame, x, y, w, h);
      if (p.tinted) applyColorOnContext(ctx, color, x, y, w, h);
      painted = true;
      if (!p.drawn) {
        p.drawn = true;
        markReady(p);
      }
    }
  }

  onMounted(() => {
    const root = container.value;
    if (!root) return;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (records) => {
          for (const record of records) {
            const p = placeholders.get(record.target as HTMLElement);
            if (p) visibilityChanged(p, record.isIntersecting);
          }
        },
        { rootMargin: "64px" },
      );
    }
    mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: WATCHED_ATTRIBUTES });
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onLayoutChange);
      ro.observe(root);
    }
    scan();
  });

  onBeforeUnmount(() => {
    mo?.disconnect();
    ro?.disconnect();
    for (const p of [...placeholders.values()]) detach(p);
    io?.disconnect();
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    updateScrollListener();
  });

  return {
    /** Looks for placeholders again (the MutationObserver does this on its own). */
    rescan: scan,
    /** Measures and draws on the next frame. */
    redraw: () => invalidate(true),
    stats: () => {
      let lottie = 0;
      let video = 0;
      let still = 0;
      for (const p of placeholders.values()) {
        if (p.lottie) lottie++;
        else if (p.video) video++;
        else still++;
      }
      return { placeholders: placeholders.size, lottie, video, static: still, visibleLottie };
    },
  };
}
