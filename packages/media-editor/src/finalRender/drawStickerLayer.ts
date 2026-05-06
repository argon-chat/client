import type { EditorLayer } from '../types';

/**
 * Render a sticker layer onto a canvas 2D context at its current position/rotation/scale.
 * Returns a promise because it needs to load the image.
 */
export default async function drawStickerLayer(ctx: CanvasRenderingContext2D, layer: EditorLayer): Promise<void> {
  if (layer.type !== 'sticker' || !layer.stickerSrc) return;

  const img = await loadImage(layer.stickerSrc);
  const { position, rotation, scale } = layer;

  ctx.save();
  ctx.translate(position[0], position[1]);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
