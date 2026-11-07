import { outlineSeedShaderSource, outlineJumpFloodShaderSource, outlineCompositeShaderSource } from './shaderSources';
import { jfaSteps } from '../mask/maskMath';
import { parseHexColor } from '../color';

export type OutlineDrawParams = {
  /** Canvas pixels; 0 draws none. */
  radius: number;
  color: string;
};

export interface StickerCompositor {
  /** Where the image pass renders to, in the canvas format; valid after `ensureSize`. */
  readonly imageView: GPUTextureView;
  ensureSize(width: number, height: number): void;
  /** Outline (when asked for) under the image, into `target`. */
  encode(encoder: GPUCommandEncoder, target: GPUTextureView, outline: OutlineDrawParams | null): void;
  destroy(): void;
}

// Past this the preview's flood stops short; the export never gets near it (24 px at most).
const MAX_FLOOD_DISTANCE = 255;
const STEP_SLOT = 256;
const MAX_STEPS = 16;

function fullscreenPipeline(device: GPUDevice, code: string, entryPoint: string, format: GPUTextureFormat, layout: GPUBindGroupLayout): GPURenderPipeline {
  const module = device.createShaderModule({ code });
  module.getCompilationInfo().then((info) => {
    for (const msg of info.messages) {
      if (msg.type === 'error') console.error(`[WebGPU ${entryPoint}]`, msg.message, `line ${msg.lineNum}:${msg.linePos}`);
    }
  });
  return device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs_full' },
    fragment: { module, entryPoint, targets: [{ format }] },
    primitive: { topology: 'triangle-list' }
  });
}

/**
 * The sticker modes render the image into an offscreen texture first; this turns it into the
 * canvas's content. An enabled outline allocates a jump-flood distance field of its alpha
 * (seed pass + ping-pong passes), then composites the antialiased outline under the image.
 * Without an outline, only the image and a one-pixel placeholder binding remain allocated.
 */
