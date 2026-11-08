import type { EditingMediaState } from '../store/editorStore';
import type { Vec2 } from '../types';
import type { RenderingPayload } from '../webgpu/initWebGPU';
import { draw, type DrawingParameters } from '../webgpu/draw';
import { uploadAnnotation } from '../webgpu/annotations';
import { getPreferredFormat } from '../webgpu/initDevice';
import { createAnnotationRaster } from '../canvas/annotationRaster';
import { rasterSize, sourceLayer, sourceLine, type AnnotationFrame } from '../canvas/annotationSpace';
import { fitToAspectRatio } from '../geometry';

/** The normal preview's transform, for importing a snapshot from the viewport-coordinate editor. */
export function legacyAnnotationFrame(state: EditingMediaState, media: Vec2, canvasSize: Vec2, dpr: number): AnnotationFrame {
  const co = { width: canvasSize[0] - 120, height: canvasSize[1] - 180 };
  const ratio = state.currentImageRatio || media[0] / media[1];
  const [imageW] = fitToAspectRatio(media[0] / media[1], co.width, co.height);
  const [cropW] = fitToAspectRatio(ratio, co.width, co.height);
  const [normalW] = fitToAspectRatio(ratio, canvasSize[0], canvasSize[1]);
  const k = normalW / cropW;
  return { media, canvas: [Math.round(canvasSize[0] * dpr), Math.round(canvasSize[1] * dpr)], dpr,
    transform: { rotation: state.rotation, scale: state.scale * imageW / media[0] * k * dpr,
      translation: [state.translation[0] * k * dpr, state.translation[1] * k * dpr], flip: state.flip, perspective: state.perspective } };
}
/** Upload once; image/video/expression export then uses the same warped rasters as the preview. */
export async function projectAnnotations(payload: RenderingPayload, params: DrawingParameters, state: EditingMediaState,
  canvasSize: Vec2, dpr = 1): Promise<void> {
  if (!state.brushDrawnLines.length && !state.resizableLayers.length) return;
  const size: Vec2 = [payload.media.width, payload.media.height];
  const frame = legacyAnnotationFrame(state, size, canvasSize, dpr);
  const density = Math.max(1, params.scale);
  const layers = state.resizableLayers.map(layer => sourceLayer(layer, frame));
  const lines = state.brushDrawnLines.map(line => sourceLine(line, frame));
  let source: HTMLCanvasElement | null = null, context: GPUCanvasContext | null = null;
  const getSource = () => {
    if (!source) {
      source = document.createElement('canvas'); [source.width, source.height] = rasterSize(size, 4096, density);
      context = source.getContext('webgpu')!;
      context.configure({ device: payload.device, format: getPreferredFormat(), alphaMode: 'premultiplied' });
      draw(payload.device, context, { ...payload, compositor: undefined }, { ...params, rotation: 0, scale: source.width / size[0],
        translation: [0, 0], imageSize: size, flip: [1, 1], perspective: [0, 0] }, null, false, 0);
    }
    return source;
  };
  try {
    const raster = await createAnnotationRaster(size, lines, layers, getSource, 4096, density);
    try {
      if (lines.length) uploadAnnotation(payload, 'brush', raster.brush);
      if (layers.length) uploadAnnotation(payload, 'layers', raster.layers);
    } finally { raster.dispose(); }
  } finally {
    (context as GPUCanvasContext | null)?.unconfigure();
    if (source) (source as HTMLCanvasElement).width = (source as HTMLCanvasElement).height = 0;
  }
}
