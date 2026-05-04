import type { EditorLayer } from '../types';
import { FONT_REGISTRY } from '../constants';

/**
 * Render a text layer onto a canvas 2D context at its current position/rotation/scale.
 */
export default function renderTextOverlay(ctx: CanvasRenderingContext2D, layer: EditorLayer) {
  if (layer.type !== 'text' || !layer.textInfo || !layer.textRenderingInfo) return;

  const { textInfo, textRenderingInfo, position, rotation, scale } = layer;
  const font = FONT_REGISTRY[textInfo.font];

  ctx.save();
  ctx.translate(position[0], position[1]);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);

  ctx.font = `${font.fontWeight} ${textInfo.size}px ${font.fontFamily}`;
  ctx.textBaseline = 'top';

  if (textInfo.style === 'fill') {
    ctx.fillStyle = textInfo.color;
  } else if (textInfo.style === 'stroke') {
    ctx.strokeStyle = textInfo.color;
    ctx.lineWidth = 2;
  } else {
    // outline: white fill + colored stroke
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = textInfo.color;
    ctx.lineWidth = 3;
  }

  const { lines } = textRenderingInfo;
  let y = 0;

  for (const line of lines) {
    const x = textInfo.alignment === 'center'
      ? (textRenderingInfo.width - (line.right - line.left)) / 2
      : textInfo.alignment === 'right'
        ? textRenderingInfo.width - (line.right - line.left)
        : 0;

    if (textInfo.style === 'stroke') {
      ctx.strokeText(line.content, x, y);
    } else if (textInfo.style === 'outline') {
      ctx.strokeText(line.content, x, y);
      ctx.fillText(line.content, x, y);
    } else {
      ctx.fillText(line.content, x, y);
    }

    y += line.height;
  }

  ctx.restore();
}
