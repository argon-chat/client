import { createApp, h, nextTick, ref, toRaw } from 'vue';
import { createPinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { MediaEditor, useMediaEditorStore, createFinalResult } from '@argon/media-editor';
import messages from '../../../packages/i18n/src/core/en.json';
import './style.css';

// No account, services, network fonts or user files: only a generated PNG and
// the production editor/store/shaders. The SDK host gets a separate empty profile.
const fontSheet = document.createElement('link');
Object.assign(fontSheet, { id: 'media-editor-fonts', rel: 'stylesheet', href: 'data:text/css,' });
document.head.appendChild(fontSheet);
const opened = ref(false);
const mode = ref<'avatar' | 'sticker'>('avatar');
const generation = ref(0);
const source = ref('');
const failures: string[] = [];
let exportInfo: Record<string, unknown> | null = null;
let store: ReturnType<typeof useMediaEditorStore>;
let lastDevice: GPUDevice | null = null;
let lost = false;
const watchedDevices = new WeakSet<GPUDevice>();

const app = createApp({ setup() {
  store = useMediaEditorStore();
  return () => h('div', { class: 'native-editor-probe' }, [
    h('p', 'Production media editor · native WebGPU qualification'),
    h(MediaEditor, { key: generation.value, modelValue: opened.value, src: source.value,
      mode: mode.value, mediaType: 'image', initialTab: 'crop', exportFormat: 'png',
      'onUpdate:modelValue': (v: boolean) => { opened.value = v; },
      onError: (e: unknown) => { failures.push(String(e)); },
    }),
  ]);
} });
app.config.errorHandler = (error) => { failures.push(String((error as Error)?.stack || error)); };
app.use(createPinia());
app.use(createI18n({ legacy: false, locale: 'en', messages: { en: messages }, missingWarn: false, fallbackWarn: false }));
app.mount('#app');

function fingerprint(canvas: HTMLCanvasElement | ImageBitmap) {
  const pixels = (globalThis as any).__rjs_sourcePixels(canvas) as Uint8Array;
  if (!pixels) throw Error('No native canvas pixels');
  let hash = 2166136261;
  for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i]!, 16777619) >>> 0;
  const width = canvas.width, height = canvas.height;
  const samples = [[.25,.25],[.75,.25],[.25,.75],[.75,.75],[.5,.5]].map(([x,y]) => {
    const index = (Math.floor(y!*height)*width + Math.floor(x!*width))*4;
    return Array.from(pixels.slice(index,index+4));
  });
  let transparent = 0;
  for (let i=3;i<pixels.length;i+=4) if(pixels[i]===0) transparent++;
  return { width, height, hash, samples, transparent };
}
function status() {
  const device = store?.uiState.renderingPayload?.device;
  if (device && !watchedDevices.has(device)) {
    watchedDevices.add(device);
    device.addEventListener('uncapturederror', (event) => failures.push(event.error.message));
  }
  return { open: opened.value, mode: mode.value, ready: Boolean(store?.uiState.isReady && store.uiState.renderingPayload),
    mediaSize: store?.uiState.mediaSize, canvasSize: store?.uiState.canvasSize,
    errors: failures.slice(), export: exportInfo, lost, brightness: store?.mediaState.adjustments.brightness, history: store?.mediaState.history.length,
    canvasCount: document.querySelectorAll('canvas').length };
}
async function open(nextMode: 'avatar' | 'sticker' = 'avatar') {
  opened.value = false;
  await nextTick();
  mode.value = nextMode;
  generation.value++;
  opened.value = true;
}
async function save() {
  exportInfo = { state: 'running' };
  try {
    if (!store.uiState.renderingPayload || !store.uiState.canvasSize) throw Error('Editor not ready');
    const result = await createFinalResult({ mediaSrc: store.mediaSrc, mediaType: 'image',
      mediaState: toRaw(store.mediaState), canvasSize: store.uiState.canvasSize,
      mediaRatio: store.uiState.mediaRatio!, renderingPayload: store.uiState.renderingPayload,
      mode: mode.value, getMaskSource: store.getMaskSource, exportFormat: 'png', pixelRatio: store.uiState.pixelRatio });
    const output = await result.getResult();
    const bitmap = await createImageBitmap(output.blob);
    const bytes = new Uint8Array(await output.blob.arrayBuffer());
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    exportInfo = { state: 'done', type: output.blob.type, bytes: output.blob.size, png: btoa(binary),
      width: result.width, height: result.height, pixels: fingerprint(bitmap),
      previewAlive: Boolean(store.uiState.renderingPayload) };
    bitmap.close();
  } catch (error) {
    exportInfo = { state: 'error', message: String((error as Error)?.stack || error) };
    failures.push(String((error as Error)?.stack || error));
  }
}
(globalThis as any).__nativeEditorProbe = {
  status, open, save,
  snapshot() { if (!store.uiState.imageCanvas) throw Error('No image canvas'); return fingerprint(store.uiState.imageCanvas); },
  adjust(key: string, value: number) { (store.mediaState.adjustments as any)[key] = value; },
  crop() { store.mediaState.scale = 1.5; store.mediaState.rotation = 15; store.mediaState.flip = [-1,1]; },
  erase() { store.mediaState.mask.strokes.push({ kind:'brush', mode:'erase', size:64, points:[[128,96]] }); },
  slider() {
    const input = document.querySelectorAll('.range-input')[1];
    const track = input?.querySelector('div') as HTMLElement | null;
    if (!track) throw Error('Brightness slider was not rendered');
    const r = track.getBoundingClientRect();
    const init = { bubbles:true, pointerId:1, clientX:r.left+r.width*0.7, clientY:r.top+r.height/2, buttons:1 };
    track.dispatchEvent(new PointerEvent('pointerdown',init));
    track.dispatchEvent(new PointerEvent('pointerup',{...init,buttons:0}));
  },
  geometry() { const crop=document.querySelector('.crop-handles')!.getBoundingClientRect(); const canvas=store.uiState.imageCanvas!.getBoundingClientRect(); return {crop:{x:crop.x,y:crop.y,width:crop.width,height:crop.height},canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height}}; },
  outline() { store.mediaState.outline.enabled = true; store.mediaState.outline.radius = 8; store.mediaState.outline.color = '#ffffff'; },
  tab(id: string) { store.uiState.currentTab = id; },
  close() { lastDevice = store.uiState.renderingPayload?.device ?? null; lost = false;
    lastDevice?.lost.then(() => { lost = true; lastDevice = null; }); opened.value = false; },
};
(async () => {
  const width = 256, height = 192;
  const data = new ImageData(width,height);
  const colours = [[230,45,60],[35,200,90],[40,100,220],[230,190,40]];
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const at=(y*width+x)*4; const colour=colours[(y>=height/2?2:0)+(x>=width/2?1:0)]!;
    data.data.set([...colour, x<16||y<16||x>=width-16||y>=height-16?0:255],at);
    // A translucent strip also qualifies GPU -> straight-alpha atlas conversion.
    if(x>=112&&x<144&&y>=24&&y<40) data.data.set([210,120,60,128],at);
  }
  const canvas = new OffscreenCanvas(width,height); canvas.getContext('2d')!.putImageData(data,0,0);
  source.value = URL.createObjectURL(await canvas.convertToBlob({type:'image/png'}));
  await open();
})().catch(error => { failures.push(String((error as Error)?.stack || error)); });
