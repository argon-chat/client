/**
 * Renders screencast-drawing strokes onto a 2D canvas with time-based decay.
 *
 * Shared by both the viewer overlay (DrawOverlay.vue, over the <video>) and the
 * streamer's offscreen native feed (ScreencastDrawWindow.vue) so the decay math and
 * brush/arrow appearance are identical everywhere. Coordinates are normalized [0,1]
 * over the shared surface and denormalized to the backing-store pixel size at draw
 * time, so the same strokes look proportional on any resolution / DPI.
 *
 * The render loop runs only while at least one stroke is alive, then stops — an idle
 * surface costs no GPU. Call `kick()` after ingesting to (re)start it.
 */
import {
  DEFAULT_FADE_START_MS,
  DEFAULT_TTL_MS,
  type DrawPacket,
  type LiveStroke,
  type NormPoint,
} from "./types";

export class StrokeCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes = new Map<string, LiveStroke>();
  private raf: number | null = null;
  /** Wall-clock provider (injectable for tests); defaults to performance.now via Date. */
  private now: () => number;

  constructor(canvas: HTMLCanvasElement, now: () => number = () => Date.now()) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("[StrokeCanvas] 2D context unavailable");
    this.ctx = ctx;
    this.now = now;
  }

  /** Size the backing store to the given physical pixels (e.g. cssSize * devicePixelRatio). */
  resize(widthPx: number, heightPx: number): void {
    this.canvas.width = Math.max(1, Math.floor(widthPx));
    this.canvas.height = Math.max(1, Math.floor(heightPx));
  }

  hasStrokes(): boolean {
    return this.strokes.size > 0;
  }

  clearAll(): void {
    this.strokes.clear();
    this.paintFrame();
  }

  /** Apply a wire packet to the internal stroke set. Returns true if a repaint is warranted. */
  ingest(p: DrawPacket): boolean {
    switch (p.kind) {
      case "begin": {
        this.strokes.set(p.strokeId, {
          strokeId: p.strokeId,
          from: p.from,
          tool: p.tool,
          color: p.color,
          width: p.width,
          points: [...p.p],
          createdAt: this.now(),
          ttlMs: p.ttlMs || DEFAULT_TTL_MS,
          fadeStartMs: Math.min(DEFAULT_FADE_START_MS, (p.ttlMs || DEFAULT_TTL_MS) * 0.5),
          ended: false,
        });
        return true;
      }
      case "append": {
        const s = this.strokes.get(p.strokeId);
        if (!s) return false;
        s.points.push(...p.p);
        // Appending refreshes the decay anchor so an in-progress stroke never fades.
        if (!s.ended) s.createdAt = this.now();
        return true;
      }
      case "end": {
        const s = this.strokes.get(p.strokeId);
        if (!s) return false;
        if (p.p?.length) s.points.push(...p.p);
        s.ended = true;
        s.createdAt = this.now(); // decay timer starts when the stroke is finished
        return true;
      }
      case "undo": {
        return this.strokes.delete(p.strokeId);
      }
      case "clear": {
        if (p.who) {
          for (const [id, s] of this.strokes) if (s.from === p.who) this.strokes.delete(id);
        } else {
          this.strokes.clear();
        }
        return true;
      }
      default:
        return false;
    }
  }

  /** Start the decay/redraw loop (no-op if already running). */
  kick(): void {
    if (this.raf != null) return;
    const tick = () => {
      const alive = this.paintFrame();
      if (alive) {
        this.raf = requestAnimationFrame(tick);
      } else {
        this.raf = null;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  dispose(): void {
    this.stop();
    this.strokes.clear();
  }

  /** Compute decay alpha for a finished stroke; in-progress strokes are fully opaque. */
  private alphaFor(s: LiveStroke, t: number): number {
    if (!s.ended) return 1;
    const age = t - s.createdAt;
    if (age <= s.fadeStartMs) return 1;
    if (age >= s.ttlMs) return 0;
    return 1 - (age - s.fadeStartMs) / (s.ttlMs - s.fadeStartMs);
  }

  /** Draw one frame; drops expired strokes. Returns true while any stroke remains. */
  private paintFrame(): boolean {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const t = this.now();
    const expired: string[] = [];

    for (const s of this.strokes.values()) {
      const a = this.alphaFor(s, t);
      if (a <= 0) { expired.push(s.strokeId); continue; }
      this.drawStroke(s, a, w, h);
    }
    for (const id of expired) this.strokes.delete(id);

    return this.strokes.size > 0;
  }

  private drawStroke(s: LiveStroke, alpha: number, w: number, h: number): void {
    if (s.points.length === 0) return;
    const ctx = this.ctx;
    const lineW = Math.max(1.5, s.width * w);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    // Soft drop shadow → reads cleanly over both light and dark areas of the stream.
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = Math.max(2, lineW * 0.7);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.max(1, lineW * 0.12);

    if (s.tool === "arrow") {
      this.drawArrow(s.points, lineW, w, h);
    } else {
      this.drawBrush(s.points, lineW, w, h);
    }
    ctx.restore();
  }

  /** Smooth freehand line: quadratic curves through the midpoints of consecutive samples. */
  private drawBrush(points: NormPoint[], lineW: number, w: number, h: number): void {
    const ctx = this.ctx;
    const pts = points.map((p) => ({ x: p[0] * w, y: p[1] * h }));

    if (pts.length === 1) {
      // A dot — single tap.
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, lineW / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      // Curve through midpoints using each sample as a control point (Quadratic
      // midpoint smoothing) — removes the polyline "kinks".
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      const last = pts[pts.length - 1];
      ctx.quadraticCurveTo(pts[pts.length - 2].x, pts[pts.length - 2].y, last.x, last.y);
    }
    ctx.stroke();
  }

  /** Straight arrow from the first to the last sample, with a proportioned, rounded head. */
  private drawArrow(points: NormPoint[], lineW: number, w: number, h: number): void {
    const ctx = this.ctx;
    const ax = points[0][0] * w, ay = points[0][1] * h;
    const bx = points[points.length - 1][0] * w, by = points[points.length - 1][1] * h;

    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      ctx.beginPath();
      ctx.arc(bx, by, lineW / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const ang = Math.atan2(dy, dx);
    // Head scales with line width; never more than half the arrow so short arrows stay readable.
    const head = Math.min(len * 0.5, Math.max(lineW * 3.2, 16));
    const spread = 0.42; // ~24° half-angle → a clean, not-too-wide head

    // Shaft stops at the head's base so the round cap doesn't bulge through the tip.
    const baseX = bx - Math.cos(ang) * head;
    const baseY = by - Math.sin(ang) * head;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(baseX, baseY);
    ctx.stroke();

    // Head: filled triangle, then stroked with a round join so the corners are soft.
    const c1x = bx - head * Math.cos(ang - spread), c1y = by - head * Math.sin(ang - spread);
    const c2x = bx - head * Math.cos(ang + spread), c2y = by - head * Math.sin(ang + spread);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(c1x, c1y);
    ctx.lineTo(c2x, c2y);
    ctx.closePath();
    ctx.lineWidth = Math.max(1, lineW * 0.6);
    ctx.fill();
    ctx.stroke();
  }
}
