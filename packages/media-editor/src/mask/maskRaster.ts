import type { MaskRaster, MaskStroke, Vec2 } from '../types';
import { featherMask } from './maskMath';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type DirtyRect = { x: number; y: number; width: number; height: number };

export interface MaskRasterCanvas {
  readonly canvas: AnyCanvas;
  readonly width: number;
  readonly height: number;
  /** Mask pixels per source pixel. */
  readonly scale: number;
  /** Redraws everything: the (feathered) source, or opaque white, then every stroke. */
  render(source: MaskRaster | null, feather: number, strokes: readonly MaskStroke[]): void;
  /** Adds the stroke's points from `from` on top of what is there; returns the area touched. */
  drawStroke(stroke: MaskStroke, from?: number): DirtyRect;
  /** The mask as one byte per pixel. */
  read(): Uint8Array;
  dispose(): void;
}

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), { width, height });
}

/**
 * The mask lives in the alpha channel of a 2D canvas (white, alpha = coverage), which is what gets
 * uploaded to the GPU and multiplied into the image. Erasing is `destination-out`, restoring paints
 * opaque white over it.
 */
export function createMaskRaster(width: number, height: number, scale: number): MaskRasterCanvas {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as AnyContext2D;

  let baseKey: { source: MaskRaster; feather: number } | null = null;
  let baseImage: ImageData | null = null;

  function baseFor(source: MaskRaster, feather: number): ImageData {
    if (baseImage && baseKey?.source === source && baseKey.feather === feather) return baseImage;
    let data = feather > 0 ? featherMask(source.data, source.width, source.height, feather) : source.data;
    let w = source.width;
    let h = source.height;
    if (w !== width || h !== height) {
      data = resampleMaskNearestArea(data, w, h, width, height);
      w = width;
      h = height;
    }
    const image = new ImageData(w, h);
    const px = image.data;
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      px[j] = 255;
      px[j + 1] = 255;
      px[j + 2] = 255;
      px[j + 3] = data[i];
    }
    baseKey = { source, feather };
    baseImage = image;
    return image;
  }

  function strokePath(stroke: MaskStroke, from: number): DirtyRect {
    const pts = stroke.points;
    const lw = Math.max(1, stroke.size * scale);
    const start = Math.max(0, from - 1);
    const at = (p: Vec2): Vec2 => [p[0] * scale, p[1] * scale];

    ctx.save();
    ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const grow = (p: Vec2) => {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    };

    if (pts.length - start === 1 || pts.length === 1) {
      const p = at(pts[pts.length - 1]);
      grow(p);
      ctx.beginPath();
      ctx.arc(p[0], p[1], lw / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (pts.length > start + 1) {
      ctx.beginPath();
      const first = at(pts[start]);
      grow(first);
      ctx.moveTo(first[0], first[1]);
      for (let i = start + 1; i < pts.length; i++) {
        const p = at(pts[i]);
        grow(p);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }
    ctx.restore();

    if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    const pad = lw / 2 + 2;
    const x = Math.max(0, Math.floor(minX - pad));
    const y = Math.max(0, Math.floor(minY - pad));
    const x2 = Math.min(width, Math.ceil(maxX + pad));
    const y2 = Math.min(height, Math.ceil(maxY + pad));
    return { x, y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) };
  }

  return {
    canvas,
    width,
    height,
    scale,
    render(source, feather, strokes) {
      ctx.save();
      ctx.globalCompositeOperation = 'copy';
      if (source) {
        ctx.putImageData(baseFor(source, feather), 0, 0);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
      for (const stroke of strokes) strokePath(stroke, 0);
    },
    drawStroke(stroke, from = 0) {
      return strokePath(stroke, from);
    },
    read() {
      const px = ctx.getImageData(0, 0, width, height).data;
      const out = new Uint8Array(width * height);
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3];
      return out;
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
      baseImage = null;
      baseKey = null;
    },
  };
}

/** Area-average down, nearest up: good enough for a mask that is already at about this size. */
export function resampleMaskNearestArea(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((y + 1) * sy)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((x + 1) * sx)));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += src[yy * sw + xx];
      out[y * dw + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return out;
}
