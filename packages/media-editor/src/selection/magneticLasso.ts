import type { Vec2 } from '../types';
import type { LiveWireBackend, LiveWirePathOptions } from './liveWireClient';
import { pathLength, pointsWithin } from './livewire';

/** Working pixels of live path accepted at a time while tracing. */
export const AUTO_ANCHOR_SPACING = 100;
/** Kept live behind the pointer when anchoring on its own. */
const AUTO_ANCHOR_TAIL = 30;
/** Room around the whole outline when closing it, so the way back can go round. */
const CLOSE_PAD = 32;
/** Search windows: small while following the pointer (a reply per move), larger for a click. */
const LIVE_WINDOW = 320;
const CLICK_WINDOW = 640;

/** Room around a segment's box: half its length, so an edge that bows out of it is still found. */
const padFor = (from: Vec2, to: Vec2, max: number) => Math.round(Math.min(max, Math.max(24, Math.hypot(to[0] - from[0], to[1] - from[1]) / 2)));

export type MagneticLassoState = {
  /** Working pixels. */
  anchors: Vec2[];
  /** `segments[i]` joins `anchors[i]` to `anchors[i + 1]`, x, y pairs, both ends included. */
  segments: Int32Array[];
  /** From the last anchor toward the pointer. */
  live: Int32Array | null;
};

export interface MagneticLasso {
  readonly state: MagneticLassoState;
  /** Sets the first anchor, or freezes the path to `point` as the next one. */
  click(point: Vec2): Promise<void>;
  /** The live path follows the pointer (replies that arrive late are dropped). */
  move(point: Vec2): void;
  /** Drops the last anchor and its segment. */
  removeLast(): void;
  /** Back to the first anchor along the edges; the outline in working pixels, or null. */
  close(): Promise<Vec2[] | null>;
  cancel(): void;
  /** Resolves once queued clicks and the in-flight move are done (tests). */
  idle(): Promise<void>;
}

const straight = (a: Vec2, b: Vec2) => Int32Array.of(Math.round(a[0]), Math.round(a[1]), Math.round(b[0]), Math.round(b[1]));

/**
 * The magnetic lasso's anchors and paths. Without a backend (the worker failed) it is a polygon
 * lasso: straight segments between clicks.
 */
