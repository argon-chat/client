import type { Vec2 } from '../types';
import { pointDistance } from '../geometry';
import { hexToRgbaTuple } from '../color';
import { tween, type TweenHandle } from '../animation';

// ─── Types ─────────────────────────────────────────────────────────

export type BrushDrawnLine = {
  coordinateSpace?: 'source';
  color: string;
  brush: string;
  size: number;
  points: Vec2[];
};

export interface BrushRenderer {
  render(ctx: CanvasRenderingContext2D, line: BrushDrawnLine, helpers: PaintHelpers, finish: boolean): void;
}

export interface PaintHelpers {
  traceSmoothPath(ctx: CanvasRenderingContext2D, line: BrushDrawnLine): void;
  blurredImageCanvas: HTMLCanvasElement;
  blurredLineCtx: CanvasRenderingContext2D;
  blurredLineCanvas: HTMLCanvasElement;
}

export interface BrushPainterAPI {
  preview(line: BrushDrawnLine, finish?: boolean): void;
  commit(): void;
  commitLine(line: BrushDrawnLine): void;
  redrawAll(lines: BrushDrawnLine[]): void;
  /** Drops the line being previewed: back to what is committed. */
  discard(): void;
  clear(): void;
  invalidateSource(): void;
  dispose(): void;
  animateArrow(line: BrushDrawnLine): Promise<void>;
}

// ─── Smooth path tracing ───────────────────────────────────────────

