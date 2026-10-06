import type { MediaType, Vec2 } from '../types';
import { initDevice, getPreferredFormat } from './initDevice';
import { initPipeline } from './initPipeline';
import { createVertexBuffer, createUniformBuffer } from './initBuffers';
import { loadTexture, type LoadTextureMedia } from './loadTexture';
import { createStickerCompositor, type StickerCompositor } from './stickerCompositor';

export type RenderingPayload = {
  device: GPUDevice;
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  vertexBuffer: GPUBuffer;
  uniformBuffer: GPUBuffer;
  texture: GPUTexture;
  /** Alpha multiplier in source space; 1×1 white when nothing is masked. */
  maskTexture: GPUTexture;
  /** Eraser colours in source space, premultiplied (alpha: how much); 1×1 transparent when none. */
  colourTexture: GPUTexture;
  sampler: GPUSampler;
  bindGroup: GPUBindGroup;
  media: LoadTextureMedia;
  /** Present when the canvas is transparent (sticker modes). */
  compositor?: StickerCompositor;
};

type InitWebGPUArgs = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  mediaSrc: string;
  mediaType: MediaType;
  /** Seconds. */
  videoTime: number;
  /** 0..1 of the video's duration; takes precedence over `videoTime`. */
  videoPosition?: number;
  waitToSeek?: boolean;
  /** Premultiplied canvas cleared to transparent, with the outline compositor. */
  transparent?: boolean;
};

export async function initWebGPU({ canvas, mediaSrc, mediaType, videoTime, videoPosition, waitToSeek, transparent }: InitWebGPUArgs): Promise<{ payload: RenderingPayload; context: GPUCanvasContext }> {
  const device = await initDevice();
  const format = getPreferredFormat();

  const context = canvas.getContext('webgpu') as GPUCanvasContext;
  context.configure({
    device,
    format,
    alphaMode: transparent ? 'premultiplied' : 'opaque'
  });

  const { pipeline, bindGroupLayout } = initPipeline(device, format);
  const { texture, sampler, media } = await loadTexture({ device, mediaSrc, mediaType, videoTime, videoPosition, waitToSeek });

  const vertexBuffer = createVertexBuffer(device, media.width, media.height);
  const uniformBuffer = createUniformBuffer(device);
  const maskTexture = createMaskTexture(device, [1, 1]);
  const colourTexture = createColourTexture(device, [1, 1]);

  const payload: RenderingPayload = {
    device,
    pipeline,
    bindGroupLayout,
    vertexBuffer,
    uniformBuffer,
    texture,
    maskTexture,
    colourTexture,
    sampler,
    bindGroup: undefined as unknown as GPUBindGroup,
    media,
    compositor: transparent ? createStickerCompositor(device, format) : undefined
  };
  payload.bindGroup = recreateBindGroup(device, payload, bindGroupLayout);

  return { payload, context };
}

export function recreateBindGroup(device: GPUDevice, payload: RenderingPayload, bindGroupLayout: GPUBindGroupLayout): GPUBindGroup {
  return device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: payload.uniformBuffer } },
      { binding: 1, resource: payload.texture.createView() },
      { binding: 2, resource: payload.sampler },
      { binding: 3, resource: payload.maskTexture.createView() },
      { binding: 4, resource: payload.colourTexture.createView() }
    ]
  });
}

function createFilledTexture(device: GPUDevice, [width, height]: Vec2, value: number): GPUTexture {
  const texture = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  const encoder = device.createCommandEncoder();
  encoder.beginRenderPass({
    colorAttachments: [{ view: texture.createView(), clearValue: { r: value, g: value, b: value, a: value }, loadOp: 'clear', storeOp: 'store' }]
  }).end();
  device.queue.submit([encoder.finish()]);
  return texture;
}

/** Opaque until a mask is uploaded. */
const createMaskTexture = (device: GPUDevice, size: Vec2) => createFilledTexture(device, size, 1);
/** No colour replaced until colours are uploaded. */
const createColourTexture = (device: GPUDevice, size: Vec2) => createFilledTexture(device, size, 0);

/**
 * Copies the mask canvas (its alpha is the mask) to the GPU, all of it or just `rect`. A canvas of
 * another size replaces the texture.
 */
export function uploadMask(
  payload: RenderingPayload,
  source: HTMLCanvasElement | OffscreenCanvas,
  rect?: { x: number; y: number; width: number; height: number }
): void {
  const { device } = payload;
  if (payload.maskTexture.width !== source.width || payload.maskTexture.height !== source.height) {
    payload.maskTexture.destroy();
    payload.maskTexture = createMaskTexture(device, [source.width, source.height]);
    payload.bindGroup = recreateBindGroup(device, payload, payload.bindGroupLayout);
    rect = undefined;
  }
  const r = rect ?? { x: 0, y: 0, width: source.width, height: source.height };
  if (r.width <= 0 || r.height <= 0) return;
  device.queue.copyExternalImageToTexture(
    { source, origin: [r.x, r.y] },
    { texture: payload.maskTexture, origin: [r.x, r.y] },
    [r.width, r.height]
  );
}

/**
 * Copies the eraser colours (RGBA canvas, alpha 255 where a colour is set) to the GPU, premultiplied
 * so that filtering blends the weight with the colour. A canvas of another size replaces the texture.
 */
export function uploadColour(
  payload: RenderingPayload,
  source: HTMLCanvasElement | OffscreenCanvas,
  rect?: { x: number; y: number; width: number; height: number }
): void {
  const { device } = payload;
  if (payload.colourTexture.width !== source.width || payload.colourTexture.height !== source.height) {
    payload.colourTexture.destroy();
    payload.colourTexture = createColourTexture(device, [source.width, source.height]);
    payload.bindGroup = recreateBindGroup(device, payload, payload.bindGroupLayout);
    rect = undefined;
  }
  const r = rect ?? { x: 0, y: 0, width: source.width, height: source.height };
  if (r.width <= 0 || r.height <= 0) return;
  device.queue.copyExternalImageToTexture(
    { source, origin: [r.x, r.y] },
    { texture: payload.colourTexture, origin: [r.x, r.y], premultipliedAlpha: true },
    [r.width, r.height]
  );
}

/** No colour replaced. */
export function clearColour(payload: RenderingPayload): void {
  if (payload.colourTexture.width === 1 && payload.colourTexture.height === 1) return;
  payload.colourTexture.destroy();
  payload.colourTexture = createColourTexture(payload.device, [1, 1]);
  payload.bindGroup = recreateBindGroup(payload.device, payload, payload.bindGroupLayout);
}

/** Back to fully opaque. */
export function clearMask(payload: RenderingPayload): void {
  if (payload.maskTexture.width === 1 && payload.maskTexture.height === 1) return;
  payload.maskTexture.destroy();
  payload.maskTexture = createMaskTexture(payload.device, [1, 1]);
  payload.bindGroup = recreateBindGroup(payload.device, payload, payload.bindGroupLayout);
}

export function cleanupWebGPU(payload: RenderingPayload): void {
  payload.vertexBuffer.destroy();
  payload.uniformBuffer.destroy();
  payload.texture.destroy();
  payload.maskTexture.destroy();
  payload.colourTexture.destroy();
  payload.compositor?.destroy();
  payload.compositor = undefined;

  // The decoded source would otherwise outlive the GPU resources: a detached <video> keeps its
  // decoder and buffered data until the source is dropped, and the payload pins both elements.
  const { video } = payload.media;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.srcObject = null;
    video.load();
  }
  payload.media.video = undefined;
  payload.media.image = undefined;
}
