/**
 * Realtime Worker — the realtime core (realtimeCore.ts, which also documents the protocol) on the
 * worker's own `self`, off the main thread.
 *
 * The core is a module of its own so that a runtime without Workers can run the same code on the
 * main thread behind the same messages (vue-native today: src/lib/vn/inThreadWorker.ts).
 */

import { createRealtimeCore } from "./realtimeCore";

const core = createRealtimeCore((message, transfer) =>
  transfer ? self.postMessage(message, { transfer }) : self.postMessage(message),
);

// --- Message handler ---
self.onmessage = (e: MessageEvent) => core.handle(e.data);
