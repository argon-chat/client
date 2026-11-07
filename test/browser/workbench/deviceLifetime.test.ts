import { describe, test, expect } from 'vitest';
import { initWebGPU, cleanupWebGPU } from '../../../packages/media-editor/src/webgpu/initWebGPU';
const adapter=navigator.gpu?await navigator.gpu.requestAdapter().catch(()=>null):null;
async function source(){
  const canvas=new OffscreenCanvas(16,16);const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#4080ff';ctx.fillRect(0,0,16,16);
  return URL.createObjectURL(await canvas.convertToBlob({type:'image/png'}));
}
function canvas(){const c=document.createElement('canvas');c.width=64;c.height=64;return c;}
describe.skipIf(!adapter)('editor GPU ownership on a real device',()=>{
  test('overlapping preview/export share a device and pipeline, final cleanup destroys it and reopening works',async()=>{
    const url=await source();const a=canvas(),b=canvas(),c=canvas();
    let preview:Awaited<ReturnType<typeof initWebGPU>>|undefined,exporter:typeof preview,reopened:typeof preview;
    try {
      [preview,exporter]=await Promise.all([a,b].map(canvas=>initWebGPU({canvas,mediaSrc:url,mediaType:'image',videoTime:0})));
      expect(preview.payload.device).toBe(exporter.payload.device);
      expect(preview.payload.pipeline).toBe(exporter.payload.pipeline);
      const device=preview.payload.device;
      cleanupWebGPU(preview.payload);
      expect(()=>preview!.context.getCurrentTexture()).toThrow();
      await expect(device.queue.onSubmittedWorkDone()).resolves.toBeUndefined();
      cleanupWebGPU(exporter.payload);
      const lost=await device.lost;expect(lost.reason).toBe('destroyed');
      reopened=await initWebGPU({canvas:c,mediaSrc:url,mediaType:'image',videoTime:0});
      expect(reopened.payload.device).not.toBe(device);
      await expect(reopened.payload.device.queue.onSubmittedWorkDone()).resolves.toBeUndefined();
    } finally {
      for(const result of [preview,exporter,reopened])if(result)cleanupWebGPU(result.payload);
      for(const target of [a,b,c])target.width=target.height=0;
      URL.revokeObjectURL(url);
    }
  });
  test('decode failure unconfigures its canvas without destroying an active preview device',async()=>{
    const url=await source();const a=canvas(),b=canvas();
    const preview=await initWebGPU({canvas:a,mediaSrc:url,mediaType:'image',videoTime:0});
    try {
      await expect(initWebGPU({canvas:b,mediaSrc:'data:image/png;base64,AAAA',mediaType:'image',videoTime:0})).rejects.toThrow('could not be decoded');
      expect(()=>(b.getContext('webgpu') as GPUCanvasContext).getCurrentTexture()).toThrow();
      await expect(preview.payload.device.queue.onSubmittedWorkDone()).resolves.toBeUndefined();
    } finally {
      cleanupWebGPU(preview.payload);a.width=a.height=b.width=b.height=0;URL.revokeObjectURL(url);
    }
  });
});
