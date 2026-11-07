import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { reactive } from 'vue';
const state = vi.hoisted(() => ({ acquire: vi.fn(), load: vi.fn(), mediaRelease: vi.fn(), compositor: vi.fn() }));
vi.mock('../src/webgpu/initDevice', () => ({ acquireDevice: state.acquire, getPreferredFormat: () => 'bgra8unorm' }));
vi.mock('../src/webgpu/loadTexture', () => ({ loadTexture: state.load, releaseMedia: state.mediaRelease }));
vi.mock('../src/webgpu/stickerCompositor', () => ({ createStickerCompositor: state.compositor }));
import { initWebGPU, cleanupWebGPU } from '../src/webgpu/initWebGPU';
import { initPipeline } from '../src/webgpu/initPipeline';

function resource() { return { destroy: vi.fn(), createView: vi.fn(() => ({})), getMappedRange: () => new ArrayBuffer(256), unmap: vi.fn() }; }
let buffers: ReturnType<typeof resource>[];
let textures: ReturnType<typeof resource>[];
let device: any, context: any, canvas: any, release: ReturnType<typeof vi.fn>, source: ReturnType<typeof resource>;
const args = () => ({ canvas, mediaSrc: 'fixture.png', mediaType: 'image' as const, videoTime: 0 });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING:1, COPY_DST:2, RENDER_ATTACHMENT:4 });
  vi.stubGlobal('GPUBufferUsage', { VERTEX:1, COPY_DST:2, UNIFORM:4 });
  vi.stubGlobal('GPUShaderStage', { VERTEX:1, FRAGMENT:2 });
  buffers=[];textures=[];release=vi.fn();source=resource();
  device={
    createShaderModule:vi.fn(() => ({getCompilationInfo:async()=>({messages:[]})})),
    createBindGroupLayout:vi.fn(()=>({})),createPipelineLayout:vi.fn(()=>({})),createRenderPipeline:vi.fn(()=>({})),
    createBindGroup:vi.fn(()=>({})),
    createBuffer:vi.fn(()=>{const r=resource();buffers.push(r);return r;}),
    createTexture:vi.fn(()=>{const r=resource();textures.push(r);return r;}),
    createCommandEncoder:vi.fn(()=>({beginRenderPass:()=>({end(){}}),finish:()=>({})})),
    queue:{submit:vi.fn()},
  };
  context={configure:vi.fn(),unconfigure:vi.fn()};canvas={getContext:vi.fn(()=>context)};
  state.acquire.mockResolvedValue({device,release});
  state.load.mockResolvedValue({texture:source,sampler:{},media:{width:64,height:32}});
  state.compositor.mockReturnValue({destroy:vi.fn()});
});
afterEach(()=>vi.unstubAllGlobals());

