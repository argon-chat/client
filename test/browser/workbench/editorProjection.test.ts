import "../../../packages/assets/styles/index.css";
import { describe, test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { useMediaEditorStore, REMOVE_ARRAY_ITEM, plainClone } from '../../../packages/media-editor/src/store/editorStore';
import { sourceToCanvas, canvasToSource } from '../../../packages/media-editor/src/mask/maskMath';
import type { Vec2, EditorLayer } from '../../../packages/media-editor/src/types';
import { MEDIA_EDITOR_INJECTION_KEY, createInteractions } from '../../../packages/media-editor/src/composables/useMediaEditorContext';
import BrushCanvas from '../../../packages/media-editor/src/components/BrushCanvas.vue';
import MainCanvas from '../../../packages/media-editor/src/components/MainCanvas.vue';
import ImageCanvas from '../../../packages/media-editor/src/components/ImageCanvas.vue';
import { rasterSize } from '../../../packages/media-editor/src/canvas/annotationSpace';
import TextLayers from '../../../packages/media-editor/src/components/TextLayers.vue';
import TextTab from '../../../packages/media-editor/src/tabs/TextTab.vue';
import RangeInput from '../../../packages/media-editor/src/components/RangeInput.vue';
import { initWebGPU, cleanupWebGPU } from '../../../packages/media-editor/src/webgpu/initWebGPU';
import { draw, type DrawingParameters } from '../../../packages/media-editor/src/webgpu/draw';
import { projectAnnotations } from '../../../packages/media-editor/src/finalRender/projectAnnotations';
import { createFinalResult } from '../../../packages/media-editor/src/finalRender/createFinalResult';
import getResultTransform from '../../../packages/media-editor/src/finalRender/getResultTransform';
import { projectedLayerCorners, layerSourcePoint, layerSize } from '../../../packages/media-editor/src/canvas/layerGeometry';

function storeForTest() {
  setActivePinia(createPinia()); const store = useMediaEditorStore(); store.init({ src: '', type: 'image' });
  store.uiState.canvasSize = [480, 360]; store.uiState.mediaSize = [256, 192]; store.uiState.pixelRatio = 1;
  store.uiState.finalTransform = { rotation: 0.23, scale: 1.3, flip: [-1, 1], translation: [13, -8], perspective: [0.55, -0.35] };
  return store;
}
const canvasSize: Vec2 = [480, 360], mediaSize: Vec2 = [256, 192];

describe('source-plane editor geometry', () => {
  test('projected mask/brush hit tests invert the vertex projection including tilt and mirror', () => {
    const store = storeForTest();
    for (const point of [[0, 0], [256, 0], [256, 192], [0, 192], [81, 64]] as Vec2[]) {
      const canvas = sourceToCanvas(point, store.uiState.finalTransform, canvasSize, mediaSize);
      const restored = canvasToSource(canvas, store.uiState.finalTransform, canvasSize, mediaSize);
      expect(restored[0]).toBeCloseTo(point[0], 8); expect(restored[1]).toBeCloseTo(point[1], 8);
    }
  });
  test('legacy snapshots migrate once without dirtying the saved state; undo/redo keeps source anchors', () => {
    const store = storeForTest();
    const layer: EditorLayer = { id: 7, type: 'text', position: [180, 140], rotation: 0, scale: 1,
      textInfo: { font: 'roboto', size: 30, style: 'normal', alignment: 'left', color: '#fff', content: 'Hello' } };
    const legacy = plainClone({ ...store.mediaState, resizableLayers: [layer],
      history: [{ path: ['resizableLayers', 0], oldValue: REMOVE_ARRAY_ITEM, newValue: layer }] });
    delete legacy.annotationSpace;
    store.init({ src: '', type: 'image', initialState: legacy });
    store.uiState.canvasSize = canvasSize; store.uiState.mediaSize = mediaSize; store.uiState.pixelRatio = 1;
    store.uiState.finalTransform = { rotation: 0.23, scale: 1.3, flip: [-1, 1], translation: [13, -8], perspective: [0.55, -0.35] };
    store.ensureSourceAnnotations();
    const saved = JSON.stringify(store.mediaState); const anchor = [...store.mediaState.resizableLayers[0].position];
    expect(store.hasModifications).toBe(false); expect(store.isDirty).toBe(false);
    store.ensureSourceAnnotations(); expect(JSON.stringify(store.mediaState)).toBe(saved);
    store.undo(); expect(store.mediaState.resizableLayers).toHaveLength(0);
    store.redo(); expect(store.mediaState.resizableLayers[0].position).toEqual(anchor);
    expect(store.mediaState.resizableLayers[0].coordinateSpace).toBe('source');
  });
  test('text toolbar follows two selected styles and undo without overwriting unrelated fields', async () => {
    const store = storeForTest(); store.uiState.currentTab = 'text';
    const first = { font: 'courier' as const, size: 15, alignment: 'center', style: 'outline', color: '#fe4438', content: 'First' };
    const second = { font: 'chewy' as const, size: 54, alignment: 'right', style: 'background', color: '#bd5cf3', content: 'Second' };
    store.mediaState.resizableLayers = [
      { id: 1, type: 'text', position: [80, 60], rotation: 0, scale: 1, textInfo: { ...first }, coordinateSpace: 'source' },
      { id: 2, type: 'text', position: [170, 130], rotation: 0, scale: 1, textInfo: { ...second }, coordinateSpace: 'source' },
    ];
    store.uiState.selectedResizableLayer = 1;
    const provide = { [MEDIA_EDITOR_INJECTION_KEY as symbol]: { store, mode: 'full', interactions: createInteractions() } };
    const wrapper = mount(TextTab, { attachTo: document.body, global: { provide,
      plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })] } });
    const styleKeys = ['font', 'size', 'alignment', 'style', 'color'] as const;
    const matchesControls = (style: typeof first | typeof second) => {
      for (const key of styleKeys) expect(store.uiState.currentTextLayerInfo[key], key).toBe(style[key]);
      expect(wrapper.findComponent(RangeInput).props('modelValue')).toBeCloseTo((style.size - 16) / 48);
    };
    try {
      await nextTick(); matchesControls(first); expect(store.mediaState.history).toHaveLength(0);
      const blue = wrapper.findAll('button').find(button => button.element.style.backgroundColor === 'rgb(10, 132, 255)')!;
      await blue.trigger('click');
      expect(store.mediaState.resizableLayers[0].textInfo).toEqual({ ...first, color: '#0a84ff' });
      expect(store.mediaState.resizableLayers[1].textInfo).toEqual(second);
      expect(store.mediaState.history).toHaveLength(1);
      await blue.trigger('click'); expect(store.mediaState.history).toHaveLength(1);
      // A same-turn selection then toolbar edit must use the new layer's complete style.
      store.uiState.selectedResizableLayer = 2;
      expect(store.uiState.currentTextLayerInfo.size).toBe(54);
      (wrapper.find('[data-text-align="left"]').element as HTMLButtonElement).click(); await nextTick();
      expect(store.mediaState.resizableLayers[1].textInfo).toEqual({ ...second, alignment: 'left' });
      expect(store.mediaState.history).toHaveLength(2);
      store.undo(); await nextTick(); matchesControls(second);
      expect(store.mediaState.history).toHaveLength(1); expect(store.mediaState.redoHistory).toHaveLength(1);
      store.undo(); await nextTick(); expect(store.mediaState.history).toHaveLength(0);
      matchesControls(second);
      store.uiState.selectedResizableLayer = 1; await nextTick(); matchesControls(first);
      expect(store.mediaState.history).toHaveLength(0);
      store.redo(); await nextTick(); matchesControls({ ...first, color: '#0a84ff' });
      expect(store.mediaState.history).toHaveLength(1);
      store.redo(); await nextTick(); expect(store.mediaState.history).toHaveLength(2);
      store.uiState.selectedResizableLayer = 2; await nextTick(); matchesControls({ ...second, alignment: 'left' });
      expect(store.mediaState.resizableLayers[0].textInfo?.content).toBe('First');
      expect(store.mediaState.resizableLayers[1].textInfo?.content).toBe('Second');
    } finally { wrapper.unmount(); }
  });
  test('editing textarea folds tilt, source basis, rotation and scale into one native affine matrix', async () => {
    const store = storeForTest(), host = document.createElement('div');
    host.style.cssText = 'position:relative;width:480px;height:360px'; document.body.append(host);
    store.uiState.currentTab = 'text';
    store.mediaState.resizableLayers = [{ id: 91, type: 'text', position: [128, 96], rotation: 0.43, scale: 1.6,
      basis: [0.8, 0.15, -0.2, 1.1], coordinateSpace: 'source',
      textInfo: { content: 'Affine', color: '#fff', font: 'roboto', style: 'normal', size: 20, alignment: 'left' } }];
    const provide = { [MEDIA_EDITOR_INJECTION_KEY as symbol]: { store, mode: 'full', interactions: createInteractions() } };
    const wrapper = mount(TextLayers, { attachTo: host, global: { provide } });
    try {
      const layer = store.mediaState.resizableLayers[0], root = host.querySelector<HTMLElement>('[data-media-editor-text-surface]')!;
      const rect = root.getBoundingClientRect(), center = sourceToCanvas(layer.position, store.uiState.finalTransform, canvasSize, mediaSize);
      root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: rect.left + center[0], clientY: rect.top + center[1] }));
      await nextTick();
      const verify = () => {
        const textarea = host.querySelector('textarea')!, box = textarea.parentElement!, transform = box.style.transform;
        expect(transform).not.toContain('rotate('); expect(transform).not.toContain('scale(');
        const values = transform.match(/matrix\(([^)]+)\)/)![1].split(',').map(Number);
        const density = Number.parseFloat(textarea.style.fontSize) / layer.textInfo!.size;
        expect(density).toBeGreaterThanOrEqual(1);
        const zero = sourceToCanvas(layerSourcePoint(layer, [0, 0]), store.uiState.finalTransform, canvasSize, mediaSize);
        const x = sourceToCanvas(layerSourcePoint(layer, [0.0001, 0]), store.uiState.finalTransform, canvasSize, mediaSize);
        const y = sourceToCanvas(layerSourcePoint(layer, [0, 0.0001]), store.uiState.finalTransform, canvasSize, mediaSize);
        const expected = [(x[0]-zero[0])*10000, (x[1]-zero[1])*10000, (y[0]-zero[0])*10000, (y[1]-zero[1])*10000];
        // Enlarged local box coordinates and the reduced CSS matrix preserve the same world map.
        expected.forEach((value, i) => expect(Math.abs(values[i] * density - value)).toBeLessThan(1e-4));
        const size = layerSize(layer);
        expect(Number.parseFloat(box.style.width) / density).toBeCloseTo(size[0], 3);
        expect(Number.parseFloat(box.style.height) / density).toBeCloseTo(size[1], 3);
        return density;
      };
      expect(verify()).toBeGreaterThan(1);
      // Imported source-space layers can have no inverse insertion basis and must rasterize at 4x.
      layer.basis = [1, 0, 0, 1]; layer.rotation = 0; layer.scale = 1;
      store.uiState.finalTransform = { ...store.uiState.finalTransform, scale: 4, perspective: [0, 0] };
      await nextTick(); expect(verify()).toBeCloseTo(4, 5);
      // A layer inserted at this zoom already has an inverse basis: do not enlarge it twice.
      layer.basis = [0.25, 0, 0, 0.25]; await nextTick(); expect(verify()).toBeCloseTo(1, 5);
    } finally { wrapper.unmount(); host.remove(); }
  });
  test('brush release outside the surface commits once; cancel/tab changes discard, and text does not intercept erasing', async () => {
    const store = storeForTest(), host = document.createElement('div');
    host.style.cssText = 'position:relative;width:480px;height:360px'; document.body.append(host);
    const source = document.createElement('canvas'); source.width = 256; source.height = 192;
    store.uiState.getSourceImageCanvas = () => source; store.uiState.currentTab = 'brush'; store.uiState.isReady = true;
    const provide = { [MEDIA_EDITOR_INJECTION_KEY as symbol]: { store, mode: 'full', interactions: createInteractions() } };
    const brush = mount(BrushCanvas, { attachTo: host, global: { provide } });
    const text = mount(TextLayers, { attachTo: host, global: { provide } });
    try {
      store.addLayer({ id: 4, type: 'text', position: [180, 140], rotation: 0, scale: 1 }); await nextTick();
      const polygon = host.querySelector('polygon')!; expect(polygon.style.pointerEvents).toBe('none');
      const el = host.querySelector<HTMLElement>('[data-media-editor-brush-surface]')!;
      const rect = el.getBoundingClientRect();
      const point: Vec2 = [81, 64], xy = sourceToCanvas(point, store.uiState.finalTransform, canvasSize, mediaSize);
      const event = (type: string, buttons = 1) => new PointerEvent(type, { bubbles: true, cancelable: true,
        pointerId: 1, button: 0, buttons, clientX: rect.left + xy[0], clientY: rect.top + xy[1] });
      const down = event('pointerdown'); el.dispatchEvent(down); expect(down.defaultPrevented).toBe(true);
      window.dispatchEvent(event('pointerup', 0)); expect(store.mediaState.brushDrawnLines).toHaveLength(1);
      const line = store.mediaState.brushDrawnLines[0]; expect(line.coordinateSpace).toBe('source');
      expect(line.points[0][0]).toBeCloseTo(point[0], 7); expect(line.points[0][1]).toBeCloseTo(point[1], 7);
      el.dispatchEvent(event('pointermove', 0)); expect(store.mediaState.brushDrawnLines).toHaveLength(1);
      el.dispatchEvent(event('pointerdown')); el.dispatchEvent(event('pointercancel', 0));
      expect(store.mediaState.brushDrawnLines).toHaveLength(1);
      el.dispatchEvent(event('pointerdown')); store.uiState.currentTab = 'crop'; await nextTick();
      window.dispatchEvent(event('pointerup', 0)); expect(store.mediaState.brushDrawnLines).toHaveLength(1);
    } finally { text.unmount(); brush.unmount(); host.remove(); }
  });
});

