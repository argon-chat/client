import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { loadTexture } from '../src/webgpu/loadTexture';
class Media extends EventTarget {
  naturalWidth=16;naturalHeight=8;videoWidth=16;videoHeight=8;duration=1;currentTime=0;seeking=false;
  crossOrigin='';muted=false;playsInline=false;preload='';srcObject=null;
  removeAttribute=vi.fn();pause=vi.fn();load=vi.fn();
  set src(_v:string){ onSource(this); }
}
let onSource:(target:Media)=>void, last:Media, device:any, destroy:ReturnType<typeof vi.fn>;
const input=()=>({device,mediaSrc:'fixture',mediaType:'image' as const,videoTime:0});
beforeEach(()=>{
  vi.stubGlobal('GPUTextureUsage',{TEXTURE_BINDING:1,COPY_DST:2,RENDER_ATTACHMENT:4});
  vi.stubGlobal('Image',class extends Media{constructor(){super();last=this;}});
  const original=document.createElement.bind(document);
  vi.spyOn(document,'createElement').mockImplementation(((tag:string,...rest:any[])=>tag==='video'?(last=new Media()):original(tag,...rest)) as any);
  onSource=target=>queueMicrotask(()=>target.dispatchEvent(new Event('load')));
  destroy=vi.fn();device={createTexture:vi.fn(()=>({destroy})),createSampler:vi.fn(()=>({})),queue:{copyExternalImageToTexture:vi.fn()}};
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('media decode lifetime',()=>{
  test('decode error rejects and releases decoded source without allocating a texture',async()=>{
    onSource=target=>queueMicrotask(()=>target.dispatchEvent(new Event('error')));
    await expect(loadTexture(input())).rejects.toThrow('could not be decoded');
    expect(last.removeAttribute).toHaveBeenCalledWith('src');expect(device.createTexture).not.toHaveBeenCalled();
  });
  test('upload failure destroys the texture and decoded source',async()=>{
    device.queue.copyExternalImageToTexture.mockImplementationOnce(()=>{throw new Error('upload failed');});
    await expect(loadTexture(input())).rejects.toThrow('upload failed');
    expect(destroy).toHaveBeenCalledTimes(1);expect(last.removeAttribute).toHaveBeenCalledWith('src');
  });
  test('a throwing texture destructor cannot mask upload error or strand media',async()=>{
    destroy.mockImplementationOnce(()=>{throw new Error('destroy failed');});
    device.queue.copyExternalImageToTexture.mockImplementationOnce(()=>{throw new Error('original upload failed');});
    await expect(loadTexture(input())).rejects.toThrow('original upload failed');
    expect(last.removeAttribute).toHaveBeenCalledWith('src');
  });
  test('abort ends a pending load and drops decoder source',async()=>{
    onSource=()=>{};const cancel=new AbortController();
    const pending=loadTexture({...input(),mediaType:'video',signal:cancel.signal});
    cancel.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
    expect(last.pause).toHaveBeenCalledTimes(1);expect(last.load).toHaveBeenCalledTimes(1);
    expect(last.removeAttribute).toHaveBeenCalledWith('src');expect(device.createTexture).not.toHaveBeenCalled();
  });
  test('zero-time cover already loaded does not wait forever for an unchanged seek',async()=>{
    onSource=target=>queueMicrotask(()=>target.dispatchEvent(new Event('loadeddata')));
    const result=await loadTexture({...input(),mediaType:'video',waitToSeek:true});
    expect(result.media.video).toBe(last);expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
  });
  test('video decode error releases decoder and rejects instead of hanging',async()=>{
    onSource=target=>queueMicrotask(()=>target.dispatchEvent(new Event('error')));
    await expect(loadTexture({...input(),mediaType:'video'})).rejects.toThrow('could not be decoded');
    expect(last.pause).toHaveBeenCalledTimes(1);expect(last.load).toHaveBeenCalledTimes(1);
  });
});
