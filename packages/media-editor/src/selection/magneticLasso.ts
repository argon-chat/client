import type { Vec2 } from '../types';
import type { LiveWireBackend, LiveWirePathOptions } from './liveWireClient';
import { pathLength, pointsWithin } from './livewire';

/** Room around the whole outline when closing it, so the way back can go round. */
const CLOSE_PAD = 32;
/** Search windows for a path without a corridor. */
const CLICK_WINDOW = 640;

/** Room around a segment's box: half its length, so an edge that bows out of it is still found. */
const padFor = (from: Vec2, to: Vec2, max: number) => Math.round(Math.min(max, Math.max(24, Math.hypot(to[0] - from[0], to[1] - from[1]) / 2)));

/**
 * Photoshop's Frequency (0–100) as the path length between automatic fastening points, in screen
 * pixels: 0 places none, 100 one every 12 px, the default 57 about every 50.
 */
export function fasteningSpacing(frequency: number): number {
  const f = Math.min(100, Math.max(0, frequency));
  if (f <= 0) return Infinity;
  return 12 * Math.pow(300 / 12, (100 - f) / 99);
}

export type MagneticLassoState = {
  /** Fastening points, working pixels. */
  anchors: Vec2[];
  /** `segments[i]` joins `anchors[i]` to `anchors[i + 1]`, x, y pairs, both ends included. */
  segments: Int32Array[];
  /** From the last anchor toward the pointer. */
  live: Int32Array | null;
  /** The pointer's way since the last anchor (x, y pairs, starting there): the Width is round it. */
  trail: number[];
};

export type MagneticLassoOptions = {
  /** Width: how far from the pointer an edge is looked for and the path may go, working pixels. */
  width: () => number;
  /** Edge Contrast: the step, in levels, an edge needs to attract the path. */
  contrast: () => number;
  /** Path length between automatic fastening points, working pixels (Infinity: clicks only). */
  spacing: () => number;
  onChange: () => void;
  onPathTime?: (ms: number) => void;
};

/** `straight`: Photoshop's Alt, a polygonal segment instead of a magnetic one. */
export type SegmentOptions = { straight?: boolean };

export interface MagneticLasso {
  readonly state: MagneticLassoState;
  /** Sets the first fastening point, or freezes the path to `point` as the next one. */
  click(point: Vec2, options?: SegmentOptions): Promise<void>;
  /** The live path follows the pointer (replies that arrive late are dropped). */
  move(point: Vec2, options?: SegmentOptions): void;
  /** Drops the last fastening point and its segment. */
  removeLast(): void;
  /** Back to the first point along the edges (or straight); the outline in working pixels, or null. */
  close(options?: SegmentOptions): Promise<Vec2[] | null>;
  cancel(): void;
  /** Resolves once queued clicks and the in-flight move are done (tests). */
  idle(): Promise<void>;
}

const straightLine = (a: Vec2, b: Vec2): Int32Array => {
  const fx = Math.round(a[0]);
  const fy = Math.round(a[1]);
  const tx = Math.round(b[0]);
  const ty = Math.round(b[1]);
  const steps = Math.max(Math.abs(tx - fx), Math.abs(ty - fy));
  const out = new Int32Array((steps + 1) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = steps ? i / steps : 0;
    out[i * 2] = Math.round(fx + (tx - fx) * t);
    out[i * 2 + 1] = Math.round(fy + (ty - fy) * t);
  }
  return out;
};

/**
 * The magnetic lasso's fastening points and paths. The live path is the cheapest one from the last
 * point to the strongest edge within the Width of the pointer, searched only within the Width of
 * the way the pointer went. Without a backend (the worker failed) every segment is straight.
 */
