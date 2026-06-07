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
    const lineW = Math.max(1, s.width * w);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (s.tool === "arrow") {
      this.drawArrow(s.points, lineW, w, h);
    } else {
      this.drawBrush(s.points, w, h);
    }
    ctx.restore();
  }

  private drawBrush(points: NormPoint[], w: number, h: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0][0] * w, points[0][1] * h);
    if (points.length === 1) {
      // A dot — draw a small filled circle so single taps are visible.
      ctx.arc(points[0][0] * w, points[0][1] * h, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0] * w, points[i][1] * h);
    }
    ctx.stroke();
  }

  private drawArrow(points: NormPoint[], lineW: number, w: number, h: number): void {
    const ctx = this.ctx;
    const a = points[0];
    const b = points[points.length - 1];
    const x0 = a[0] * w, y0 = a[1] * h;
    const x1 = b[0] * w, y1 = b[1] * h;

    // Shaft.
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    // Head — scales with stroke width, clamped to the shaft length.
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const head = Math.min(len, Math.max(lineW * 4, 14));
    const ang = Math.atan2(dy, dx);
    const spread = Math.PI / 7;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(ang - spread), y1 - head * Math.sin(ang - spread));
    ctx.lineTo(x1 - head * Math.cos(ang + spread), y1 - head * Math.sin(ang + spread));
    ctx.closePath();
    ctx.fill();
  }
}
