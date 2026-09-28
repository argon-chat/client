import { toRaw } from 'vue';
import type { MaskOp, MaskPolygonOp, MaskRaster, MaskRasterOp, MaskStroke, Vec2 } from '../types';
import { featherMask } from './maskMath';
import { selectionCoverage } from '../selection/polygon';
import { expandColour, type CoverageRect } from '../selection/coverage';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type DirtyRect = { x: number; y: number; width: number; height: number };

/** The rasters behind `MaskRasterOp.raster` (and the base), by id. */
export type MaskSourceResolver = (id: number | null) => MaskRaster | null;

export interface MaskRasterCanvas {
  readonly canvas: AnyCanvas;
  /**
   * The eraser colours at mask resolution (RGBA: the colour a source pixel takes where alpha is
   * 255), or null while no op has drawn any since the last render.
   */
  readonly colourCanvas: AnyCanvas | null;
  readonly width: number;
  readonly height: number;
  /** Mask pixels per source pixel. */
  readonly scale: number;
  /** Redraws everything: the (feathered) source, or opaque white, then every op in order. */
  render(source: MaskRaster | null, feather: number, ops: readonly MaskOp[], resolve?: MaskSourceResolver): void;
  /** Adds the stroke's points from `from` on top of what is there; returns the area touched. */
  drawStroke(stroke: MaskStroke, from?: number): DirtyRect;
  /** Replaces the mask in `rect` with `alpha` (one byte per pixel, rect-sized). */
  putAlpha(rect: DirtyRect, alpha: Uint8Array): void;
  /** Replaces the colours in `rect` with `rgba` (rect-sized). */
  putColour(rect: DirtyRect, rgba: Uint8Array | Uint8ClampedArray): void;
  /** The mask as one byte per pixel. */
  read(): Uint8Array;
  /** The colours as RGBA, or null when there are none. */
  readColour(): Uint8ClampedArray | null;
  dispose(): void;
}

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  return Object.assign(document.createElement('canvas'), { width, height });
}

function alphaImage(width: number, height: number, alpha: Uint8Array): ImageData {
  const image = new ImageData(width, height);
  const px = image.data;
  for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
    px[j] = 255;
    px[j + 1] = 255;
    px[j + 2] = 255;
    px[j + 3] = alpha[i];
  }
  return image;
}

/** Sparse eraser colours (pixel index, 0xRRGGBB) as RGBA over just their box within the raster. */
function colourRect(pairs: Uint32Array, rasterWidth: number): CoverageRect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const x = pairs[k] % rasterWidth;
    const y = (pairs[k] - x) / rasterWidth;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < x0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const rebased = new Uint32Array(pairs.length);
  for (let k = 0; k + 1 < pairs.length; k += 2) {
    const x = pairs[k] % rasterWidth;
    const y = (pairs[k] - x) / rasterWidth;
    rebased[k] = (y - y0) * w + (x - x0);
    rebased[k + 1] = pairs[k + 1];
  }
  return { x: x0, y: y0, width: w, height: h, data: expandColour(rebased, w, h) };
}

function rgbaImage(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): ImageData {
  const image = new ImageData(width, height);
  image.data.set(rgba.subarray(0, width * height * 4));
  return image;
}

// ─── Op layers ─────────────────────────────────────────────────────
// A selection or eraser result drawn as a canvas, kept for the next full redraw (every state change
// redraws the mask). A few of them only: they are 4 bytes a pixel.

type Layer = { canvas: AnyCanvas | null; x: number; y: number; key: string };

const layers = new Map<object, Layer>();
const MAX_LAYERS = 12;
const MAX_LAYER_PIXELS = 16_000_000;

