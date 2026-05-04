import type { MediaType } from '../types';
import { initDevice, getPreferredFormat } from './initDevice';
import { initPipeline } from './initPipeline';
import { createVertexBuffer, createUniformBuffer } from './initBuffers';
import { loadTexture, type LoadTextureMedia } from './loadTexture';

export type RenderingPayload = {
  device: GPUDevice;
  pipeline: GPURenderPipeline;
  vertexBuffer: GPUBuffer;
  uniformBuffer: GPUBuffer;
  texture: GPUTexture;
  sampler: GPUSampler;
  bindGroup: GPUBindGroup;
  media: LoadTextureMedia;
};

type InitWebGPUArgs = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  mediaSrc: string;
  mediaType: MediaType;
  videoTime: number;
  waitToSeek?: boolean;
};

export async function initWebGPU({ canvas, mediaSrc, mediaType, videoTime, waitToSeek }: InitWebGPUArgs): Promise<{ payload: RenderingPayload; context: GPUCanvasContext }> {
  const device = await initDevice();
  const format = getPreferredFormat();

  const context = canvas.getContext('webgpu') as GPUCanvasContext;
  context.configure({
    device,
    format,
    alphaMode: 'opaque'
  });

  const { pipeline, bindGroupLayout } = initPipeline(device, format);
  const { texture, sampler, media } = await loadTexture({ device, mediaSrc, mediaType, videoTime, waitToSeek });

  const vertexBuffer = createVertexBuffer(device, media.width, media.height);
  const uniformBuffer = createUniformBuffer(device);

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: texture.createView() },
      { binding: 2, resource: sampler }
    ]
  });

  const payload: RenderingPayload = {
    device,
    pipeline,
    vertexBuffer,
    uniformBuffer,
    texture,
    sampler,
    bindGroup,
    media
  };

  return { payload, context };
}

export function recreateBindGroup(device: GPUDevice, payload: RenderingPayload, bindGroupLayout: GPUBindGroupLayout): GPUBindGroup {
  return device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: payload.uniformBuffer } },
      { binding: 1, resource: payload.texture.createView() },
      { binding: 2, resource: payload.sampler }
    ]
  });
}

export function cleanupWebGPU(payload: RenderingPayload): void {
  payload.vertexBuffer.destroy();
  payload.uniformBuffer.destroy();
  payload.texture.destroy();
}
