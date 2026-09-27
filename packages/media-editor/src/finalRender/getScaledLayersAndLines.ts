import type { EditorLayer, Vec2 } from '../types';
import type { BrushDrawnLine } from '../canvas/brushPainter';
import { fitToAspectRatio } from '../geometry';

export interface ScaledOutput {
  scaledLayers: EditorLayer[];
  scaledLines: BrushDrawnLine[];
}

interface ScaleInput {
  layers: EditorLayer[];
  lines: BrushDrawnLine[];
  /** The editor canvas, CSS pixels: where layers are placed. */
  canvasSize: Vec2;
  resultSize: Vec2;
  /** The crop's aspect ratio: outside the crop tab the crop rect is this, contained in the canvas and centred. */
  cropRatio: number;
  /** Brush lines are drawn in device pixels. */
  pixelRatio?: number;
}

/**
 * Layers and brush lines from the editor canvas to the export: the crop rect the user sees maps
 * onto the result, centre to centre, the same way the image does.
 */
export default function getScaledLayersAndLines({ layers, lines, canvasSize, resultSize, cropRatio, pixelRatio = 1 }: ScaleInput): ScaledOutput {
  const [cropW, cropH] = fitToAspectRatio(cropRatio > 0 ? cropRatio : resultSize[0] / resultSize[1], canvasSize[0], canvasSize[1]);
  const k = Math.max(resultSize[0] / cropW, resultSize[1] / cropH);
  const map = ([x, y]: Vec2): Vec2 => [
    (x - canvasSize[0] / 2) * k + resultSize[0] / 2,
    (y - canvasSize[1] / 2) * k + resultSize[1] / 2
  ];

  const scaledLayers = layers.map(layer => ({
    ...layer,
    position: map(layer.position),
    scale: layer.scale * k,
  }));

  const scaledLines = lines.map(line => ({
    ...line,
    size: (line.size / pixelRatio) * k,
    points: line.points.map(([x, y]) => map([x / pixelRatio, y / pixelRatio])),
  }));

  return { scaledLayers, scaledLines };
}
