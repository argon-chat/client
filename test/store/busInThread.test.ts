/**
 * busStore under vue-native: no `new RealtimeWorker()` (a stub there that throws), the realtime core
 * on this thread instead, and the same protocol both ways. What the core does with it is pinned by
 * test/workers/realtimeInThread.test.ts; this is the wiring.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const h = vi.hoisted(() => ({
  cores: [] as { got: any[]; post: (m: unknown) => void; disposed: boolean }[],
}));

vi.mock("@/lib/vn", () => ({ isVn: true }));
vi.mock("@/workers/realtimeWorker?worker", () => ({
  default: class {
    constructor() {
      throw new Error("NotSupportedError: Workers are not available");
    }
  },
}));
vi.mock("@/workers/realtimeCore", () => ({
  createRealtimeCore(post: (m: unknown) => void) {
    const core = { got: [] as any[], post, disposed: false };
    h.cores.push(core);
    return {
      handle: (m: unknown) => core.got.push(m),
      dispose: () => {
        core.disposed = true;
      },
    };
  },
}));
vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: { count() {}, distribution() {}, gauge() {} },
  errorKind: () => "x",
}));
vi.mock("@/lib/net/sessionRecovery", () => ({ handleSessionRejected: async () => "renewed", forceSignOut() {} }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    apiEndpoint: "https://api.test",
    ionSessionId: "sid-1",
    webTransportEndpoint: null,
    exchangeStreamTicket: async () => Uint8Array.of(0x81, 0x42, 0x01, 0x02),
  }),
}));
vi.mock("@/store/data/channelStore", () => ({ useChannelStore: () => ({ selectedTextChannel: null }) }));

import { useBus } from "@/store/realtime/busStore";

/** Lets the fake ports (one `setTimeout(0)` per message) and the async handlers run. */
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  h.cores.length = 0;
  setActivePinia(createPinia());
});

describe("busStore under vue-native", () => {
  test("connects through the in-thread core, and hears it back", async () => {
    const bus = useBus();
    await bus.doListenMyEvents();
    await settle();

    expect(h.cores).toHaveLength(1);
    const [core] = h.cores;
    expect(core.got).toEqual([{ type: "connect", endpoint: "https://api.test", sessionId: "sid-1", webTransport: null }]);

    core.post({ type: "state", state: "reconnecting" });
    await settle();
    expect(bus.isReconnecting).toBe(true);

    // The ticket exchange runs here and its answer goes back to the core.
    core.post({ type: "ticketRequest", requestId: "1" });
    await settle();
    const answer = core.got.find((m) => m.type === "ticketResponse");
    expect(answer.requestId).toBe("1");
    expect([...new Uint8Array(answer.payload)]).toEqual([0x81, 0x42, 0x01, 0x02]);
  });

  test("closeAllSubscribes stops the core, and a new connection gets a fresh one", async () => {
    const bus = useBus();
    await bus.doListenMyEvents();
    await settle();
    const [first] = h.cores;

    bus.closeAllSubscribes("account switch");
    expect(first.disposed).toBe(true);
    // Terminated: the goodbye posted on the way out is not delivered, as with a worker.
    await settle();
    expect(first.got.map((m) => m.type)).toEqual(["connect"]);

    await bus.doListenMyEvents();
    await settle();
    expect(h.cores).toHaveLength(2);
    expect(h.cores[1].got.map((m) => m.type)).toEqual(["connect"]);
  });
});