function layerFor(owner: object, key: string, build: () => CoverageRect | null, colour = false): Layer {
  const cached = layers.get(owner);
  if (cached && cached.key === key) {
    layers.delete(owner);
    layers.set(owner, cached);
    return cached;
  }
  if (cached) release(owner, cached);
  const c = build();
  let layer: Layer = { canvas: null, x: 0, y: 0, key };
  if (c && c.width > 0 && c.height > 0) {
    const canvas = makeCanvas(c.width, c.height);
    const image = colour ? rgbaImage(c.width, c.height, c.data) : alphaImage(c.width, c.height, c.data);
    (canvas.getContext('2d') as AnyContext2D).putImageData(image, 0, 0);
    layer = { canvas, x: c.x, y: c.y, key };
  }
  layers.set(owner, layer);
  let pixels = 0;
  for (const l of layers.values()) pixels += l.canvas ? l.canvas.width * l.canvas.height : 0;
  for (const [k, l] of layers) {
    if (layers.size <= MAX_LAYERS && pixels <= MAX_LAYER_PIXELS) break;
    if (k === owner) continue;
    pixels -= l.canvas ? l.canvas.width * l.canvas.height : 0;
    release(k, l);
  }
  return layer;
}

function release(owner: object, layer: Layer) {
  layers.delete(owner);
  if (layer.canvas) {
    layer.canvas.width = 0;
    layer.canvas.height = 0;
  }
}

/**
 * The mask lives in the alpha channel of a 2D canvas (white, alpha = coverage), which is what gets
 * uploaded to the GPU and multiplied into the image. Erasing is `destination-out`, restoring paints
 * opaque white over it. The erasers' decontaminated colours go to a second canvas, drawn in op
 * order over each other; a restore stroke clears them, giving the pixels their own colour back.
 */
