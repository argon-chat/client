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
};

export async function loadTexture({ device, mediaSrc, mediaType, videoTime, videoPosition, waitToSeek }: LoadTextureArgs): Promise<LoadTextureResult> {
  let media: LoadTextureMedia;

  if (mediaType === 'image') {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = mediaSrc;
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => reject(new Error('The image could not be decoded')), { once: true });
    });

    media = {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight
    };
  } else {
    const video = await createVideoForDrawing(mediaSrc, videoTime, videoPosition, waitToSeek);
    media = {
      video,
      width: video.videoWidth,
      height: video.videoHeight
    };
  }

  const texture = device.createTexture({
    size: [media.width, media.height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });

  // Premultiplied, so linear filtering at a transparent edge does not blend in the (usually black)
  // colour of the transparent texels; the fragment shader un-premultiplies for its colour maths.
  const source = media.video ?? media.image!;
  device.queue.copyExternalImageToTexture(
    { source, flipY: false },
    { texture, premultipliedAlpha: true },
    [media.width, media.height]
  );

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge'
  });

  return { texture, sampler, media };
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

async function createVideoForDrawing(src: string, time: number, position: number | undefined, waitToSeek?: boolean): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;

  await new Promise<void>((resolve) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
  });

  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const currentTime = position !== undefined ? Math.min(duration, Math.max(0, position) * duration) : time;
  if (currentTime > 0 || waitToSeek) {
    video.currentTime = currentTime;
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
    });
  }

  return video;
}
