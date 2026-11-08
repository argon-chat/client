import type { EditorLayer, Vec2 } from '../types';
import { createBrushPainter, type BrushDrawnLine } from './brushPainter';
import { rasterLine, rasterSize } from './annotationSpace';
import drawTextLayer from '../finalRender/drawTextLayer';
import drawStickerLayer from '../finalRender/drawStickerLayer';
import { loadLayerFonts } from '../fonts';

export async function drawAnnotationLayers(canvas: HTMLCanvasElement, layers: EditorLayer[], mediaSize: Vec2): Promise<void> {
  await loadLayerFonts(layers);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save(); ctx.scale(canvas.width / mediaSize[0], canvas.height / mediaSize[1]);
  try {
    for (const layer of layers) {
      if (layer.type === 'text') drawTextLayer(ctx, layer);
      else await drawStickerLayer(ctx, layer);
    }
  } finally { ctx.restore(); }
}
export async function createAnnotationRaster(mediaSize: Vec2, lines: BrushDrawnLine[], layers: EditorLayer[],
  source: () => HTMLCanvasElement, maxSide = 4096, density = 1) {
  const size = rasterSize(mediaSize, maxSide, density);
  const brush = document.createElement('canvas'), text = document.createElement('canvas');
  brush.width = text.width = size[0]; brush.height = text.height = size[1];
  const painter = createBrushPainter({ targetCanvas: brush, imageCanvas: source, blurRadius: 10 * size[0] / mediaSize[0] });
  try {
    if (lines.length) painter.redrawAll(lines.map(line => rasterLine(line, size[0] / mediaSize[0])));
    await drawAnnotationLayers(text, layers, mediaSize);
    return { brush, layers: text, dispose() { painter.dispose(); brush.width = brush.height = text.width = text.height = 0; } };
  } catch (e) { painter.dispose(); brush.width = brush.height = text.width = text.height = 0; throw e; }
}
