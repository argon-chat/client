import type { Vec2 } from '../types';
import type { Bounds } from './coverage';
import { computeCostMap, findPath, snapToEdge, type CostMap } from './livewire';
import type { LiveWireEvent, LiveWireRequest } from './liveWireProtocol';
import type { RgbaImage } from './magicEraser';

export type LiveWirePathOptions = {
  /** Snap the target to an edge within this radius. */
  snap?: number;
  maxWindow?: number;
  pad?: number;
  window?: Bounds;
  blocked?: Int32Array;
};

export type LiveWirePathResult = {
  /** x, y pairs, working pixels. */
  points: Int32Array;
  end: Vec2;
  clamped: boolean;
  straight: boolean;
  /** Time the search took. */
  ms: number;
};

/** Where the magnetic lasso's paths come from: a worker in the app, the same thread in tests. */
export interface LiveWireBackend {
  /** Builds the edge map for an image (the pixels may be taken over). */
  prepare(image: RgbaImage): Promise<void>;
  path(from: Vec2, to: Vec2, options?: LiveWirePathOptions): Promise<LiveWirePathResult>;
  snap(point: Vec2, radius: number): Promise<Vec2>;
  dispose(): void;
}

function defaultWorker(): Worker {
  return new Worker(new URL('../workers/livewire.worker.ts', import.meta.url), { type: 'module', name: 'live-wire' });
}

type Pending = { resolve(event: LiveWireEvent): void; reject(error: unknown): void };

export function createLiveWireWorker(createWorker: () => Worker = defaultWorker): LiveWireBackend {
  let worker: Worker | null = null;
  let failed: Error | null = null;
  let seq = 0;
  const pending = new Map<number, Pending>();
  let ready: Promise<void> | null = null;

  function fail(error: Error) {
    failed = error;
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  }

  function ensure(): Worker {
    if (failed) throw failed;
    if (worker) return worker;
    const w = createWorker();
    w.onmessage = (e: MessageEvent<LiveWireEvent>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.type === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
    w.onerror = (e) => {
      e.preventDefault();
      fail(new Error(e.message || 'The live-wire worker failed'));
    };
    w.onmessageerror = () => fail(new Error('The live-wire worker sent an unreadable message'));
    worker = w;
    return w;
  }

  function send<T extends LiveWireEvent['type']>(request: LiveWireRequest, transfer: Transferable[] = []): Promise<Extract<LiveWireEvent, { type: T }>> {
    return new Promise((resolve, reject) => {
      try {
        const w = ensure();
        pending.set(request.id, { resolve: resolve as (e: LiveWireEvent) => void, reject });
        w.postMessage(request, transfer);
      } catch (e) {
        pending.delete(request.id);
        reject(e);
      }
    });
  }

  return {
    prepare(image) {
      const rgba = image.data instanceof Uint8ClampedArray ? image.data : new Uint8ClampedArray(image.data);
      ready = send<'ready'>({ type: 'init', id: ++seq, width: image.width, height: image.height, rgba }, [rgba.buffer]).then(() => undefined);
      return ready;
    },
    async path(from, to, options = {}) {
      if (!ready) throw new Error('The edge map was not prepared');
      await ready;
      const blocked = options.blocked;
      const event = await send<'path'>(
        {
          type: 'path',
          id: ++seq,
          from,
          to,
          snap: options.snap ?? 0,
          maxWindow: options.maxWindow,
          pad: options.pad,
          window: options.window,
          blocked
        },
        blocked ? [blocked.buffer] : []
      );
      return { points: event.points, end: event.end, clamped: event.clamped, straight: event.straight, ms: event.ms };
    },
    async snap(point, radius) {
      if (!ready) throw new Error('The edge map was not prepared');
      await ready;
      return (await send<'snap'>({ type: 'snap', id: ++seq, point, radius })).point;
    },
    dispose() {
      fail(new Error('The live-wire worker was stopped'));
    }
  };
}

/** The same search on the calling thread. */
export function createLocalLiveWire(): LiveWireBackend {
  let map: CostMap | null = null;
  const need = () => {
    if (!map) throw new Error('The edge map was not prepared');
    return map;
  };
  return {
    async prepare(image) {
      map = computeCostMap(image.data, image.width, image.height);
    },
    async path(from, to, options = {}) {
      const m = need();
      const started = performance.now();
      const target = options.snap ? snapToEdge(m, to, options.snap) : to;
      const r = findPath(m, from, target, options);
      return { points: r.points, end: r.end, clamped: r.clamped, straight: r.straight, ms: performance.now() - started };
    },
    async snap(point, radius) {
      return snapToEdge(need(), point, radius);
    },
    dispose() {
      map = null;
    }
  };
}
