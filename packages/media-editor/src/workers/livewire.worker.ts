/// <reference lib="webworker" />
import { computeCostMap, findPath, snapToEdge, type CostMap } from '../selection/livewire';
import type { LiveWireEvent, LiveWireRequest } from '../selection/liveWireProtocol';

// The magnetic lasso's edge map and path search, off the main thread: the map is built once per
// image, then every pointer move asks for the cheapest path from the last anchor.

declare const self: DedicatedWorkerGlobalScope;

let map: CostMap | null = null;

function post(event: LiveWireEvent, transfer: Transferable[] = []) {
  self.postMessage(event, transfer);
}

self.onmessage = (e: MessageEvent<LiveWireRequest>) => {
  const request = e.data;
  const started = performance.now();
  try {
    if (request.type === 'init') {
      map = computeCostMap(request.rgba, request.width, request.height);
      post({ type: 'ready', id: request.id, ms: performance.now() - started });
      return;
    }
    if (!map) throw new Error('The edge map is not ready');
    if (request.type === 'snap') {
      post({ type: 'snap', id: request.id, point: snapToEdge(map, request.point, request.radius, request.contrast) });
      return;
    }
    const to = request.snap > 0 ? snapToEdge(map, request.to, request.snap, request.contrast) : request.to;
    const path = findPath(map, request.from, to, {
      maxWindow: request.maxWindow,
      pad: request.pad,
      window: request.window,
      blocked: request.blocked,
      contrast: request.contrast,
      corridor: request.corridor
    });
    post(
      {
        type: 'path',
        id: request.id,
        points: path.points,
        end: path.end,
        clamped: path.clamped,
        straight: path.straight,
        ms: performance.now() - started
      },
      [path.points.buffer]
    );
  } catch (err) {
    post({ type: 'error', id: request.id, message: err instanceof Error ? err.message : String(err) });
  }
};
