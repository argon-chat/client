import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createStickerCompositor } from '../src/webgpu/stickerCompositor';
import { jfaSteps } from '../src/mask/maskMath';

interface TextureRecord {
  width: number;
  height: number;
  format: GPUTextureFormat;
  destroy: ReturnType<typeof vi.fn>;
  createView: ReturnType<typeof vi.fn>;
}
interface BufferRecord { destroy: ReturnType<typeof vi.fn> }
interface GroupRecord { entries: GPUBindGroupEntry[] }

function gpu() {
  const textures: TextureRecord[] = [];
  const buffers: BufferRecord[] = [];
  const groups: GroupRecord[] = [];
  const passes: { group?: GroupRecord; entryPoint?: string }[] = [];
  let textureCalls = 0;
  let bufferCalls = 0;
  let failTextureAt = 0;
  let failBufferAt = 0;
  const device = {
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({ getCompilationInfo: async () => ({ messages: [] }) })),
    createRenderPipeline: vi.fn((descriptor: GPURenderPipelineDescriptor) => ({ entryPoint: descriptor.fragment?.entryPoint })),
    createBuffer: vi.fn(() => {
      if (++bufferCalls === failBufferAt) throw new Error('buffer allocation failed');
      const buffer = { destroy: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      if (++textureCalls === failTextureAt) throw new Error('texture allocation failed');
      const [width, height] = descriptor.size as number[];
      const texture: TextureRecord = {
        width, height, format: descriptor.format, destroy: vi.fn(), createView: vi.fn(),
      };
      texture.createView.mockImplementation(() => ({ texture }));
      textures.push(texture);
      return texture;
    }),
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => {
      const group = { entries: Array.from(descriptor.entries) };
      groups.push(group);
      return group;
    }),
    queue: { writeBuffer: vi.fn() },
  } as unknown as GPUDevice;
  const encoder = {
    beginRenderPass: vi.fn(() => {
      const pass: { group?: GroupRecord; entryPoint?: string } = {};
      passes.push(pass);
      return {
        setPipeline: (pipeline: { entryPoint: string }) => { pass.entryPoint = pipeline.entryPoint; },
        setBindGroup: (_slot: number, group: GroupRecord) => { pass.group = group; },
        draw: vi.fn(), end: vi.fn(),
      };
    }),
  } as unknown as GPUCommandEncoder;
  const fullSeeds = () => textures.filter(t => t.format === 'rg32float' && (t.width > 1 || t.height > 1));
  const live = () => textures.filter(t => t.destroy.mock.calls.length === 0);
  const liveBytes = () => live().reduce((bytes, t) => bytes + t.width * t.height * (t.format === 'rg32float' ? 8 : 4), 0);
  return {
    device, encoder, textures, buffers, groups, passes, fullSeeds, live, liveBytes,
    failTexture(at: number) { failTextureAt = at; },
    failBuffer(at: number) { failBufferAt = at; },
  };
}

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { FRAGMENT: 2 });
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, COPY_DST: 8 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4 });
});

afterEach(() => vi.unstubAllGlobals());

