/**
 * Client-side netcode smoothing for Pong.
 *
 * The host streams authoritative snapshots at ~30 Hz; clients render at 60 fps.
 * Two smoothers kill the resulting jitter:
 *
 *  - Paddles (scalars that change direction sharply) → snapshot interpolation:
 *    buffer a little history and render ~100 ms in the past, lerping between the
 *    two snapshots that bracket the render time.
 *
 *  - Balls (many, fast, mostly straight) → dead-reckoning: each snapshot carries
 *    per-ball velocity, so between snapshots we advance each ball by its
 *    velocity and ease the rendered position toward that extrapolation. Handles
 *    a variable ball count (multiball) and late packets without stalling.
 */

import type { NetBall } from "./net";

const PADDLE_DELAY_MS = 100;
const PADDLE_HISTORY_MS = 600;
/** Cap forward ball extrapolation so a dropped packet can't fling a ball away. */
const BALL_MAX_AHEAD_MS = 150;
/** Rendered-position correction rate (higher = snappier, lower = smoother). */
const BALL_CORRECT_RATE = 18;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Paddle interpolation
// ---------------------------------------------------------------------------

interface PaddleSnap {
  t: number;
  p1: number;
  p2: number;
}

export interface PaddleBuffer {
  push(p1: number, p2: number): void;
  /** Interpolated { p1, p2 } at `now - delay`, or null if empty. */
  sample(now: number): { p1: number; p2: number } | null;
  clear(): void;
}

export function createPaddleBuffer(): PaddleBuffer {
  const buf: PaddleSnap[] = [];

  return {
    push(p1, p2): void {
      const t = performance.now();
      if (buf.length && t <= buf[buf.length - 1].t) return; // ignore out-of-order
      buf.push({ t, p1, p2 });
      const cutoff = t - PADDLE_HISTORY_MS;
      while (buf.length > 2 && buf[0].t < cutoff) buf.shift();
    },

    clear(): void {
      buf.length = 0;
    },

    sample(now): { p1: number; p2: number } | null {
      if (buf.length === 0) return null;
      if (buf.length === 1) return { p1: buf[0].p1, p2: buf[0].p2 };

      const target = now - PADDLE_DELAY_MS;
      const last = buf[buf.length - 1];
      if (target >= last.t) return { p1: last.p1, p2: last.p2 };

      for (let i = buf.length - 1; i > 0; i--) {
        const a = buf[i - 1];
        const b = buf[i];
        if (target >= a.t && target <= b.t) {
          const f = (target - a.t) / (b.t - a.t || 1);
          return { p1: lerp(a.p1, b.p1, f), p2: lerp(a.p2, b.p2, f) };
        }
      }
      return { p1: buf[0].p1, p2: buf[0].p2 };
    },
  };
}

// ---------------------------------------------------------------------------
// Ball dead-reckoning
// ---------------------------------------------------------------------------

export interface RenderBall {
  id: number;
  x: number; // smoothed render fraction
  y: number;
  o: 0 | 1 | 2;
}

export interface BallField {
  /** Feed a fresh authoritative snapshot of balls. */
  update(balls: NetBall[]): void;
  /** Advance + correct rendered positions; returns what to draw. */
  step(now: number, dt: number): RenderBall[];
  clear(): void;
}

interface Tracked {
  ax: number; // authoritative pos/vel (fractions, fractions/sec)
  ay: number;
  vx: number;
  vy: number;
  o: 0 | 1 | 2;
  rx: number; // rendered pos
  ry: number;
  snapT: number; // when this auth was received
  alive: boolean; // present in the latest snapshot
}

export function createBallField(): BallField {
  const balls = new Map<number, Tracked>();

  return {
    update(snap): void {
      const now = performance.now();
      for (const b of balls.values()) b.alive = false;
      for (const nb of snap) {
        const cur = balls.get(nb.id);
        if (cur) {
          cur.ax = nb.x;
          cur.ay = nb.y;
          cur.vx = nb.vx;
          cur.vy = nb.vy;
          cur.o = nb.o;
          cur.snapT = now;
          cur.alive = true;
        } else {
          balls.set(nb.id, {
            ax: nb.x, ay: nb.y, vx: nb.vx, vy: nb.vy, o: nb.o,
            rx: nb.x, ry: nb.y, snapT: now, alive: true,
          });
        }
      }
      // Drop balls absent from the latest snapshot (scored / merged away).
      for (const [id, b] of balls) if (!b.alive) balls.delete(id);
    },

    clear(): void {
      balls.clear();
    },

    step(now, dt): RenderBall[] {
      const out: RenderBall[] = [];
      const smooth = 1 - Math.exp(-dt * BALL_CORRECT_RATE);
      for (const [id, b] of balls) {
        const ahead = Math.min(now - b.snapT, BALL_MAX_AHEAD_MS) / 1000;
        const tx = clamp01(b.ax + b.vx * ahead);
        const ty = clamp01(b.ay + b.vy * ahead);
        b.rx += (tx - b.rx) * smooth;
        b.ry += (ty - b.ry) * smooth;
        out.push({ id, x: b.rx, y: b.ry, o: b.o });
      }
      return out;
    },
  };
}
