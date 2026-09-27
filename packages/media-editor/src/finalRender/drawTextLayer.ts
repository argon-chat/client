import type { EditorLayer } from '../types';
import { contrastingTextColor } from '../color';
import {
  TEXT_BACKGROUND_PADDING,
  TEXT_BACKGROUND_RADIUS,
  TEXT_BOX_INSET,
  TEXT_BOX_MIN_SIZE,
  TEXT_LINE_HEIGHT,
  TEXT_OUTLINE_WIDTH
} from '../constants';
import { canvasFont, fontInfo, layerText } from '../fonts';

/**
 * A text layer as TextLayers.vue shows it: the layer box centred on `position`, turned and scaled
 * about its centre, lines `TEXT_LINE_HEIGHT` apart with the glyphs centred in each as CSS half-leading
 * does. Load the fonts first (`loadLayerFonts`): the canvas draws with whatever face is loaded.
 */
export default function drawTextLayer(ctx: CanvasRenderingContext2D, layer: EditorLayer): void {
  if (layer.type !== 'text') return;
  const info = layer.textInfo;
  if (!info) {
    console.warn('[media-editor] text layer without text info, not drawn', layer.id);
    return;
  }

  ctx.save();
  // An unparseable font is ignored by the canvas, which would keep its 10 px default instead.
  ctx.font = `${fontInfo(info.font).fontWeight} ${info.size}px sans-serif`;
  ctx.font = canvasFont(info);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // `white-space: pre` makes no line of a trailing break.
  const lines = layerText(info).replace(/\n$/, '').split('\n');
  const widths = lines.map((line) => ctx.measureText(line).width);
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = ctx.measureText(' ');
  const lineHeight = info.size * TEXT_LINE_HEIGHT;
  const baseline = (lineHeight - (ascent + descent)) / 2 + ascent;
  const [padX, padY] = info.style === 'background' ? TEXT_BACKGROUND_PADDING : [0, 0];
  const blockW = Math.max(TEXT_BOX_MIN_SIZE[0] - 2 * TEXT_BOX_INSET, Math.max(...widths) + 2 * padX);
  const blockH = lines.length * lineHeight + 2 * padY;
  const boxH = Math.max(TEXT_BOX_MIN_SIZE[1], blockH + 2 * TEXT_BOX_INSET);

  ctx.translate(layer.position[0], layer.position[1]);
  ctx.rotate(layer.rotation);
  ctx.scale(layer.scale, layer.scale);
  ctx.translate(-blockW / 2, -boxH / 2 + TEXT_BOX_INSET);

  if (info.style === 'background') {
    ctx.fillStyle = info.color;
    ctx.beginPath();
    ctx.roundRect(0, 0, blockW, blockH, TEXT_BACKGROUND_RADIUS);
    ctx.fill();
    ctx.fillStyle = contrastingTextColor(info.color);
  } else if (info.style === 'outline') {
    ctx.strokeStyle = info.color;
    ctx.lineWidth = TEXT_OUTLINE_WIDTH;
    ctx.miterLimit = 4;
  } else {
    ctx.fillStyle = info.color;
  }

  const innerW = blockW - 2 * padX;
  lines.forEach((line, i) => {
    const free = innerW - widths[i];
    const x = padX + (info.alignment === 'center' ? free / 2 : info.alignment === 'right' ? free : 0);
    const y = padY + i * lineHeight + baseline;
    if (info.style === 'outline') ctx.strokeText(line, x, y);
    else ctx.fillText(line, x, y);
  });

  ctx.restore();
}
