/**
 * What a closed SignalR connection is allowed to do to the worker's shared state.
 *
 * `stop()` reports its close asynchronously, so an explicit retry — disconnect immediately followed
 * by connect — leaves the old connection's `onclose` in flight while its replacement is already up.
 * Everything that handler touches is shared between connections, so without a generation check it
 * stopped the new connection's heartbeat, told the app it was disconnected and scheduled a second
 * reconnect on top of a connection that was working: two sockets, and a reconnect banner over a
 * session that never dropped.
 *
 * The failure leaves no trace of its own — the duplicate connection works — which is why it is
 * pinned here rather than left to be noticed.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

type CloseHandler = (error?: Error) => void;

/** Every connection the worker has built, in order. */
const built: FakeHubConnection[] = [];

class FakeHubConnection {
  state = "Disconnected";
  connectionId = "fake-connection";
  /** Fired by the test, never by `stop()` — that delay is the thing under test. */
  closeHandlers: CloseHandler[] = [];

  on() {}
  onreconnecting() {}
  onreconnected() {}
  onclose(handler: CloseHandler) {
    this.closeHandlers.push(handler);
  }
  async start() {
    this.state = "Connected";
  }
  async stop() {
    this.state = "Disconnected";
  }
  async invoke() {
    return {};
  }

  close(error?: Error) {
    for (const handler of this.closeHandlers) handler(error);
  }
}

vi.mock("@microsoft/signalr", () => {
  class FakeBuilder {
    withUrl() {
      return this;
    }
    withAutomaticReconnect() {
      return this;
    }
    configureLogging() {
      return this;
    }
    build() {
      const connection = new FakeHubConnection();
      built.push(connection);
      return connection;
    }
  }

  return {
    HubConnectionBuilder: FakeBuilder,
    HubConnectionState: {
      Disconnected: "Disconnected",
      Connecting: "Connecting",
      Connected: "Connected",
      Reconnecting: "Reconnecting",
    },
    HttpTransportType: { WebSockets: 1, ServerSentEvents: 2, LongPolling: 4 },
    LogLevel: { Information: 2 },
  };
});

/** The worker talks to the main thread through `self`; stand in for it and keep what it says. */
const posted: any[] = [];
const fakeSelf = {
  postMessage: (message: any) => {
    posted.push(message);
  },
  onmessage: null as ((e: { data: any }) => void) | null,
};

/** Hand the worker a message as the main thread would, then let its async work settle. */
async function send(data: any) {
  fakeSelf.onmessage?.({ data });
  await vi.advanceTimersByTimeAsync(0);
}

const stateMessages = () => posted.filter((m) => m.type === "state");

beforeEach(async () => {
  vi.useFakeTimers();
  built.length = 0;
  posted.length = 0;
  fakeSelf.onmessage = null;
  vi.stubGlobal("self", fakeSelf);
  // Fresh module state per test: the worker keeps its connection in module scope.
  vi.resetModules();
  await import("@/workers/realtimeWorker");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("realtime worker connection lifecycle", () => {
  test("ignores the close of a connection that has already been replaced", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    const first = built[0];
    expect(first.state).toBe("Connected");

    // What `retryConnectionNow` does: drop the connection and immediately dial again, without
    // waiting for the old socket to finish closing.
    await send({ type: "disconnect" });
    await send({ type: "connect", endpoint: "https://api.test" });
    expect(built).toHaveLength(2);
    expect(built[1].state).toBe("Connected");

    posted.length = 0;
    first.close(new Error("socket closed after its replacement was up"));
    await vi.advanceTimersByTimeAsync(0);

    // The live connection must not be reported as lost, and nothing may be queued on top of it.
    expect(stateMessages()).toHaveLength(0);
    expect(posted.some((m) => m.type === "reconnectInfo")).toBe(false);

    // No third connection is dialled once the backoff would have elapsed.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(built).toHaveLength(2);
  });

  test("still reconnects when the current connection closes", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    const current = built[0];

    posted.length = 0;
    current.close(new Error("server went away"));
    await vi.advanceTimersByTimeAsync(0);

    expect(stateMessages()).toEqual([{ type: "state", state: "disconnected" }]);
    expect(posted.some((m) => m.type === "reconnectInfo")).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(built.length).toBeGreaterThan(1);
  });

  test("reports a close we asked for as intentional", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    const current = built[0];

    posted.length = 0;
    await send({ type: "disconnect" });
    current.close();
    await vi.advanceTimersByTimeAsync(0);

    expect(stateMessages()).toEqual([
      { type: "state", state: "disconnected", intentional: true },
    ]);
    expect(posted.some((m) => m.type === "reconnectInfo")).toBe(false);
  });
});