const adapter = navigator.gpu ? await navigator.gpu.requestAdapter().catch(() => null) : null;
describe.skipIf(!adapter)('mixed source layers on real WebGPU', () => {
  test('retained annotation density is independent of intermediate animation frame cadence', async () => {
    const source = document.createElement('canvas'); source.width = 256; source.height = 192;
    const ctx = source.getContext('2d')!; ctx.fillStyle = '#303030'; ctx.fillRect(0, 0, 256, 192);
    const src = source.toDataURL();
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const run = async (sequence: number[]) => {
      const pinia = createPinia(), store = useMediaEditorStore(pinia); store.init({ src, type: 'image', mode: 'sticker' });
      const provide = { [MEDIA_EDITOR_INJECTION_KEY as symbol]: { store, mode: 'sticker', interactions: createInteractions() } };
      const wrapper = mount(MainCanvas, { attachTo: document.body, attrs: { style: 'position:relative;width:512px;height:384px' },
        global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })], provide } });
      try {
        const deadline = performance.now() + 8000;
        while (!store.uiState.isReady) { if (performance.now() > deadline) throw new Error('editor initialization timed out'); await frame(); }
        for (const scale of sequence) {
          store.uiState.finalTransform = { ...store.uiState.finalTransform, scale };
          await nextTick(); await frame();
        }
        return [...store.uiState.annotationRasterSize!];
      } finally { wrapper.unmount(); }
    };
    const manyFrames = await run([2.2, 3, 4.1]);
    const oneFrame = await run([4.1]);
    expect(manyFrames).toEqual(oneFrame); expect(oneFrame).toEqual([2048, 1536]);
  }, 25_000);
  test('small source text and thin pen are rasterized at display/export density; perspective reuses the rasters', async () => {
    const pinia = createPinia(), store = useMediaEditorStore(pinia);
    const source = document.createElement('canvas'); source.width = 64; source.height = 48;
    const original = source.getContext('2d')!; original.fillStyle = '#202020'; original.fillRect(0, 0, 64, 48);
    const src = source.toDataURL(); store.init({ src, type: 'image', mode: 'sticker' });
    const provide = { [MEDIA_EDITOR_INJECTION_KEY as symbol]: { store, mode: 'sticker', interactions: createInteractions() } };
    const wrapper = mount(MainCanvas, { attachTo: document.body,
      attrs: { style: 'position:relative;width:512px;height:384px' },
      global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })], provide } });
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const until = async (check: () => boolean) => { const deadline = performance.now() + 8000;
      while (!check()) { if (performance.now() > deadline) throw new Error('dense annotation render timed out'); await frame(); } };
    let spy: ReturnType<typeof vi.spyOn> | null = null;
    function read(input: CanvasImageSource, width: number, height: number) { const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!; ctx.drawImage(input, 0, 0); return ctx.getImageData(0, 0, width, height); }
    function crisp(image: ImageData) {
      const pen = (Math.round(image.height * 20 / 48) * image.width + Math.round(image.width * 12 / 64)) * 4;
      expect(image.data[pen + 1], 'thin pen should retain an opaque core').toBeGreaterThan(220);
      let white = 0;
      for (let i = 0; i < image.data.length; i += 4) if (image.data[i] > 240 && image.data[i+1] > 240 && image.data[i+2] > 240) white++;
      expect(white, 'small text should have sharp full-coverage glyph interiors').toBeGreaterThan(100);
    }
    try {
      await until(() => store.uiState.isReady);
      const payload = store.uiState.renderingPayload!;
      spy = vi.spyOn(payload.device.queue, 'copyExternalImageToTexture');
      store.mediaState.brushDrawnLines = [{ brush: 'pen', color: '#00ff00', size: 0.65, points: [[12, 8], [12, 36]], coordinateSpace: 'source' }];
      store.mediaState.resizableLayers = [{ id: 9, type: 'text', position: [36, 24], rotation: 0, scale: 1, coordinateSpace: 'source',
        textInfo: { content: 'HI', color: '#ffffff', font: 'roboto', style: 'normal', size: 6, alignment: 'center' } }];
      await until(() => !!store.uiState.brushCanvas && spy!.mock.calls.length >= 2);
      expect(store.uiState.annotationRasterSize).toEqual([512, 384]);
      expect(store.uiState.brushCanvas!.width).toBe(512);
      const canvas = store.uiState.imageCanvas!;
      (wrapper.findComponent(ImageCanvas).vm as unknown as { redraw(): void }).redraw();
      crisp(read(canvas, canvas.width, canvas.height));
      for (let i = 0; i < 3; i++) await frame();
      const copies = spy.mock.calls.length, bitmap = store.uiState.brushCanvas, revision = store.uiState.annotationRevision;
      for (let i = 0; i < 8; i++) { store.mediaState.perspective = [i * 0.06, -i * 0.03]; await nextTick(); await frame(); }
      expect(store.uiState.brushCanvas).toBe(bitmap); expect(store.uiState.annotationRasterSize).toEqual([512, 384]);
      expect(store.uiState.annotationRevision).toBe(revision); expect(spy.mock.calls.length).toBe(copies);
      store.mediaState.perspective = [0, 0]; await nextTick();
      const result = await createFinalResult({ mediaSrc: src, mediaType: 'image', mode: 'sticker', exportFormat: 'png',
        mediaState: store.mediaState, canvasSize: [512, 384], mediaRatio: 64 / 48, renderingPayload: payload });
      const { blob } = await result.getResult(), image = await createImageBitmap(blob);
      expect([image.width, image.height]).toEqual([512, 384]); crisp(read(image, image.width, image.height)); image.close();
      expect(rasterSize([64, 48], 2048, 100)).toEqual([2048, 1536]);
      expect(rasterSize([64, 48], 4096, 100)).toEqual([4096, 3072]);
      expect(store.mediaState.brushDrawnLines[0].points).toEqual([[12, 8], [12, 36]]);
    } finally { spy?.mockRestore(); wrapper.unmount(); }
  }, 25_000);
  test('blur snapshots refresh after GPU mask uploads and reset, without a revision loop', async () => {
    const pinia = createPinia(), store = useMediaEditorStore(pinia);
    const source = document.createElement('canvas'); source.width = 256; source.height = 192;
    const ctx = source.getContext('2d')!; ctx.fillStyle = '#a05030'; ctx.fillRect(0, 0, 256, 192);
    const src = source.toDataURL(); store.init({ src, type: 'image', mode: 'sticker' });
    store.mediaState.brushDrawnLines = [{ brush: 'blur', color: '#ffffff', size: 60, points: [[128, 96]], coordinateSpace: 'source' }];
    const provide = { [MEDIA_EDITOR_INJECTION_KEY as symbol]: { store, mode: 'sticker', interactions: createInteractions() } };
    const wrapper = mount(MainCanvas, { attachTo: document.body, attrs: { style: 'position:relative;width:480px;height:360px' }, global: { plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })], provide } });
    const until = async (check: () => boolean) => {
      const deadline = performance.now() + 6000;
      while (!check()) { if (performance.now() > deadline) throw new Error('mask/blur replay timed out'); await new Promise(resolve => requestAnimationFrame(resolve)); }
    };
    const alpha = () => { const canvas = store.uiState.brushCanvas; return canvas?.getContext('2d')!.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3]; };
    try {
      await until(() => store.uiState.isReady && alpha() === 255);
      const transparent = store.addMaskSource({ width: 256, height: 192, data: new Uint8Array(256 * 192) });
      store.setMaskSource(transparent);
      await until(() => alpha() === 0);
      store.setMaskSource(null); await until(() => alpha() === 255);
      const revision = store.uiState.sourceImageRevision;
      for (let i = 0; i < 4; i++) await new Promise(resolve => requestAnimationFrame(resolve));
      expect(store.uiState.sourceImageRevision).toBe(revision);
    } finally { wrapper.unmount(); }
  }, 20_000);
  test('neutral is pixel exact; Enhance and both blur adjustments affect a tilted non-square mixed-alpha image', async () => {
    const store = storeForTest(), source = document.createElement('canvas'); source.width = 128; source.height = 64;
    const ctx = source.getContext('2d')!;
    for (let x = 12; x < 116; x += 4) {
      ctx.fillStyle = x % 8 ? 'rgba(190,60,35,0.5)' : 'rgba(60,130,185,0.8)'; ctx.fillRect(x, 8, 4, 48);
    }
    const original = ctx.getImageData(0, 0, 128, 64);
    const src = URL.createObjectURL(await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!))));
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
    const { payload, context } = await initWebGPU({ canvas, mediaSrc: src, mediaType: 'image', videoTime: 0, transparent: true });
    const params: DrawingParameters = { rotation: 0, scale: 1, flip: [1, 1], translation: [0, 0], perspective: [0, 0],
      imageSize: [128, 64], curves: store.mediaState.curves, selective: store.mediaState.selective, ...store.mediaState.adjustments };
    const snapshot = () => { const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
      const cx = copy.getContext('2d')!; cx.drawImage(canvas, 0, 0); return cx.getImageData(0, 0, copy.width, copy.height); };
    try {
      draw(payload.device, context, payload, params); const neutral = snapshot(); let worst = 0;
      for (let i = 0; i < original.data.length; i++) worst = Math.max(worst, Math.abs(original.data[i] - neutral.data[i]));
      expect(worst).toBeLessThanOrEqual(2);
      canvas.width = 320; canvas.height = 180;
      Object.assign(params, { rotation: 0.15, scale: 1.6, translation: [7, -4], perspective: [0.48, -0.28] });
      draw(payload.device, context, payload, params); const base = snapshot();
      for (const key of ['enhance', 'tiltShift', 'motionBlur'] as const) {
        draw(payload.device, context, payload, { ...params, [key]: 0.8 }); const adjusted = snapshot(); let changed = 0;
        for (let i = 0; i < base.data.length; i += 4) {
          if (Math.abs(base.data[i] - adjusted.data[i]) + Math.abs(base.data[i+1] - adjusted.data[i+1]) + Math.abs(base.data[i+2] - adjusted.data[i+2]) > 12) changed++;
          if (!adjusted.data[i+3]) expect(Array.from(adjusted.data.slice(i, i + 3))).toEqual([0, 0, 0]);
        }
        expect(changed, key).toBeGreaterThan(100);
        const center = sourceToCanvas([64, 32], params, [320, 180], [128, 64]);
        expect(adjusted.data[(Math.round(center[1]) * 320 + Math.round(center[0])) * 4 + 3], key).toBeGreaterThan(50);
      }
      draw(payload.device, context, payload, params); expect(snapshot().data).toEqual(base.data);
    } finally { cleanupWebGPU(payload); URL.revokeObjectURL(src); }
  }, 30_000);
  test('image, brush, text and sticker share perspective in preview and PNG export', async () => {
    const store = storeForTest(), source = document.createElement('canvas'); source.width = 256; source.height = 192;
    const ctx = source.getContext('2d')!; ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, 256, 192);
    ctx.fillStyle = '#ff0000'; ctx.fillRect(166, 38, 16, 16);
    const src = URL.createObjectURL(await new Promise<Blob>(resolve => source.toBlob(blob => resolve(blob!))));
    const sticker = document.createElement('canvas'); sticker.width = sticker.height = 128;
    const sc = sticker.getContext('2d')!; sc.fillStyle = '#0000ff'; sc.fillRect(0, 0, 128, 128);
    store.mediaState.currentImageRatio = 256 / 192;
    store.mediaState.perspective = [0.55, -0.35]; store.mediaState.rotation = 0.23; store.mediaState.flip = [-1, 1];
    store.mediaState.brushDrawnLines = [{ brush: 'pen', color: '#00ff00', size: 18, points: [[80, 60]], coordinateSpace: 'source' }];
    store.mediaState.resizableLayers = [
      { id: 1, type: 'text', position: [125, 106], scale: 1, rotation: 0, coordinateSpace: 'source',
        textInfo: { content: 'TEST', font: 'roboto', size: 24, color: '#ffffff', style: 'normal', alignment: 'center' } },
      { id: 2, type: 'sticker', position: [190, 142], scale: 0.2, rotation: 0.1, coordinateSpace: 'source', stickerSrc: sticker.toDataURL() },
    ];
    const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = canvasSize;
    const { payload, context } = await initWebGPU({ canvas, mediaSrc: src, mediaType: 'image', videoTime: 0 });
    const params: DrawingParameters = { ...store.uiState.finalTransform, perspective: store.mediaState.perspective,
      imageSize: mediaSize, curves: store.mediaState.curves, selective: store.mediaState.selective, ...store.mediaState.adjustments };
    const read = (input: CanvasImageSource, w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d')!; cx.drawImage(input, 0, 0); return cx.getImageData(0, 0, w, h); };
    function check(image: ImageData, transform: typeof store.uiState.finalTransform) {
      const colour = (point: Vec2) => { const [x, y] = sourceToCanvas(point, transform, [image.width, image.height], mediaSize);
        return Array.from(image.data.slice((Math.round(y) * image.width + Math.round(x)) * 4, (Math.round(y) * image.width + Math.round(x)) * 4 + 4)); };
      const red = colour([174, 46]), green = colour([80, 60]), blue = colour([190, 142]);
      expect(red[0]).toBeGreaterThan(220); expect(red[1]).toBeLessThan(30);
      expect(green[1]).toBeGreaterThan(220); expect(green[0]).toBeLessThan(30);
      expect(blue[2]).toBeGreaterThan(220); expect(blue[0]).toBeLessThan(30);
      const corners = projectedLayerCorners(store.mediaState.resizableLayers[0], { transform,
        canvas: [image.width, image.height], media: mediaSize, dpr: 1 });
      const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]); let whites = 0;
      for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(image.height - 1, Math.ceil(Math.max(...ys))); y++)
        for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(image.width - 1, Math.ceil(Math.max(...xs))); x++) {
          const i = (y * image.width + x) * 4; if (image.data[i] > 180 && image.data[i+1] > 180 && image.data[i+2] > 180) whites++;
        }
      expect(whites).toBeGreaterThan(20);
    }
    try {
      await projectAnnotations(payload, params, store.mediaState, canvasSize);
      draw(payload.device, context, payload, params); check(read(canvas, ...canvasSize), store.uiState.finalTransform);
      const result = await createFinalResult({ mediaSrc: src, mediaType: 'image', mediaState: store.mediaState,
        canvasSize, mediaRatio: 256 / 192, renderingPayload: payload });
      const { blob } = await result.getResult(), bitmap = await createImageBitmap(blob);
      const t = getResultTransform({ scaledWidth: result.width, scaledHeight: result.height,
        imageWidth: 256, imageHeight: 192, cropOffset: { left: 60, top: 60, width: 360, height: 180 }, mediaState: store.mediaState });
      check(read(bitmap, result.width, result.height), { ...t, perspective: store.mediaState.perspective }); bitmap.close();
    } finally { cleanupWebGPU(payload); URL.revokeObjectURL(src); }
  }, 30_000);
});