export function createMaskRaster(width: number, height: number, scale: number): MaskRasterCanvas {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as AnyContext2D;
  let colourCanvas: AnyCanvas | null = null;
  let colourCtx: AnyContext2D | null = null;
  let colourUsed = false;

  let baseKey: { source: MaskRaster; feather: number } | null = null;
  let baseImage: ImageData | null = null;

  function colourContext(): AnyContext2D {
    if (!colourCtx) {
      colourCanvas = makeCanvas(width, height);
      colourCtx = colourCanvas.getContext('2d', { willReadFrequently: true }) as AnyContext2D;
    }
    colourUsed = true;
    return colourCtx;
  }

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
    const image = alphaImage(w, h, data);
    baseKey = { source, feather };
    baseImage = image;
    return image;
  }

  function tracePath(target: AnyContext2D, stroke: MaskStroke, from: number, op: GlobalCompositeOperation): DirtyRect {
    const pts = stroke.points;
    const lw = Math.max(1, stroke.size * scale);
    const start = Math.max(0, from - 1);
    const at = (p: Vec2): Vec2 => [p[0] * scale, p[1] * scale];

    target.save();
    target.globalCompositeOperation = op;
    target.fillStyle = '#ffffff';
    target.strokeStyle = '#ffffff';
    target.lineWidth = lw;
    target.lineCap = 'round';
    target.lineJoin = 'round';

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
      target.beginPath();
      target.arc(p[0], p[1], lw / 2, 0, Math.PI * 2);
      target.fill();
    } else if (pts.length > start + 1) {
      target.beginPath();
      const first = at(pts[start]);
      grow(first);
      target.moveTo(first[0], first[1]);
      for (let i = start + 1; i < pts.length; i++) {
        const p = at(pts[i]);
        grow(p);
        target.lineTo(p[0], p[1]);
      }
      target.stroke();
    }
    target.restore();

    if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
    const pad = lw / 2 + 2;
    const x = Math.max(0, Math.floor(minX - pad));
    const y = Math.max(0, Math.floor(minY - pad));
    const x2 = Math.min(width, Math.ceil(maxX + pad));
    const y2 = Math.min(height, Math.ceil(maxY + pad));
    return { x, y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) };
  }

  function strokePath(stroke: MaskStroke, from: number): DirtyRect {
    const rect = tracePath(ctx, stroke, from, stroke.mode === 'erase' ? 'destination-out' : 'source-over');
    if (stroke.mode === 'restore' && colourUsed && colourCtx) tracePath(colourCtx, stroke, from, 'destination-out');
    return rect;
  }

  function drawPolygon(op: MaskPolygonOp) {
    const outside = op.region === 'outside';
    const layer = layerFor(toRaw(op), `${width}x${height}@${scale}`, () => {
      const c = selectionCoverage(op.points, op.feather, width, height, scale, op.antiAlias !== false);
      if (c && outside) for (let i = 0; i < c.data.length; i++) c.data[i] = 255 - c.data[i];
      return c;
    });
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const { canvas: layerCanvas, x, y } = layer;
    if (layerCanvas) ctx.drawImage(layerCanvas, x, y);
    ctx.restore();
    if (!outside) return;
    // Beyond the selection's box everything is outside it.
    if (!layerCanvas) {
      ctx.clearRect(0, 0, width, height);
      return;
    }
    const w = layerCanvas.width;
    const h = layerCanvas.height;
    ctx.clearRect(0, 0, width, y);
    ctx.clearRect(0, y + h, width, height - y - h);
    ctx.clearRect(0, y, x, h);
    ctx.clearRect(x + w, y, width - x - w, h);
  }

  function drawRasterOp(op: MaskRasterOp, resolve?: MaskSourceResolver) {
    const raster = resolve?.(op.raster);
    const [a, b] = op.points;
    if (!raster || !a || !b) return;
    const layer = layerFor(raster, 'raster', () => ({ x: 0, y: 0, width: raster.width, height: raster.height, data: raster.data }));
    if (!layer.canvas) return;
    // Made at this resolution it lands on whole pixels, copied as it is; otherwise it is resampled.
    const snap = (v: number) => (Math.abs(v - Math.round(v)) < 1e-3 ? Math.round(v) : v);
    const x = snap(a[0] * scale);
    const y = snap(a[1] * scale);
    const w = snap((b[0] - a[0]) * scale);
    const h = snap((b[1] - a[1]) * scale);
    const exact = w === raster.width && h === raster.height && Number.isInteger(x) && Number.isInteger(y);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.imageSmoothingEnabled = !exact;
    ctx.drawImage(layer.canvas, x, y, w, h);
    ctx.restore();

    const colour = raster.colour;
    if (!colour?.length) return;
    const colourLayer = layerFor(colour, 'colour', () => colourRect(colour, raster.width), true);
    if (!colourLayer.canvas) return;
    const kx = w / raster.width;
    const ky = h / raster.height;
    const target = colourContext();
    target.save();
    target.globalCompositeOperation = 'source-over';
    target.imageSmoothingEnabled = !exact;
    target.drawImage(colourLayer.canvas, x + colourLayer.x * kx, y + colourLayer.y * ky, colourLayer.canvas.width * kx, colourLayer.canvas.height * ky);
    target.restore();
  }

  return {
    canvas,
    get colourCanvas() {
      return colourUsed ? colourCanvas : null;
    },
    width,
    height,
    scale,
    render(source, feather, ops, resolve) {
      ctx.save();
      ctx.globalCompositeOperation = 'copy';
      if (source) {
        ctx.putImageData(baseFor(source, feather), 0, 0);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
      if (colourCtx) colourCtx.clearRect(0, 0, width, height);
      colourUsed = false;
      for (const op of ops) {
        if (op.kind === 'polygon') drawPolygon(op);
        else if (op.kind === 'raster') drawRasterOp(op, resolve);
        else strokePath(op, 0);
      }
    },
    drawStroke(stroke, from = 0) {
      return strokePath(stroke, from);
    },
    putAlpha(rect, alpha) {
      if (rect.width <= 0 || rect.height <= 0) return;
      ctx.putImageData(alphaImage(rect.width, rect.height, alpha), rect.x, rect.y);
    },
    putColour(rect, rgba) {
      if (rect.width <= 0 || rect.height <= 0) return;
      colourContext().putImageData(rgbaImage(rect.width, rect.height, rgba), rect.x, rect.y);
    },
    read() {
      const px = ctx.getImageData(0, 0, width, height).data;
      const out = new Uint8Array(width * height);
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3];
      return out;
    },
    readColour() {
      if (!colourUsed || !colourCtx) return null;
      return colourCtx.getImageData(0, 0, width, height).data;
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
      if (colourCanvas) {
        colourCanvas.width = 0;
        colourCanvas.height = 0;
      }
      colourCanvas = null;
      colourCtx = null;
      colourUsed = false;
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
