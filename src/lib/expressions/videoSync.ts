// Video custom emoji: one hidden <video> per fileId, blitted into every placeholder's canvas, so all
// copies show the same frame and only one decoder runs (the idea of emojix's VideoSyncManager).

import { getAnimationIntersector, type AnimationControl, type AnimationIntersector } from "./animationIntersector";
import { applyColorOnContext } from "./tint";

export interface VideoEmojiOptions {
  group?: string;
  /** The tint, read at draw time; null for none. */
  color?: () => string | null;
  crossOrigin?: "anonymous" | undefined;
  intersector?: AnimationIntersector;
  /** Once, when this canvas first shows a frame. */
  onFirstDraw?: () => void;
}

export interface VideoEmojiLease {
  setVisible(visible: boolean): void;
  /** Draws the current frame again (after a resize or a colour change). */
  redraw(): void;
  release(): void;
}

interface Target {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  color?: () => string | null;
  visible: boolean;
  onFirstDraw?: () => void;
}

interface Master {
  fileId: string;
  video: HTMLVideoElement;
  targets: Set<Target>;
  control: AnimationControl;
  raf: number | null;
}

const masters = new Map<string, Master>();
let hiddenHost: HTMLDivElement | null = null;

function host(): HTMLDivElement {
  if (!hiddenHost || !hiddenHost.isConnected) {
    hiddenHost = document.createElement("div");
    hiddenHost.setAttribute("aria-hidden", "true");
    hiddenHost.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;";
    document.body.appendChild(hiddenHost);
  }
  return hiddenHost;
}

function draw(master: Master, target: Target) {
  const { video } = master;
  const { ctx, canvas } = target;
  if (!ctx || video.readyState < 2) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const color = target.color?.();
  if (color) applyColorOnContext(ctx, color, 0, 0, canvas.width, canvas.height);
  if (target.onFirstDraw) {
    const once = target.onFirstDraw;
    target.onFirstDraw = undefined;
    once();
  }
}

function drawAll(master: Master) {
  for (const target of master.targets) if (target.visible) draw(master, target);
}

function startLoop(master: Master) {
  if (master.raf !== null) return;
  const tick = () => {
    if (master.video.paused || !masters.has(master.fileId)) {
      master.raf = null;
      return;
    }
    drawAll(master);
    master.raf = requestAnimationFrame(tick);
  };
  master.raf = requestAnimationFrame(tick);
}

function stopLoop(master: Master) {
  if (master.raf !== null) cancelAnimationFrame(master.raf);
  master.raf = null;
}

function createMaster(fileId: string, url: string, options: VideoEmojiOptions): Master {
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  if (options.crossOrigin) video.crossOrigin = options.crossOrigin;
  video.src = url;

  const master: Master = { fileId, video, targets: new Set(), control: null!, raf: null };
  master.control = (options.intersector ?? getAnimationIntersector()).add({
    el: null,
    group: options.group ?? "emoji",
    autoplay: true,
    initiallyVisible: false,
    setPlaying: (playing) => {
      if (playing) video.play().catch(() => {});
      else video.pause();
    },
  });

  video.addEventListener("loadeddata", () => drawAll(master));
  video.addEventListener("seeked", () => drawAll(master));
  video.addEventListener("playing", () => startLoop(master));
  video.addEventListener("pause", () => stopLoop(master));
  host().appendChild(video);
  return master;
}

function destroyMaster(master: Master) {
  stopLoop(master);
  master.control.remove();
  master.video.pause();
  master.video.removeAttribute("src");
  master.video.load();
  master.video.remove();
  masters.delete(master.fileId);
}

export function registerVideoEmoji(
  fileId: string,
  url: string,
  canvas: HTMLCanvasElement,
  options: VideoEmojiOptions = {},
): VideoEmojiLease {
  let master = masters.get(fileId);
  if (!master) {
    master = createMaster(fileId, url, options);
    masters.set(fileId, master);
  }
  const owner = master;
  const target: Target = {
    canvas,
    ctx: canvas.getContext("2d"),
    color: options.color,
    visible: false,
    onFirstDraw: options.onFirstDraw,
  };
  owner.targets.add(target);

  const syncVisibility = () => {
    let visible = false;
    for (const t of owner.targets) if ((visible = t.visible)) break;
    owner.control.setVisible(visible);
  };

  return {
    setVisible(visible) {
      if (target.visible === visible) return;
      target.visible = visible;
      if (visible) draw(owner, target);
      syncVisibility();
    },
    redraw() {
      draw(owner, target);
    },
    release() {
      if (!owner.targets.delete(target)) return;
      if (owner.targets.size) syncVisibility();
      else destroyMaster(owner);
    },
  };
}

export function videoEmojiMasterCount(): number {
  return masters.size;
}