describe('sticker compositor resource lifetime', () => {
  test('no outline keeps only the image plus a one-pixel seed binding', () => {
    const mock = gpu();
    const compositor = createStickerCompositor(mock.device, 'rgba8unorm');
    compositor.ensureSize(1024, 512);
    compositor.encode(mock.encoder, {} as GPUTextureView, null);
    expect(mock.fullSeeds()).toHaveLength(0);
    expect(mock.liveBytes()).toBe(1024 * 512 * 4 + 8);
    expect(mock.passes.map(p => p.entryPoint)).toEqual(['fs_composite']);
    const seed = mock.passes[0].group!.entries.find(e => e.binding === 1)!.resource as unknown as { texture: TextureRecord };
    expect([seed.texture.width, seed.texture.height]).toEqual([1, 1]);
    // Repeated draws reuse the tiny binding without allocating or drawing JFA passes.
    compositor.encode(mock.encoder, {} as GPUTextureView, { radius: 0, color: '#ff0000' });
    expect(mock.textures).toHaveLength(2);
    compositor.destroy();
  });

  test('outline enable allocates one pair and disabling releases it immediately', () => {
    const mock = gpu();
    const compositor = createStickerCompositor(mock.device, 'rgba8unorm');
    compositor.ensureSize(64, 32);
    const image = compositor.imageView;
    compositor.encode(mock.encoder, {} as GPUTextureView, { radius: 4, color: '#ffffff' });
    const firstPair = mock.fullSeeds();
    expect(firstPair).toHaveLength(2);
    expect(mock.passes.length).toBe(jfaSteps(6).length + 2);
    compositor.encode(mock.encoder, {} as GPUTextureView, { radius: 8, color: '#ffffff' });
    expect(mock.fullSeeds()).toHaveLength(2);
    compositor.encode(mock.encoder, {} as GPUTextureView, null);
    expect(firstPair.every(t => t.destroy.mock.calls.length === 1)).toBe(true);
    expect(compositor.imageView).toBe(image);
    expect(mock.liveBytes()).toBe(64 * 32 * 4 + 8);
    const offGroup = mock.passes.at(-1)!.group!;
    const offSeed = offGroup.entries.find(e => e.binding === 1)!.resource as unknown as { texture: TextureRecord };
    expect(offSeed.texture.width).toBe(1);
    expect(offSeed.texture.destroy).not.toHaveBeenCalled();
    compositor.encode(mock.encoder, {} as GPUTextureView, { radius: 2, color: '#ffffff' });
    expect(mock.fullSeeds()).toHaveLength(4);
    expect(mock.live().filter(t => t.format === 'rg32float' && t.width > 1)).toHaveLength(2);
    compositor.destroy();
  });

  test('resize drops old images, seed views and groups before lazy reallocation', () => {
    const mock = gpu();
    const compositor = createStickerCompositor(mock.device, 'rgba8unorm');
    compositor.ensureSize(512, 256);
    compositor.encode(mock.encoder, {} as GPUTextureView, { radius: 4, color: '#ffffff' });
    const old = mock.textures.slice();
    compositor.ensureSize(128, 64);
    expect(old.every(t => t.destroy.mock.calls.length === 1)).toBe(true);
    expect(mock.liveBytes()).toBe(128 * 64 * 4);
    compositor.encode(mock.encoder, {} as GPUTextureView, null);
    expect(mock.liveBytes()).toBe(128 * 64 * 4 + 8);
    const imageResource = mock.passes.at(-1)!.group!.entries.find(e => e.binding === 0)!.resource as unknown as { texture: TextureRecord };
    expect([imageResource.texture.width, imageResource.texture.height]).toEqual([128, 64]);
    compositor.encode(mock.encoder, {} as GPUTextureView, { radius: 4, color: '#ffffff' });
    expect(mock.live().filter(t => t.format === 'rg32float' && t.width > 1).every(t => t.width === 128 && t.height === 64)).toBe(true);
    compositor.destroy();
  });

  test('destroy is idempotent and releases all owned allocations', () => {
    const mock = gpu();
    const compositor = createStickerCompositor(mock.device, 'rgba8unorm');
    compositor.ensureSize(32, 32);
    compositor.encode(mock.encoder, {} as GPUTextureView, null);
    compositor.encode(mock.encoder, {} as GPUTextureView, { radius: 3, color: '#ffffff' });
    compositor.destroy();
    compositor.destroy();
    expect(mock.live()).toHaveLength(0);
    expect(mock.textures.every(t => t.destroy.mock.calls.length === 1)).toBe(true);
    expect(mock.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
    expect(() => compositor.imageView).toThrow('ensureSize');
    expect(() => compositor.ensureSize(32, 32)).toThrow('destroyed');
    expect(() => compositor.encode(mock.encoder, {} as GPUTextureView, null)).toThrow('destroyed');
  });

  test('failure allocating the second uniform buffer releases the first', () => {
    const mock = gpu();
    mock.failBuffer(2);
    expect(() => createStickerCompositor(mock.device, 'rgba8unorm')).toThrow('buffer allocation failed');
    expect(mock.buffers).toHaveLength(1);
    expect(mock.buffers[0].destroy).toHaveBeenCalledOnce();
  });

  test('failure allocating the second JFA texture rolls back the first and can retry', () => {
    const mock = gpu();
    const compositor = createStickerCompositor(mock.device, 'rgba8unorm');
    compositor.ensureSize(64, 64);
    mock.failTexture(3); // Image, first seed, then failed second seed.
    expect(() => compositor.encode(mock.encoder, {} as GPUTextureView, { radius: 4, color: '#ffffff' })).toThrow('texture allocation failed');
    expect(mock.fullSeeds()).toHaveLength(1);
    expect(mock.fullSeeds()[0].destroy).toHaveBeenCalledOnce();
    expect(mock.liveBytes()).toBe(64 * 64 * 4);
    compositor.encode(mock.encoder, {} as GPUTextureView, { radius: 4, color: '#ffffff' });
    expect(mock.live().filter(t => t.format === 'rg32float')).toHaveLength(2);
    compositor.destroy();
    expect(mock.textures.every(t => t.destroy.mock.calls.length === 1)).toBe(true);
  });
});