describe('GPU payload ownership',()=>{
  test('successful payload is raw and cleanup releases context, resources and lease exactly once',async()=>{
    const {payload}=await initWebGPU({...args(),transparent:true});
    const holder=reactive({payload});
    expect(holder.payload).toBe(payload);
    cleanupWebGPU(holder.payload);cleanupWebGPU(payload);
    expect(release).toHaveBeenCalledTimes(1);expect(context.unconfigure).toHaveBeenCalledTimes(1);
    expect(source.destroy).toHaveBeenCalledTimes(1);
    for(const r of [...buffers,...textures])expect(r.destroy).toHaveBeenCalledTimes(1);
    expect(state.mediaRelease).toHaveBeenCalledTimes(1);
    expect(state.compositor.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
  });
  test('missing context releases lease without creating media',async()=>{
    canvas.getContext.mockReturnValue(null);
    await expect(initWebGPU(args())).rejects.toThrow('context is unavailable');
    expect(release).toHaveBeenCalledTimes(1);expect(state.load).not.toHaveBeenCalled();
  });
  test('failed media load unconfigures canvas and releases device',async()=>{
    state.load.mockRejectedValueOnce(new Error('decode failed'));
    await expect(initWebGPU(args())).rejects.toThrow('decode failed');
    expect(context.unconfigure).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);
  });
  test('partial buffer allocation rolls back source and previous buffer',async()=>{
    device.createBuffer.mockImplementationOnce(()=>{const r=resource();buffers.push(r);return r;}).mockImplementationOnce(()=>{throw new Error('buffer failed');});
    await expect(initWebGPU(args())).rejects.toThrow('buffer failed');
    expect(buffers[0].destroy).toHaveBeenCalledTimes(1);expect(source.destroy).toHaveBeenCalledTimes(1);
    expect(state.mediaRelease).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);
  });
  test('buffer mapping failure destroys the not-yet-returned buffer',async()=>{
    const broken=resource();broken.getMappedRange=()=>{throw new Error('mapping failed');};
    device.createBuffer.mockReturnValueOnce(broken);
    await expect(initWebGPU(args())).rejects.toThrow('mapping failed');
    expect(broken.destroy).toHaveBeenCalledTimes(1);expect(source.destroy).toHaveBeenCalledTimes(1);
    expect(state.mediaRelease).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);
  });
  test('rollback continues past a throwing texture destructor',async()=>{
    source.destroy.mockImplementationOnce(()=>{throw new Error('destroy failed');});
    device.createBuffer.mockImplementationOnce(()=>{throw new Error('original allocation failed');});
    await expect(initWebGPU(args())).rejects.toThrow('original allocation failed');
    expect(state.mediaRelease).toHaveBeenCalledTimes(1);expect(context.unconfigure).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
  test('failure inside texture initialization destroys that texture as well',async()=>{
    device.createCommandEncoder.mockImplementationOnce(()=>{throw new Error('encoder failed');});
    await expect(initWebGPU(args())).rejects.toThrow('encoder failed');
    expect(textures[0].destroy).toHaveBeenCalledTimes(1);
    for(const r of buffers)expect(r.destroy).toHaveBeenCalledTimes(1);
    expect(source.destroy).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);
  });
  test('bind-group failure releases all completed resources and compositor',async()=>{
    device.createBindGroup.mockImplementationOnce(()=>{throw new Error('binding failed');});
    await expect(initWebGPU({...args(),transparent:true})).rejects.toThrow('binding failed');
    for(const r of [...buffers,...textures,source])expect(r.destroy).toHaveBeenCalledTimes(1);
    expect(state.compositor.mock.results[0].value.destroy).toHaveBeenCalledTimes(1);
    expect(context.unconfigure).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);
  });
  test('closing while device acquisition is pending releases the eventual lease',async()=>{
    let ready!:(v:any)=>void;state.acquire.mockReturnValueOnce(new Promise(resolve=>{ready=resolve;}));
    const cancel=new AbortController();const result=initWebGPU({...args(),signal:cancel.signal});
    cancel.abort();ready({device,release});
    await expect(result).rejects.toMatchObject({name:'AbortError'});
    expect(release).toHaveBeenCalledTimes(1);expect(canvas.getContext).not.toHaveBeenCalled();
  });
  test('a cleanup failure does not strand the context or shared lease',async()=>{
    const {payload}=await initWebGPU(args());source.destroy.mockImplementationOnce(()=>{throw new Error('backend failed');});
    expect(()=>cleanupWebGPU(payload)).toThrow('backend failed');
    expect(context.unconfigure).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledTimes(1);
    for(const r of [...buffers,...textures])expect(r.destroy).toHaveBeenCalledTimes(1);
  });
  test('immutable pipeline is reused only for the same device and format',()=>{
    const a=initPipeline(device,'bgra8unorm'),b=initPipeline(device,'bgra8unorm');
    expect(a).toBe(b);expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(initPipeline(device,'rgba8unorm')).not.toBe(a);
    const other={...device};expect(initPipeline(other,'bgra8unorm')).not.toBe(a);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(3);
  });
});
