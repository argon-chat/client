import type { RenderingPayload } from './initWebGPU';
import { vertexShaderSource } from './shaderSources';
import { getPreferredFormat } from './initDevice';

const fragment = `@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var image_sampler: sampler;
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(image, image_sampler, uv);
}`;
type Pipeline = { layout: GPUBindGroupLayout; pipeline: GPURenderPipeline };
type Raster = { texture: GPUTexture; group: GPUBindGroup };
const pipelines = new WeakMap<GPUDevice, Pipeline>();
const rasters = new WeakMap<RenderingPayload, Map<string, Raster>>();
function pipelineFor(device: GPUDevice): Pipeline {
  const cached = pipelines.get(device);
  if (cached) return cached;
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
  ] });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module: device.createShaderModule({ code: vertexShaderSource }), entryPoint: 'vs_main', buffers: [{
      arrayStride: 16, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x2' },
        { shaderLocation: 1, offset: 8, format: 'float32x2' },
      ],
    }] },
    fragment: { module: device.createShaderModule({ code: fragment }), entryPoint: 'fs_main', targets: [{
      format: getPreferredFormat(), blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      },
    }] }, primitive: { topology: 'triangle-strip' },
  });
  const result = { layout, pipeline }; pipelines.set(device, result); return result;
}
/** Source-plane rasters use precisely the image vertex projection, including perspective. */
export function uploadAnnotation(payload: RenderingPayload, key: string, source: HTMLCanvasElement,
  rect?: { x: number; y: number; width: number; height: number }): void {
  if (!source.width || !source.height) return;
  let owned = rasters.get(payload);
  if (!owned) { owned = new Map(); rasters.set(payload, owned); }
  let raster = owned.get(key);
  const { device } = payload;
  if (!raster || raster.texture.width !== source.width || raster.texture.height !== source.height) {
    raster?.texture.destroy();
    const texture = device.createTexture({ size: [source.width, source.height], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    const group = device.createBindGroup({ layout: pipelineFor(device).layout, entries: [
      { binding: 0, resource: { buffer: payload.uniformBuffer } },
      { binding: 1, resource: texture.createView() }, { binding: 2, resource: payload.sampler },
    ] });
    raster = { texture, group }; owned.set(key, raster); rect = undefined;
  }
  const r = rect ?? { x: 0, y: 0, width: source.width, height: source.height };
  if (r.width <= 0 || r.height <= 0) return;
  device.queue.copyExternalImageToTexture({ source, origin: [r.x, r.y] },
    { texture: raster.texture, origin: [r.x, r.y], premultipliedAlpha: true }, [r.width, r.height]);
}
export function clearAnnotation(payload: RenderingPayload, key: string): void {
  const owned = rasters.get(payload);
  owned?.get(key)?.texture.destroy(); owned?.delete(key);
}
export function clearAnnotations(payload: RenderingPayload): void {
  for (const raster of rasters.get(payload)?.values() ?? []) raster.texture.destroy();
  rasters.delete(payload);
}
export function encodeAnnotations(payload: RenderingPayload, encoder: GPUCommandEncoder, view: GPUTextureView): void {
  const owned = rasters.get(payload);
  if (!owned?.size) return;
  const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }] });
  pass.setPipeline(pipelineFor(payload.device).pipeline);
  pass.setVertexBuffer(0, payload.vertexBuffer);
  // The brush is always below the resizable text/sticker layers.
  for (const key of ['brush', 'layers']) {
    const raster = owned.get(key); if (!raster) continue;
    pass.setBindGroup(0, raster.group); pass.draw(4);
  }
  pass.end();
}