export function createStickerCompositor(device: GPUDevice, format: GPUTextureFormat): StickerCompositor {
  const loadLayout = (count: number, uniform?: 'dynamic' | 'static', uniformSize = 16) => {
    const entries: GPUBindGroupLayoutEntry[] = [];
    for (let i = 0; i < count; i++) {
      entries.push({ binding: i, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } });
    }
    if (uniform) {
      entries.push({
        binding: count,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform', hasDynamicOffset: uniform === 'dynamic', minBindingSize: uniformSize }
      });
    }
    return device.createBindGroupLayout({ entries });
  };

  const seedLayout = loadLayout(1);
  const jumpLayout = loadLayout(1, 'dynamic');
  const compositeLayout = loadLayout(2, 'static', 32);

  const seedPipeline = fullscreenPipeline(device, outlineSeedShaderSource, 'fs_seed', 'rg32float', seedLayout);
  const jumpPipeline = fullscreenPipeline(device, outlineJumpFloodShaderSource, 'fs_jump', 'rg32float', jumpLayout);
  const compositePipeline = fullscreenPipeline(device, outlineCompositeShaderSource, 'fs_composite', format, compositeLayout);

  const stepBuffer = device.createBuffer({ size: STEP_SLOT * MAX_STEPS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let compositeBuffer: GPUBuffer;
  try {
    compositeBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  } catch (error) {
    stepBuffer.destroy();
    throw error;
  }
  const stepScratch = new Float32Array((STEP_SLOT * MAX_STEPS) / 4);
  const compositeScratch = new Float32Array(8);

  let destroyed = false;
  let width = 0;
  let height = 0;
  let imageTexture: GPUTexture | null = null;
  let seeds: [GPUTexture, GPUTexture] | null = null;
  let imageView: GPUTextureView | null = null;
  let seedViews: [GPUTextureView, GPUTextureView] | null = null;
  let seedBindGroup: GPUBindGroup | null = null;
  let jumpBindGroups: [GPUBindGroup, GPUBindGroup] | null = null;
  let compositeBindGroups: [GPUBindGroup, GPUBindGroup] | null = null;
  // The composite shader returns image_tex before reading seeds_tex when disabled.
  // One tiny valid binding avoids keeping two full-resolution distance fields idle.
  let placeholder: GPUTexture | null = null;
  let plainCompositeBindGroup: GPUBindGroup | null = null;

  function releaseSeeds() {
    seeds?.[0].destroy();
    seeds?.[1].destroy();
    seeds = null;
    seedViews = null;
    seedBindGroup = null;
    jumpBindGroups = null;
    compositeBindGroups = null;
  }

  function release() {
    releaseSeeds();
    imageTexture?.destroy();
    imageTexture = null;
    imageView = null;
    plainCompositeBindGroup = null;
  }

  function ensureSize(w: number, h: number) {
    if (destroyed) throw new Error('StickerCompositor: already destroyed');
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === width && h === height && imageTexture) return;
    release();
    width = w;
    height = h;
    try {
      imageTexture = device.createTexture({
        size: [w, h],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
      });
      imageView = imageTexture.createView();
    } catch (error) {
      release();
      throw error;
    }
  }

  function ensureSeeds() {
    if (seeds || !imageView) return;
    const allocated: GPUTexture[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        allocated.push(device.createTexture({
          size: [width, height],
          format: 'rg32float',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        }));
      }
      const views: [GPUTextureView, GPUTextureView] = [allocated[0].createView(), allocated[1].createView()];
      const seedGroup = device.createBindGroup({ layout: seedLayout, entries: [{ binding: 0, resource: imageView }] });
      const step = { buffer: stepBuffer, offset: 0, size: 16 };
      const jumpGroups: [GPUBindGroup, GPUBindGroup] = [
        device.createBindGroup({ layout: jumpLayout, entries: [{ binding: 0, resource: views[0] }, { binding: 1, resource: step }] }),
        device.createBindGroup({ layout: jumpLayout, entries: [{ binding: 0, resource: views[1] }, { binding: 1, resource: step }] })
      ];
      const params = { buffer: compositeBuffer, offset: 0, size: 32 };
      const compositeGroups: [GPUBindGroup, GPUBindGroup] = [
        device.createBindGroup({ layout: compositeLayout, entries: [{ binding: 0, resource: imageView }, { binding: 1, resource: views[0] }, { binding: 2, resource: params }] }),
        device.createBindGroup({ layout: compositeLayout, entries: [{ binding: 0, resource: imageView }, { binding: 1, resource: views[1] }, { binding: 2, resource: params }] })
      ];
      // Publish only a complete allocation; failures leave no half-initialized pair.
      seeds = allocated as [GPUTexture, GPUTexture];
      seedViews = views;
      seedBindGroup = seedGroup;
      jumpBindGroups = jumpGroups;
      compositeBindGroups = compositeGroups;
    } catch (error) {
      for (const texture of allocated) texture.destroy();
      throw error;
    }
  }

  function plainCompositeGroup(): GPUBindGroup {
    if (plainCompositeBindGroup) return plainCompositeBindGroup;
    if (!placeholder) {
      placeholder = device.createTexture({
        size: [1, 1],
        format: 'rg32float',
        usage: GPUTextureUsage.TEXTURE_BINDING
      });
    }
    plainCompositeBindGroup = device.createBindGroup({
      layout: compositeLayout,
      entries: [
        { binding: 0, resource: imageView! },
        { binding: 1, resource: placeholder.createView() },
        { binding: 2, resource: { buffer: compositeBuffer, offset: 0, size: 32 } }
      ]
    });
    return plainCompositeBindGroup;
  }

  function pass(encoder: GPUCommandEncoder, view: GPUTextureView, pipeline: GPURenderPipeline, group: GPUBindGroup, offsets?: number[]) {
    const p = encoder.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }]
    });
    p.setPipeline(pipeline);
    if (offsets) p.setBindGroup(0, group, offsets);
    else p.setBindGroup(0, group);
    p.draw(3);
    p.end();
  }

  function encode(encoder: GPUCommandEncoder, target: GPUTextureView, outline: OutlineDrawParams | null) {
    if (destroyed) throw new Error('StickerCompositor: already destroyed');
    if (!imageView) return;
    const radius = outline && outline.radius > 0 ? outline.radius : 0;
    const steps = radius > 0 ? jfaSteps(Math.min(MAX_FLOOD_DISTANCE, Math.ceil(radius) + 2)).slice(0, MAX_STEPS) : [];

    // Which seed texture holds the final field.
    let current = 0;
    if (steps.length) {
      ensureSeeds();
      pass(encoder, seedViews![0], seedPipeline, seedBindGroup!);
      for (let i = 0; i < steps.length; i++) stepScratch[(i * STEP_SLOT) / 4] = steps[i];
      device.queue.writeBuffer(stepBuffer, 0, stepScratch, 0, (steps.length * STEP_SLOT) / 4);
      for (let i = 0; i < steps.length; i++) {
        pass(encoder, seedViews![1 - current], jumpPipeline, jumpBindGroups![current], [i * STEP_SLOT]);
        current = 1 - current;
      }
    } else {
      releaseSeeds();
    }

    const c = parseHexColor(outline?.color ?? '#ffffff');
    compositeScratch[0] = c.r / 255;
    compositeScratch[1] = c.g / 255;
    compositeScratch[2] = c.b / 255;
    compositeScratch[3] = 1;
    compositeScratch[4] = radius;
    compositeScratch[5] = steps.length ? 1 : 0;
    device.queue.writeBuffer(compositeBuffer, 0, compositeScratch);
    pass(encoder, target, compositePipeline, steps.length ? compositeBindGroups![current] : plainCompositeGroup());
  }

  return {
    get imageView() {
      if (!imageView) throw new Error('StickerCompositor: ensureSize() first');
      return imageView;
    },
    ensureSize,
    encode,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      release();
      placeholder?.destroy();
      placeholder = null;
      stepBuffer.destroy();
      compositeBuffer.destroy();
    }
  };
}