export function createMagneticLasso(
  backend: LiveWireBackend | null,
  options: { snapRadius: () => number; onChange: () => void; onPathTime?: (ms: number) => void }
): MagneticLasso {
  const state: MagneticLassoState = { anchors: [], segments: [], live: null };
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();
  let target: Vec2 | null = null;
  let moving: Promise<void> | null = null;

  const last = () => state.anchors[state.anchors.length - 1];

  type Path = { points: Int32Array; end: Vec2; clamped: boolean };

  async function pathTo(from: Vec2, to: Vec2, extra: LiveWirePathOptions = {}): Promise<Path> {
    if (!backend) return { points: straight(from, to), end: [Math.round(to[0]), Math.round(to[1])], clamped: false };
    const r = await backend.path(from, to, { snap: options.snapRadius(), ...extra });
    options.onPathTime?.(r.ms);
    return r;
  }

  const clickPath = (from: Vec2, to: Vec2) => pathTo(from, to, { maxWindow: CLICK_WINDOW, pad: padFor(from, to, CLICK_WINDOW / 4) });

  /** Moves the window along when the target is farther than one search reaches. */
  async function fullPathTo(from: Vec2, to: Vec2): Promise<Path> {
    let r = await clickPath(from, to);
    let points = r.points;
    for (let i = 0; i < 8 && r.clamped; i++) {
      const before = r.end;
      r = await clickPath(before, to);
      points = concat(points, r.points);
      if (r.end[0] === before[0] && r.end[1] === before[1]) break;
    }
    return { points, end: r.end, clamped: r.clamped };
  }

  function freeze(points: Int32Array) {
    const n = points.length >> 1;
    if (n === 0) return;
    state.segments.push(points);
    state.anchors.push([points[(n - 1) * 2], points[(n - 1) * 2 + 1]]);
  }

  /** Freezes the live path in pieces of the spacing while it is longer than that and the tail. */
  function autoAnchor(): boolean {
    let anchored = false;
    for (;;) {
      const live = state.live;
      if (!live || pathLength(live) < AUTO_ANCHOR_SPACING + AUTO_ANCHOR_TAIL) return anchored;
      const n = pointsWithin(live, AUTO_ANCHOR_SPACING);
      if (n < 2) return anchored;
      freeze(live.slice(0, n * 2));
      state.live = live.slice((n - 1) * 2);
      anchored = true;
    }
  }

  function pump(): Promise<void> {
    if (moving) return moving;
    moving = (async () => {
      try {
        // A reply that fell short of the pointer (the window) is followed up from where it got to.
        for (let follow = 0; target && state.anchors.length && follow < 32; ) {
          const to = target;
          target = null;
          const gen = generation;
          const from = last();
          const r = await pathTo(from, to, { maxWindow: LIVE_WINDOW, pad: padFor(from, to, LIVE_WINDOW / 5) }).catch(() => null);
          if (gen !== generation || !r) continue;
          state.live = r.points;
          const anchored = autoAnchor();
          options.onChange();
          if (r.clamped && anchored && !target) {
            target = to;
            follow++;
          }
        }
      } finally {
        moving = null;
      }
    })();
    return moving;
  }

  /** One click or close at a time, in order; a failed one leaves the outline as it was. */
  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = queue.then(task).catch((e) => console.warn('[media-editor] magnetic lasso', e));
    queue = run;
    return run;
  }

  return {
    state,
    click(point) {
      generation++;
      return enqueue(async () => {
        if (moving) await moving;
        if (!state.anchors.length) {
          const p = backend ? await backend.snap(point, options.snapRadius()).catch(() => point) : point;
          state.anchors.push([Math.round(p[0]), Math.round(p[1])]);
        } else {
          const r = await fullPathTo(last(), point);
          freeze(r.points);
        }
        state.live = null;
        options.onChange();
        // Moves that came in while the click was on its way: follow the latest one.
        if (target) void pump();
      });
    },
    move(point) {
      target = [point[0], point[1]];
      void queue.then(() => pump());
    },
    removeLast() {
      generation++;
      state.live = null;
      if (state.segments.length) {
        state.segments.pop();
        state.anchors.pop();
      } else {
        state.anchors = [];
      }
      options.onChange();
    },
    close() {
      generation++;
      let result: Vec2[] | null = null;
      return enqueue(async () => {
        if (moving) await moving;
        if (state.anchors.length < 2) return;
        const outline = joinSegments(state.segments);
        const first = state.anchors[0];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < outline.length; i += 2) {
          x0 = Math.min(x0, outline[i]);
          y0 = Math.min(y0, outline[i + 1]);
          x1 = Math.max(x1, outline[i]);
          y1 = Math.max(y1, outline[i + 1]);
        }
        // The way back may have to go round the far side of the object: room as big as the outline.
        const pad = Math.max(CLOSE_PAD, x1 - x0, y1 - y0);
        const back = backend
          ? await backend
              .path(last(), first, {
                window: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad + 1, y1: y1 + pad + 1 },
                blocked: outline.slice()
              })
              .catch(() => null)
          : null;
        const closing = back?.points ?? straight(last(), first);
        const all = concat(outline, closing);
        const points: Vec2[] = [];
        // The closing path ends where the outline starts.
        for (let i = 0; i + 1 < all.length - 2; i += 2) points.push([all[i], all[i + 1]]);
        result = points.length >= 3 ? points : null;
        state.anchors = [];
        state.segments = [];
        state.live = null;
        options.onChange();
      }).then(() => result);
    },
    cancel() {
      generation++;
      target = null;
      state.anchors = [];
      state.segments = [];
      state.live = null;
      options.onChange();
    },
    async idle() {
      await queue;
      if (moving) await moving;
    }
  };
}

/** Joins x, y pair paths that share their end points. */
export function concat(a: Int32Array, b: Int32Array): Int32Array {
  if (!a.length) return b.slice();
  if (!b.length) return a.slice();
  const shared = a[a.length - 2] === b[0] && a[a.length - 1] === b[1] ? 2 : 0;
  const out = new Int32Array(a.length + b.length - shared);
  out.set(a);
  out.set(b.subarray(shared), a.length);
  return out;
}

function joinSegments(segments: Int32Array[]): Int32Array {
  let out: Int32Array = new Int32Array(0);
  for (const s of segments) out = concat(out, s);
  return out;
}
