/**
 * The realtime core on the main thread, as vue-native runs it until it has Workers: behind an object
 * shaped like the Worker, over a pair of fake ports, and driven exactly as busStore drives the real
 * worker. The network underneath is the same scripted Ion server the worker's own tests use.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { ForSelf, Heartbeat, UserStatus, Welcome } from "@argon/glue";
import { FakeSocket, payload, sockets, ticketResponseBytes } from "./realtimeHarness";
import { inThreadWorker, portPair, type StartWorkerBody } from "@/lib/vn/inThreadWorker";
import { createRealtimeCore } from "@/workers/realtimeCore";

/**
 * Lets every hop run: each message is a `setTimeout(0)`, and the fake clock moves a `setTimeout(0)`
 * made while it runs timers to the next millisecond (sinon's guard against a zero-delay loop).
 */
async function settle() {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1);
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets.length = 0;
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the port pair", () => {
  test("a message arrives later, never inside postMessage, and messages keep their order", async () => {
    const [a, b] = portPair();
    const got: unknown[] = [];
    b.onmessage = (e) => got.push(e.data);
    b.start();

    a.postMessage(1);
    a.postMessage({ two: 2 });
    expect(got).toEqual([]);

    await settle();
    expect(got).toEqual([1, { two: 2 }]);
  });

  test("both ways", async () => {
    const [a, b] = portPair();
    const atA: unknown[] = [];
    const atB: unknown[] = [];
    a.onmessage = (e) => atA.push(e.data);
    b.onmessage = (e) => {
      atB.push(e.data);
      b.postMessage(`re: ${e.data}`);
    };
    a.start();
    b.start();

    a.postMessage("ping");
    await settle();
    expect(atB).toEqual(["ping"]);
    expect(atA).toEqual(["re: ping"]);
  });

  test("an end that has not started holds what it is sent", async () => {
    const [a, b] = portPair();
    const got: unknown[] = [];
    b.onmessage = (e) => got.push(e.data);

    a.postMessage("early");
    await settle();
    expect(got).toEqual([]);

    b.start();
    await settle();
    expect(got).toEqual(["early"]);
  });

  test("after close nothing is delivered, not even what was already on its way", async () => {
    const [a, b] = portPair();
    const got: unknown[] = [];
    b.onmessage = (e) => got.push(e.data);
    b.start();

    a.postMessage("in flight");
    b.close();
    a.postMessage("after");
    await settle();
    expect(got).toEqual([]);
  });
});

/** The main thread's side, as busStore is: answers tickets and heartbeats, records the rest. */
function mainThread(load: () => Promise<StartWorkerBody> = async () => createRealtimeCore) {
  const worker = inThreadWorker(load);
  const received: any[] = [];
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    received.push(msg);
    if (msg.type === "ticketRequest") {
      const buffer = ticketResponseBytes().buffer;
      worker.postMessage({ type: "ticketResponse", requestId: msg.requestId, payload: buffer }, [buffer]);
    } else if (msg.type === "heartbeatRequest") {
      worker.postMessage({ type: "heartbeatInvoke", status: UserStatus.DoNotDisturb });
    }
  };
  const of = (type: string) => received.filter((m) => m.type === type);
  return { worker, received, of };
}

describe("the realtime core in-thread", () => {
  test("messages flow both ways: connect, the ticket, the stream, the status, an event", async () => {
    const { worker, of } = mainThread();

    worker.postMessage({ type: "connect", endpoint: "https://api.test", sessionId: "sid-1" });
    await settle();

    // Main → core: the connect. Core → main: the ticket request. Main → core: the answer.
    expect(of("ticketRequest")).toHaveLength(1);
    expect(sockets).toHaveLength(1);
    const ws = sockets[0];
    expect(ws.url).toMatch(/^wss:\/\/api\.test\/ion\/IEventBus\/Realtime\.ws\?/);
    expect(new URL(ws.url).searchParams.get("sid")).toBe("sid-1");

    ws.accept().ready().push(new Welcome("conn-1"));
    await settle();
    expect(of("state").map((m) => m.state)).toEqual(["connecting", "connected"]);

    // The heartbeat goes out with the status the main thread answered.
    const heartbeats = ws.commands().filter((c): c is Heartbeat => c.isHeartbeat());
    expect(heartbeats.map((c) => c.status)).toEqual([UserStatus.DoNotDisturb]);

    // An event reaches the main thread as the bytes it arrived in.
    ws.push(new ForSelf(payload(7, 8, 9), "100-0"));
    await settle();
    const [event] = of("event");
    expect(event.channel).toBe("forSelf");
    expect([...new Uint8Array(event.data)]).toEqual([7, 8, 9]);

    worker.terminate();
  });

  test("reconnects on its own after a drop, as in the worker", async () => {
    const { worker, of } = mainThread();
    worker.postMessage({ type: "connect", endpoint: "https://api.test" });
    await settle();
    sockets[0].accept().ready().push(new Welcome("conn-1"));
    await settle();

    sockets[0].drop();
    await settle();
    expect(of("state").at(-1)).toEqual({ type: "state", state: "reconnecting" });

    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(sockets).toHaveLength(2);
    expect(of("ticketRequest")).toHaveLength(2);

    worker.terminate();
  });

  test("what is posted before the core has loaded waits for it", async () => {
    let loaded!: (start: StartWorkerBody) => void;
    const { worker, of } = mainThread(() => new Promise((resolve) => (loaded = resolve)));

    worker.postMessage({ type: "connect", endpoint: "https://api.test" });
    await settle();
    expect(sockets).toHaveLength(0);

    loaded(createRealtimeCore);
    await settle();
    expect(of("ticketRequest")).toHaveLength(1);
    expect(sockets).toHaveLength(1);

    worker.terminate();
  });

  test("terminate ends the stream: the socket closes, nothing more arrives, nothing re-dials", async () => {
    const { worker, received } = mainThread();
    worker.postMessage({ type: "connect", endpoint: "https://api.test" });
    await settle();
    const ws = sockets[0];
    ws.accept().ready().push(new Welcome("conn-1"));
    await settle();

    worker.terminate();
    await settle();
    expect(ws.readyState).toBe(3);

    const before = received.length;
    worker.postMessage({ type: "wake" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(received).toHaveLength(before);
    expect(sockets).toHaveLength(1);
  });

  test("an error the body throws reaches onerror, as a worker's uncaught error does", async () => {
    const boom = new Error("boom");
    const worker = inThreadWorker(async () => () => ({
      handle() {
        throw boom;
      },
      dispose() {},
    }));
    const errors: ErrorEvent[] = [];
    worker.onerror = (e) => errors.push(e);

    worker.postMessage({ type: "anything" });
    await settle();
    expect(errors.map((e) => [e.message, e.error])).toEqual([["boom", boom]]);
  });
});
