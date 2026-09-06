/**
 * When the worker asks the app what status to report.
 *
 * The heartbeat is the only channel through which the server ever learns this client's real status:
 * `AppHub.OnConnectedAsync` attaches the connection with no preferred status, so the session starts
 * Online and stays Online until a heartbeat says otherwise. That makes the timing of the FIRST
 * heartbeat a presence-visible property, not an implementation detail — every millisecond between
 * the connection coming up and that message landing is time a Do-Not-Disturb user is broadcast as
 * Online to their spaces and their friends.
 *
 * The cadence pinned here is also what makes the `busStore` fallback matter: the first heartbeat is
 * asked for the instant the socket is up, which on a cold start is *before* `meStore.init()` has
 * fetched the profile. See `test/store/busHeartbeatStatus.test.ts` for what the app answers in that
 * window.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

type Handler = (arg?: any) => void;

/** Every connection the worker has built, in order. */
const built: FakeHubConnection[] = [];

class FakeHubConnection {
  state = "Disconnected";
  connectionId = "fake-connection";
  reconnectedHandlers: Handler[] = [];
  closeHandlers: Handler[] = [];
  /** Every hub method the worker invoked, in order. */
  invocations: { method: string; args: any[] }[] = [];

  on() {}
  onreconnecting() {}
  onreconnected(handler: Handler) {
    this.reconnectedHandlers.push(handler);
  }
  onclose(handler: Handler) {
    this.closeHandlers.push(handler);
  }
  async start() {
    this.state = "Connected";
  }
  async stop() {
    this.state = "Disconnected";
  }
  async invoke(method: string, ...args: any[]) {
    this.invocations.push({ method, args });
    return {};
  }

  /** SignalR's own auto-reconnect succeeded. */
  reconnect() {
    this.state = "Connected";
    for (const handler of this.reconnectedHandlers) handler("fake-connection");
  }

  close(error?: Error) {
    this.state = "Disconnected";
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

const heartbeatRequests = () => posted.filter((m) => m.type === "heartbeatRequest");

beforeEach(async () => {
  vi.useFakeTimers();
  built.length = 0;
  posted.length = 0;
  fakeSelf.onmessage = null;
  vi.stubGlobal("self", fakeSelf);
  // Fresh module state per test: the worker keeps its connection and timer in module scope.
  vi.resetModules();
  await import("@/workers/realtimeWorker");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("realtime worker heartbeat", () => {
  test("asks for a status the moment the connection is up, not a tick later", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });

    // Nothing has been allowed to elapse beyond the connect itself.
    expect(heartbeatRequests()).toHaveLength(1);
  });

  test("keeps asking every 15 seconds", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    posted.length = 0;

    await vi.advanceTimersByTimeAsync(15_000);
    expect(heartbeatRequests()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(heartbeatRequests()).toHaveLength(4);
  });

  test("the status the app answers with is what reaches the hub", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });

    // `UserStatus.DoNotDisturb`
    await send({ type: "heartbeatInvoke", status: 6 });

    expect(built[0].invocations).toContainEqual({ method: "Heartbeat", args: [6] });
  });

  test("a reconnect re-asserts the status immediately instead of waiting out the interval", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    posted.length = 0;

    // The server re-ran OnConnectedAsync and put the session back to Online; a full interval of
    // silence here is a full interval of everyone seeing the wrong status.
    built[0].reconnect();
    await vi.advanceTimersByTimeAsync(0);

    expect(heartbeatRequests()).toHaveLength(1);
  });

  test("a dropped connection stops the heartbeat rather than asking into the void", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    built[0].close(new Error("server went away"));
    await vi.advanceTimersByTimeAsync(0);
    posted.length = 0;

    // Deliberately shorter than the first backoff (500–1000 ms with jitter), so this window holds
    // no reconnect and any heartbeat in it would be one asked of a connection that is gone.
    await vi.advanceTimersByTimeAsync(400);

    expect(heartbeatRequests()).toHaveLength(0);
    expect(built).toHaveLength(1);
  });

  test("a connection closed on purpose does not keep a heartbeat running behind it", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    await send({ type: "disconnect" });
    built[0].close();
    await vi.advanceTimersByTimeAsync(0);
    posted.length = 0;

    // Logout / account switch: no reconnect is coming, so nothing may keep ticking.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(heartbeatRequests()).toHaveLength(0);
    expect(built).toHaveLength(1);
  });

  test("going offline on purpose is sent to the hub", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });

    await send({ type: "invoke", method: "GoOffline", args: [] });

    expect(built[0].invocations).toContainEqual({ method: "GoOffline", args: [] });
  });

  test("a status answer that arrives after the connection died is not invoked on a dead hub", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    const connection = built[0];
    connection.close(new Error("server went away"));
    await vi.advanceTimersByTimeAsync(0);
    connection.invocations.length = 0;

    await send({ type: "heartbeatInvoke", status: 6 });

    expect(connection.invocations).toEqual([]);
  });
});
