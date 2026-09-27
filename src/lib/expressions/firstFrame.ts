import { getLottiePool, type LottiePool } from "./lottie/LottiePool";
import { alphaOf, traceOutline } from "./outlineTrace";

// First frames of files about to be uploaded: a Lottie rendered by the worker pool, a WEBM through a
// <video>. Each becomes the item's thumbnail (a WEBP at the item's own size) and its outline.

const FRAME_TIMEOUT_MS = 10_000;

let uploadSeq = 0;

/** Frame 0 of a TGS / Lottie JSON at exactly width×height pixels; the caller closes it. */
export function lottieFirstFrame(
  bytes: ArrayBuffer,
  width: number,
  height: number,
  pool: LottiePool = getLottiePool(),
): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (fn: () => void, bitmap?: ImageBitmap) => {
      if (settled) {
        bitmap?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      queueMicrotask(() => player.destroy());
      fn();
    };
    const player = pool.createPlayer({
      fileId: `upload-${++uploadSeq}`,
      load: async () => bytes,
      width,
      height,
      pixelRatio: 1,
      observe: false,
      autoplay: false,
      initiallyVisible: false,
      loop: false,
      onFirstFrame: (bitmap) => settle(() => resolve(bitmap), bitmap),
      onError: (error) => settle(() => reject(error)),
    });
    timer = setTimeout(() => settle(() => reject(new Error("first frame timed out"))), FRAME_TIMEOUT_MS);
  });
}

function once(target: EventTarget, ok: string, fail = "error", timeoutMs = FRAME_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      target.removeEventListener(fail, onFail);
      if (error) reject(error);
      else resolve();
    };
    const onOk = () => done();
    const onFail = () => done(new Error(`media ${fail}`));
    const timer = setTimeout(() => done(new Error(`media ${ok} timed out`)), timeoutMs);
    target.addEventListener(ok, onOk);
    target.addEventListener(fail, onFail);
  });
}

interface LoadedVideo {
  element: HTMLVideoElement;
  release: () => void;
}

async function loadVideo(blob: Blob): Promise<LoadedVideo> {
  const url = URL.createObjectURL(blob);
  const element = document.createElement("video");
  const release = () => {
    element.removeAttribute("src");
    element.load();
    URL.revokeObjectURL(url);
  };
  element.muted = true;
  element.playsInline = true;
  element.preload = "auto";
  try {
    const loaded = once(element, "loadeddata");
    element.src = url;
    await loaded;
    return { element, release };
  } catch (e) {
    release();
    throw e;
  }
}

/** A WEBM's canvas and length (seconds; null when the file does not say, as MediaRecorder output). */
export async function probeVideo(blob: Blob): Promise<{ width: number; height: number; duration: number | null }> {
  const { element, release } = await loadVideo(blob);
  try {
    const duration = Number.isFinite(element.duration) ? element.duration : null;
    return { width: element.videoWidth, height: element.videoHeight, duration };
  } finally {
    release();
  }
}

/** The video element showing frame 0; `release` frees it. */
export async function videoFirstFrame(blob: Blob): Promise<LoadedVideo> {
  const video = await loadVideo(blob);
  try {
    const seeked = once(video.element, "seeked");
    video.element.currentTime = 0;
    await seeked;
    return video;
  } catch (e) {
    video.release();
    throw e;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * `frame` drawn at width×height: a WEBP of it no larger than `maxThumbBytes` (null where the browser
 * cannot encode WEBP, or cannot get it small enough) and the outline of its alpha.
 */
export async function snapshotFrame(
  frame: CanvasImageSource,
  width: number,
  height: number,
  maxThumbBytes: number,
): Promise<{ thumb: Blob | null; outline: Uint8Array | null }> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { thumb: null, outline: null };
  ctx.drawImage(frame, 0, 0, width, height);

  let outline: Uint8Array | null = null;
  try {
    outline = traceOutline(alphaOf(ctx.getImageData(0, 0, width, height).data), width, height);
  } catch {
    outline = null;
  }

  let thumb: Blob | null = null;
  for (const quality of [0.92, 0.8, 0.6, 0.4]) {
    const blob = await toBlob(canvas, "image/webp", quality);
    // A browser without a WEBP encoder hands back a PNG, which the server would refuse.
    if (!blob || blob.type !== "image/webp") break;
    if (blob.size <= maxThumbBytes) {
      thumb = blob;
      break;
    }
  }
  return { thumb, outline };
}
