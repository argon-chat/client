import type { Vec2 } from '../types';
import { pointDistance } from '../geometry';
import { hexToRgbaTuple } from '../color';
import { tween } from '../animation';

// ─── Types ─────────────────────────────────────────────────────────

export type BrushDrawnLine = {
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
  clear(): void;
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

    const xs = line.points.map(p => p[0]);
    const ys = line.points.map(p => p[1]);
    const pad = line.size;
    const x0 = Math.max(Math.min(...xs) - pad, 0);
    const x1 = Math.max(...xs) + pad;
    const y0 = Math.max(Math.min(...ys) - pad, 0);
    const y1 = Math.max(...ys) + pad;

    blurredLineCtx.strokeStyle = 'white';
    helpers.traceSmoothPath(blurredLineCtx, line);

    blurredLineCtx.globalCompositeOperation = 'source-in';
    blurredLineCtx.drawImage(blurredImageCanvas, 0, 0);

    ctx.drawImage(blurredLineCanvas, x0, y0, x1, y1, x0, y0, x1, y1);
    blurredLineCtx.globalCompositeOperation = 'source-over';
  }
};

const eraserBrush: BrushRenderer = {
  render(ctx, line, helpers) {
    ctx.strokeStyle = 'white';
    ctx.globalCompositeOperation = 'destination-out';
    helpers.traceSmoothPath(ctx, line);
    ctx.stroke();
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
  imageCanvas: HTMLCanvasElement;
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

  // Internal offscreen canvases
  const cacheCanvas = Object.assign(document.createElement('canvas'), { width, height });
  const blurredImageCanvas = Object.assign(document.createElement('canvas'), { width, height });
  const blurredLineCanvas = Object.assign(document.createElement('canvas'), { width, height });

  const cacheCtx = cacheCanvas.getContext('2d', { willReadFrequently: true })!;
  const blurredImageCtx = blurredImageCanvas.getContext('2d', { willReadFrequently: true })!;
  const blurredLineCtx = blurredLineCanvas.getContext('2d', { willReadFrequently: true })!;

  const helpers: PaintHelpers = {
    traceSmoothPath,
    blurredImageCanvas,
    blurredLineCtx,
    blurredLineCanvas,
  };

  function refreshBlurSource() {
    blurredImageCtx.clearRect(0, 0, width, height);
    blurredImageCtx.filter = `blur(${blurRadius}px)`;
    blurredImageCtx.drawImage(imageCanvas, 0, 0, width, height);
    blurredImageCtx.drawImage(cacheCanvas, 0, 0);
  }

  function preview(line: BrushDrawnLine, finish = false) {
    const renderer = BRUSH_REGISTRY[line.brush];
    if (!renderer) return;

    targetCtx.clearRect(0, 0, width, height);
    targetCtx.drawImage(cacheCanvas, 0, 0);
    targetCtx.save();
    renderer.render(targetCtx, line, helpers, finish);
    targetCtx.restore();
  }

  function commit() {
    cacheCtx.clearRect(0, 0, width, height);
    cacheCtx.drawImage(targetCanvas, 0, 0);
    refreshBlurSource();
  }

  function commitLine(line: BrushDrawnLine) {
    preview(line, true);
    commit();
  }

  function redrawAll(lines: BrushDrawnLine[]) {
    clear();
    for (const line of lines) commitLine(line);
  }

  function clear() {
    targetCtx.clearRect(0, 0, width, height);
    cacheCtx.clearRect(0, 0, width, height);
  }

  function animateArrow(line: BrushDrawnLine): Promise<void> {
    if (line.points.length < 2) return Promise.resolve();
    const maxLen = computeArrowLength(line.size);
    return new Promise<void>(resolve => {
      tween({
        from: 0.1,
        to: maxLen,
        duration: 120,
        easing: t => t, // linear for short animations
        onUpdate: (len: number) => renderArrowHead(targetCtx, line, len),
        onComplete: resolve,
      });
    });
  }

  return { preview, commit, commitLine, redrawAll, clear, animateArrow };
}
