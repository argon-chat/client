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
  videoTime: number;
  waitToSeek?: boolean;
};

export async function loadTexture({ device, mediaSrc, mediaType, videoTime, waitToSeek }: LoadTextureArgs): Promise<LoadTextureResult> {
  let media: LoadTextureMedia;

  if (mediaType === 'image') {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = mediaSrc;
    await new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
    });

    media = {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight
    };
  } else {
    const video = await createVideoForDrawing(mediaSrc, videoTime, waitToSeek);
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

  const source = media.video ?? media.image!;
  device.queue.copyExternalImageToTexture(
    { source, flipY: false },
    { texture },
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
    { texture },
    [video.videoWidth, video.videoHeight]
  );
}

async function createVideoForDrawing(src: string, currentTime: number, waitToSeek?: boolean): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = src;

  await new Promise<void>((resolve) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true });
  });

  if (currentTime > 0 || waitToSeek) {
    video.currentTime = currentTime;
    await new Promise<void>((resolve) => {
      video.addEventListener('seeked', () => resolve(), { once: true });
    });
  }

  return video;
}
