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
  if(layer.basis) ctx.transform(...layer.basis,0,0);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = images.get(src); if (cached) return cached;
  if (images.size > 64) images.delete(images.keys().next().value!);
  const loading = load(src).catch(error => { images.delete(src); throw error; });
  images.set(src, loading); return loading;
}
function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
