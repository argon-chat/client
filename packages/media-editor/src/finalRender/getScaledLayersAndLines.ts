import type { EditorLayer, Vec2 } from '../types';
import type { BrushDrawnLine } from '../canvas/brushPainter';

export interface ScaledOutput {
  scaledLayers: EditorLayer[];
  scaledLines: BrushDrawnLine[];
}

interface ScaleInput {
  layers: EditorLayer[];
  lines: BrushDrawnLine[];
  canvasSize: Vec2;
  resultSize: Vec2;
}

/**
 * Scale layers and brush lines from editor canvas resolution to export resolution.
 */
export default function getScaledLayersAndLines({ layers, lines, canvasSize, resultSize }: ScaleInput): ScaledOutput {
  const xFactor = resultSize[0] / canvasSize[0];
  const yFactor = resultSize[1] / canvasSize[1];
  const uniformFactor = Math.max(xFactor, yFactor);

  const scaledLayers = layers.map(layer => ({
    ...layer,
    position: [layer.position[0] * xFactor, layer.position[1] * yFactor] as Vec2,
    scale: layer.scale * uniformFactor,
  }));

  const scaledLines = lines.map(line => ({
    ...line,
    size: line.size * uniformFactor,
    points: line.points.map(([x, y]) => [x * xFactor, y * yFactor] as Vec2),
  }));

  return { scaledLayers, scaledLines };
}
