/**
 * Snapshot interpolation for Pong netcode.
 *
 * The host streams authoritative snapshots at ~30 Hz; clients render at 60 fps.
 * Rendering the latest snapshot directly looks jittery (steps + jitter from
 * variable packet timing). Instead we buffer snapshots and render the world
 * slightly in the past (`DELAY_MS`), linearly interpolating between the two
 * snapshots that bracket the render time. When the newest snapshot is older
 * than the render time (a late/dropped packet) we extrapolate the ball forward
 * from its last known velocity so motion stays smooth instead of stalling.
 */

import type { PongState } from "./net";

/** Render this far behind real time so there are usually two snapshots to lerp. */
const DELAY_MS = 100;
/** Never extrapolate further than this past the newest snapshot. */
const MAX_EXTRAP_MS = 180;
/** Drop snapshots older than this. */
const HISTORY_MS = 1000;

interface Snapshot {
  t: number; // local receive time (performance.now)
  s: PongState;
}

export interface StateBuffer {
  push(s: PongState): void;
  /** Latest raw snapshot (for scores / immediate logic), or null. */
  latest(): PongState | null;
  /** Interpolated/extrapolated state at `now - DELAY_MS`, or null if empty. */
  sample(now: number): PongState | null;
  clear(): void;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createStateBuffer(): StateBuffer {
  const buf: Snapshot[] = [];

  return {
    push(s: PongState): void {
      const t = performance.now();
      // Guard against out-of-order arrival (lossy channel): ignore stale ones.
      if (buf.length && t <= buf[buf.length - 1].t) return;
      buf.push({ t, s });
      const cutoff = t - HISTORY_MS;
      while (buf.length > 2 && buf[0].t < cutoff) buf.shift();
    },

    latest(): PongState | null {
      return buf.length ? buf[buf.length - 1].s : null;
    },

    clear(): void {
      buf.length = 0;
    },

    sample(now: number): PongState | null {
      if (buf.length === 0) return null;
      if (buf.length === 1) return buf[0].s;

      const target = now - DELAY_MS;
      const last = buf[buf.length - 1];

      // Render time is within the buffered window → interpolate.
      if (target <= last.t) {
        for (let i = buf.length - 1; i > 0; i--) {
          const a = buf[i - 1];
          const b = buf[i];
          if (target >= a.t && target <= b.t) {
            const span = b.t - a.t || 1;
            const f = (target - a.t) / span;
            return {
              bx: lerp(a.s.bx, b.s.bx, f),
              by: lerp(a.s.by, b.s.by, f),
              p1: lerp(a.s.p1, b.s.p1, f),
              p2: lerp(a.s.p2, b.s.p2, f),
              // scores are discrete — take the newer side of the pair
              s1: b.s.s1,
              s2: b.s.s2,
            };
          }
        }
        // target older than the whole buffer → oldest snapshot
        return buf[0].s;
      }

      // Render time is ahead of the newest snapshot → extrapolate from the last
      // two using their velocity (mostly matters for the fast-moving ball).
      const prev = buf[buf.length - 2];
      const span = last.t - prev.t || 1;
      const ahead = Math.min(target - last.t, MAX_EXTRAP_MS);
      const k = ahead / span;
      return {
        bx: clamp01(last.s.bx + (last.s.bx - prev.s.bx) * k),
        by: clamp01(last.s.by + (last.s.by - prev.s.by) * k),
        p1: clamp01(last.s.p1 + (last.s.p1 - prev.s.p1) * k),
        p2: clamp01(last.s.p2 + (last.s.p2 - prev.s.p2) * k),
        s1: last.s.s1,
        s2: last.s.s2,
      };
    },
  };
}
