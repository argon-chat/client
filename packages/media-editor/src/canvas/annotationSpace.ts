import type { EditorLayer, RenderTransform, Vec2 } from '../types';
import type { BrushDrawnLine } from './brushPainter';
import { imageProjection, inverse, inverseBasis, project, projectionBasis } from './projective';

export type AnnotationFrame = { transform: RenderTransform; canvas: Vec2; media: Vec2; dpr: number };
export function sourceLayer(layer: EditorLayer, frame: AnnotationFrame): EditorLayer {
  if (layer.coordinateSpace === 'source') return layer;
  const projection = imageProjection(frame.transform, frame.canvas, frame.media);
  const position = project(inverse(projection), [layer.position[0] * frame.dpr, layer.position[1] * frame.dpr]);
  const basis = inverseBasis(projectionBasis(projection, position)).map(v => v * frame.dpr) as [number, number, number, number];
  return { ...layer, position, basis, coordinateSpace: 'source' };
}
export function sourceLine(line: BrushDrawnLine, frame: AnnotationFrame): BrushDrawnLine {
  if (line.coordinateSpace === 'source') return line;
  const projection = imageProjection(frame.transform, frame.canvas, frame.media);
  const undo = inverse(projection);
  const points = line.points.map(p => project(undo, p));
  const basis = projectionBasis(projection, points[0] ?? [0, 0]);
  const localScale = Math.sqrt(Math.abs(basis[0] * basis[3] - basis[1] * basis[2]));
  return { ...line, points, size: line.size / Math.max(1e-6, localScale), coordinateSpace: 'source' };
}
/** Vector annotations may be denser than the source image, up to the GPU/memory budget. */
export function rasterSize([w, h]: Vec2, maxSide = 2048, density = 1): Vec2 {
  const scale = Math.min(Math.max(1e-6, density), maxSide / Math.max(w, h));
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}
/** Stable quality buckets: animation cadence cannot choose a different retained raster density. */
export function previewRasterSize(media: Vec2, density: number, maxSide = 2048): Vec2 {
  const scale = Number.isFinite(density) ? Math.max(1, density) : 1;
  // Do not promote an exact power of two because of the final transform's floating-point noise.
  const bucket = 2 ** Math.ceil(Math.log2(scale) - 1e-9);
  return rasterSize(media, maxSide, bucket);
}
export function rasterLine(line: BrushDrawnLine, scale: number): BrushDrawnLine {
  return { ...line, size: line.size * scale, points: line.points.map(p => [p[0] * scale, p[1] * scale]) };
}
