import type { MediaType } from '../types';

export type LoadTextureMedia = {
  width: number;
  height: number;
  image?: HTMLImageElement;
  video?: HTMLVideoElement;
};

export type LoadTextureResult = {
  texture: GPUTexture;
  sampler: GPUSampler;
  media: LoadTextureMedia;
};

type LoadTextureArgs = {
  device: GPUDevice;
  mediaSrc: string;
  mediaType: MediaType;
  /** Seconds. */
  videoTime: number;
  /** 0..1 of the duration; takes precedence over `videoTime`. */
  videoPosition?: number;
  waitToSeek?: boolean;
  signal?: AbortSignal;
};

/** Release decoded media even when initialization failed before a GPU payload existed. */
export function releaseMedia(media: LoadTextureMedia): void {
  const { video, image } = media;
  media.video = undefined;
  media.image = undefined;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.srcObject = null;
    video.load();
  }
  image?.removeAttribute('src');
}

function waitForMedia(target: EventTarget, type: string, begin: () => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(type, success);
      target.removeEventListener('error', error);
      signal?.removeEventListener('abort', abort);
    };
    const success = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(new Error('The media could not be decoded')); };
    const abort = () => { cleanup(); reject(signal?.reason ?? new DOMException('Media load aborted', 'AbortError')); };
    if (signal?.aborted) { abort(); return; }
    target.addEventListener(type, success, { once: true });
    target.addEventListener('error', error, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    try { begin(); } catch (e) { cleanup(); reject(e); }
  });
}

export async function loadTexture({ device, mediaSrc, mediaType, videoTime, videoPosition, waitToSeek, signal }: LoadTextureArgs): Promise<LoadTextureResult> {
  const media: LoadTextureMedia = { width: 0, height: 0 };
  let texture: GPUTexture | undefined;
  try {
    signal?.throwIfAborted();
    if (mediaType === 'image') {
      const image = new Image();
      media.image = image;
      image.crossOrigin = 'anonymous';
      await waitForMedia(image, 'load', () => { image.src = mediaSrc; }, signal);
      media.width = image.naturalWidth;
      media.height = image.naturalHeight;
    } else {
      const video = document.createElement('video');
      media.video = video;
      await prepareVideo(video, mediaSrc, videoTime, videoPosition, waitToSeek, signal);
      media.width = video.videoWidth;
      media.height = video.videoHeight;
    }
    signal?.throwIfAborted();
    texture = device.createTexture({
      size: [media.width, media.height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // Premultiplied filtering avoids dark fringes at transparent image edges.
    device.queue.copyExternalImageToTexture(
      { source: media.video ?? media.image!, flipY: false },
      { texture, premultipliedAlpha: true }, [media.width, media.height],
    );
    const sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    return { texture, sampler, media };
  } catch (error) {
    try { texture?.destroy(); } catch { /* Preserve the upload/decode error. */ }
    try { releaseMedia(media); } catch { /* Every ownership edge is already cleared. */ }
    throw error;
  }
}

export function updateVideoTexture(device: GPUDevice, texture: GPUTexture, video: HTMLVideoElement): void {
  device.queue.copyExternalImageToTexture(
    { source: video, flipY: false },
    { texture, premultipliedAlpha: true },
    [video.videoWidth, video.videoHeight]
  );
}

/** A decoded frame (already at the texture's size) into the texture. */
export function updateFrameTexture(device: GPUDevice, texture: GPUTexture, frame: HTMLCanvasElement | OffscreenCanvas): void {
  device.queue.copyExternalImageToTexture(
    { source: frame, flipY: false },
    { texture, premultipliedAlpha: true },
    [texture.width, texture.height]
  );
}

async function prepareVideo(video: HTMLVideoElement, src: string, time: number, position: number | undefined, waitToSeek?: boolean, signal?: AbortSignal): Promise<void> {
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  await waitForMedia(video, 'loadeddata', () => { video.src = src; }, signal);
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const currentTime = position !== undefined ? Math.min(duration, Math.max(0, position) * duration) : time;
  // loadeddata already supplies the current frame. Seeking to the unchanged
  // position need not fire seeked, including the initial cover at zero.
  if ((currentTime > 0 || waitToSeek) && (video.currentTime !== currentTime || video.seeking)) {
    await waitForMedia(video, 'seeked', () => { video.currentTime = currentTime; }, signal);
  }
}