function traceSmoothPath(ctx: CanvasRenderingContext2D, line: BrushDrawnLine): void {
  const { points, size } = line;
  if (!points.length) return;

  // Single dot
  if (points.length === 1) {
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(points[0][0], points[0][1], size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);

  // Quadratic bezier through midpoints for smooth interpolation
  for (let i = 1; i < points.length - 2; i++) {
    const mx = (points[i][0] + points[i + 1][0]) * 0.5;
    const my = (points[i][1] + points[i + 1][1]) * 0.5;
    ctx.quadraticCurveTo(points[i][0], points[i][1], mx, my);
  }

  const last = points.length - 1;
  ctx.quadraticCurveTo(points[last - 1][0], points[last - 1][1], points[last][0], points[last][1]);
  ctx.stroke();
}

// ─── Arrow head geometry ───────────────────────────────────────────

function computeArrowLength(strokeSize: number): number {
  return Math.sqrt(strokeSize) + strokeSize * 2.5;
}

function renderArrowHead(ctx: CanvasRenderingContext2D, line: BrushDrawnLine, length: number): void {
  const { points, size, color } = line;
  if (points.length < 2) return;

  const tip = points[points.length - 1];
  // Find a reference point far enough from tip to compute direction
  let refIdx = points.length - 1;
  while (refIdx > 0 && pointDistance(tip, points[refIdx]) <= size * 0.5) refIdx--;
  const ref = points[refIdx];

  const direction = Math.atan2(tip[0] - ref[0], tip[1] - ref[1]) + Math.PI;
  const spread = Math.PI / 4;

  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(tip[0] + length * Math.sin(direction + spread), tip[1] + length * Math.cos(direction + spread));
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(tip[0] + length * Math.sin(direction - spread), tip[1] + length * Math.cos(direction - spread));
  ctx.stroke();
}

// ─── Built-in brush renderers ──────────────────────────────────────

const penBrush: BrushRenderer = {
  render(ctx, line, helpers) {
    ctx.strokeStyle = line.color;
    helpers.traceSmoothPath(ctx, line);
  }
};

const arrowBrush: BrushRenderer = {
  render(ctx, line, helpers, finish) {
    ctx.strokeStyle = line.color;
    helpers.traceSmoothPath(ctx, line);
    if (finish && line.points.length >= 2) {
      renderArrowHead(ctx, line, computeArrowLength(line.size));
    }
  }
};

const softBrush: BrushRenderer = {
  render(ctx, line, helpers) {
    const [r, g, b, a] = hexToRgbaTuple(line.color);
    ctx.strokeStyle = `rgba(${r},${g},${b},${a * 0.4})`;
    helpers.traceSmoothPath(ctx, line);
  }
};

const neonBrush: BrushRenderer = {
  render(ctx, line, helpers) {
    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur = line.size;
    ctx.shadowColor = line.color;
    helpers.traceSmoothPath(ctx, line);
  }
};

const blurBrush: BrushRenderer = {
  render(ctx, line, helpers) {
    const { blurredLineCtx, blurredLineCanvas, blurredImageCanvas } = helpers;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    blurredLineCtx.clearRect(0, 0, w, h);

    if (!line.points.length) return;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const [x, y] of line.points) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    const x0 = Math.max(Math.floor(left - line.size), 0);
    const y0 = Math.max(Math.floor(top - line.size), 0);
    const x1 = Math.min(Math.ceil(right + line.size), w);
    const y1 = Math.min(Math.ceil(bottom + line.size), h);
    if (x1 <= x0 || y1 <= y0) return;

    blurredLineCtx.strokeStyle = 'white';
    helpers.traceSmoothPath(blurredLineCtx, line);

    blurredLineCtx.globalCompositeOperation = 'source-in';
    blurredLineCtx.drawImage(blurredImageCanvas, 0, 0);

    ctx.drawImage(blurredLineCanvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    blurredLineCtx.globalCompositeOperation = 'source-over';
  }
};

const eraserBrush: BrushRenderer = {
  render(ctx, line, helpers) {
    ctx.strokeStyle = 'white';
    ctx.globalCompositeOperation = 'destination-out';
    helpers.traceSmoothPath(ctx, line);
    ctx.globalCompositeOperation = 'source-over';
  }
};

/** Registry mapping brush type names to their renderer implementation. */
const BRUSH_REGISTRY: Record<string, BrushRenderer> = {
  pen: penBrush,
  arrow: arrowBrush,
  brush: softBrush,
  neon: neonBrush,
  blur: blurBrush,
  eraser: eraserBrush,
};

// ─── Factory ───────────────────────────────────────────────────────

export interface CreateBrushPainterOptions {
  targetCanvas: HTMLCanvasElement;
  imageCanvas: HTMLCanvasElement | (() => HTMLCanvasElement);
  blurRadius?: number;
}

const DEFAULT_BLUR_RADIUS = 10;

/**
 * Create a brush painter bound to a target canvas.
 * Manages layered rendering: cache → preview → commit cycle.
 */
export function createBrushPainter(opts: CreateBrushPainterOptions): BrushPainterAPI {
  const { targetCanvas, imageCanvas, blurRadius = DEFAULT_BLUR_RADIUS } = opts;
  const width = targetCanvas.width;
  const height = targetCanvas.height;

  const targetCtx = targetCanvas.getContext('2d', { willReadFrequently: true })!;

  const makeCanvas = () => Object.assign(document.createElement('canvas'), { width, height });
  const cacheCanvas = makeCanvas();
  const cacheCtx = cacheCanvas.getContext('2d')!;
  let helpers: PaintHelpers | undefined;
  let blurDirty = true;
  let disposed = false;
  let animation: { handle: TweenHandle; resolve: () => void } | undefined;

  function getHelpers(needsBlur: boolean): PaintHelpers {
    if (needsBlur && !helpers) {
      const blurredImageCanvas = makeCanvas();
      const blurredLineCanvas = makeCanvas();
      helpers = {
        traceSmoothPath, blurredImageCanvas, blurredLineCanvas,
        blurredLineCtx: blurredLineCanvas.getContext('2d')!,
      };
    }
    // Non-blur brushes only use the path helper; no full-sized blur buffers.
    return helpers ?? { traceSmoothPath } as PaintHelpers;
  }

  function refreshBlurSource() {
    if (!blurDirty) return;
    const { blurredImageCanvas } = getHelpers(true);
    const ctx = blurredImageCanvas.getContext('2d')!;
    const source = typeof imageCanvas === 'function' ? imageCanvas() : imageCanvas;
    // Blur the composited source, rather than blurring each translucent layer separately.
    ctx.filter = 'none';
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    ctx.drawImage(cacheCanvas, 0, 0);
    ctx.filter = `blur(${blurRadius}px)`;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(blurredImageCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    blurDirty = false;
  }

  function render(ctx: CanvasRenderingContext2D, line: BrushDrawnLine, finish: boolean) {
    const renderer = BRUSH_REGISTRY[line.brush];
    if (!renderer || !line.points.length) return;
    if (line.brush === 'blur') refreshBlurSource();
    ctx.save();
    renderer.render(ctx, line, getHelpers(line.brush === 'blur'), finish);
    ctx.restore();
  }

  function stopAnimation() {
    if (!animation) return;
    animation.handle.cancel();
    animation.resolve();
    animation = undefined;
  }

  function preview(line: BrushDrawnLine, finish = false) {
    if (disposed) return;
    stopAnimation();
    discard();
    render(targetCtx, line, finish);
  }

  function commit() {
    if (disposed) return;
    cacheCtx.clearRect(0, 0, width, height);
    cacheCtx.drawImage(targetCanvas, 0, 0);
    blurDirty = true;
  }

  function commitLine(line: BrushDrawnLine) {
    preview(line, true);
    commit();
  }

  function redrawAll(lines: BrushDrawnLine[]) {
    if (disposed) return;
    clear();
    // Replay directly into the committed plane. Only blur strokes need a source
    // snapshot; a normal history replay never copies the base GPU image.
    for (const line of lines) {
      render(cacheCtx, line, true);
      blurDirty = true;
    }
    discard();
  }

  function discard() {
    if (disposed) return;
    targetCtx.clearRect(0, 0, width, height);
    targetCtx.drawImage(cacheCanvas, 0, 0);
  }

  function clear() {
    if (disposed) return;
    stopAnimation();
    targetCtx.clearRect(0, 0, width, height);
    cacheCtx.clearRect(0, 0, width, height);
    blurDirty = true;
  }

  function invalidateSource() { blurDirty = true; }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopAnimation();
    cacheCanvas.width = cacheCanvas.height = 0;
    if (helpers) {
      helpers.blurredImageCanvas.width = helpers.blurredImageCanvas.height = 0;
      helpers.blurredLineCanvas.width = helpers.blurredLineCanvas.height = 0;
      helpers = undefined;
    }
  }

  function animateArrow(line: BrushDrawnLine): Promise<void> {
    if (disposed || line.points.length < 2) return Promise.resolve();
    stopAnimation();
    const maxLen = computeArrowLength(line.size);
    return new Promise<void>(resolve => {
      const handle = tween({
        from: 0.1, to: maxLen, duration: 120, easing: t => t,
        onUpdate: (len: number) => {
          if (disposed) return;
          discard();
          render(targetCtx, { ...line, brush: 'pen' }, false);
          renderArrowHead(targetCtx, line, len);
        },
        onComplete: () => { animation = undefined; resolve(); },
      });
      animation = { handle, resolve };
    });
  }

  return { preview, commit, commitLine, redrawAll, discard, clear, animateArrow, invalidateSource, dispose };
}