export function createMagneticLasso(backend: LiveWireBackend | null, options: MagneticLassoOptions): MagneticLasso {
  const state: MagneticLassoState = { anchors: [], segments: [], live: null, trail: [] };
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();
  let target: Vec2 | null = null;
  let moving: Promise<void> | null = null;

  const last = () => state.anchors[state.anchors.length - 1];

  type Path = { points: Int32Array; end: Vec2; clamped: boolean };

  function corridorTo(to: Vec2) {
    return { points: [...state.trail, Math.round(to[0]), Math.round(to[1])], radius: Math.max(1, options.width()) };
  }

  async function pathTo(from: Vec2, to: Vec2, extra: LiveWirePathOptions = {}): Promise<Path> {
    if (!backend) return { points: straightLine(from, to), end: [Math.round(to[0]), Math.round(to[1])], clamped: false };
    const r = await backend.path(from, to, { snap: options.width(), contrast: options.contrast(), ...extra });
    options.onPathTime?.(r.ms);
    return r;
  }

  function freeze(points: Int32Array) {
    const n = points.length >> 1;
    if (n === 0) return;
    state.segments.push(points);
    const end: Vec2 = [points[(n - 1) * 2], points[(n - 1) * 2 + 1]];
    state.anchors.push(end);
    state.trail = [end[0], end[1]];
  }

  /** Freezes the live path in pieces of the spacing while it is longer than that and a tail. */
  function autoAnchor(): boolean {
    const spacing = options.spacing();
    if (!Number.isFinite(spacing) || spacing <= 0) return false;
    const tail = Math.max(2, spacing * 0.3);
    let anchored = false;
    for (;;) {
      const live = state.live;
      if (!live || pathLength(live) < spacing + tail) return anchored;
      const n = pointsWithin(live, spacing);
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
        while (target && state.anchors.length) {
          const to = target;
          target = null;
          const gen = generation;
          const from = last();
          const r = await pathTo(from, to, { corridor: corridorTo(to) }).catch(() => null);
          if (gen !== generation || !r) continue;
          state.live = r.points;
          autoAnchor();
          options.onChange();
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

  function track(point: Vec2) {
    const t = state.trail;
    if (!t.length) return;
    const step = Math.max(1, options.width() / 4);
    const lx = t[t.length - 2];
    const ly = t[t.length - 1];
    if (Math.hypot(point[0] - lx, point[1] - ly) >= step) t.push(Math.round(point[0]), Math.round(point[1]));
  }

  return {
    state,
    click(point, segment = {}) {
      generation++;
      return enqueue(async () => {
        if (moving) await moving;
        if (!state.anchors.length) {
          const p = backend && !segment.straight
            ? await backend.snap(point, options.width(), options.contrast()).catch(() => point)
            : point;
          const anchor: Vec2 = [Math.round(p[0]), Math.round(p[1])];
          state.anchors.push(anchor);
          state.trail = [anchor[0], anchor[1]];
        } else if (segment.straight) {
          freeze(straightLine(last(), point));
        } else {
          const from = last();
          let r = await pathTo(from, point, { corridor: corridorTo(point) });
          let points = r.points;
          // Only a search without a corridor can fall short; the rest is fetched in steps.
          for (let i = 0; i < 8 && r.clamped; i++) {
            const before = r.end;
            r = await pathTo(before, point, { maxWindow: CLICK_WINDOW, pad: padFor(before, point, CLICK_WINDOW / 4) });
            points = concat(points, r.points);
            if (r.end[0] === before[0] && r.end[1] === before[1]) break;
          }
          freeze(points);
        }
        state.live = null;
        options.onChange();
        // Moves that came in while the click was on its way: follow the latest one.
        if (target) void pump();
      });
    },
    move(point, segment = {}) {
      track(point);
      if (segment.straight || !backend) {
        generation++;
        target = null;
        if (state.anchors.length) {
          state.live = straightLine(last(), point);
          options.onChange();
        }
        return;
      }
      target = [point[0], point[1]];
      void queue.then(() => pump());
    },
    removeLast() {
      generation++;
      state.live = null;
      if (state.segments.length) {
        state.segments.pop();
        state.anchors.pop();
        const a = last();
        state.trail = [a[0], a[1]];
      } else {
        state.anchors = [];
        state.trail = [];
      }
      options.onChange();
    },
    close(segment = {}) {
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
        const back = backend && !segment.straight
          ? await backend
              .path(last(), first, {
                contrast: options.contrast(),
                window: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad + 1, y1: y1 + pad + 1 },
                blocked: outline.slice()
              })
              .catch(() => null)
          : null;
        const closing = back?.points ?? straightLine(last(), first);
        const all = concat(outline, closing);
        const points: Vec2[] = [];
        // The closing path ends where the outline starts.
        for (let i = 0; i + 1 < all.length - 2; i += 2) points.push([all[i], all[i + 1]]);
        result = points.length >= 3 ? points : null;
        state.anchors = [];
        state.segments = [];
        state.live = null;
        state.trail = [];
        options.onChange();
      }).then(() => result);
    },
    cancel() {
      generation++;
      target = null;
      state.anchors = [];
      state.segments = [];
      state.live = null;
      state.trail = [];
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
