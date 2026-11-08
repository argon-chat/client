import type { EditorLayer, Vec2 } from '../types';
import { TEXT_BACKGROUND_PADDING, TEXT_BOX_INSET, TEXT_BOX_MIN_SIZE, TEXT_LINE_HEIGHT } from '../constants';
import { canvasFont, layerText } from '../fonts';
import { imageProjection, project } from './projective';
import type { AnnotationFrame } from './annotationSpace';
let measuring: CanvasRenderingContext2D | null = null;
export function layerSize(layer: EditorLayer): Vec2 {
  if (layer.type === 'sticker') return [128, 128];
  const info = layer.textInfo; if (!info) return [40, 24];
  measuring ??= document.createElement('canvas').getContext('2d')!;
  measuring.font = canvasFont(info);
  const lines = layerText(info).replace(/\n$/, '').split('\n');
  const pad = info.style === 'background' ? TEXT_BACKGROUND_PADDING : [0, 0];
  return [Math.max(TEXT_BOX_MIN_SIZE[0], Math.max(...lines.map(line => measuring!.measureText(line).width)) + 2 * pad[0] + 2 * TEXT_BOX_INSET),
    Math.max(TEXT_BOX_MIN_SIZE[1], lines.length * info.size * TEXT_LINE_HEIGHT + 2 * pad[1] + 2 * TEXT_BOX_INSET)];
}
export function layerSourcePoint(layer: EditorLayer, [x, y]: Vec2): Vec2 {
  const c = Math.cos(layer.rotation) * layer.scale, s = Math.sin(layer.rotation) * layer.scale;
  const u = c * x - s * y, v = s * x + c * y;
  const [a, b, d, e] = layer.basis ?? [1, 0, 0, 1];
  return [layer.position[0] + a * u + d * v, layer.position[1] + b * u + e * v];
}
export function projectedLayerCorners(layer: EditorLayer, frame: AnnotationFrame): Vec2[] {
  const [w, h] = layerSize(layer), projection = imageProjection(frame.transform, frame.canvas, frame.media);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Vec2[])
    .map(point => project(projection, layerSourcePoint(layer, point))).map(point => [point[0] / frame.dpr, point[1] / frame.dpr]);
}
