/**
 * The main thread's half of the realtime worker protocol.
 *
 * Three things live here because the worker cannot do them. The ticket exchange runs through the
 * API client's interceptors, which read stores the worker does not have — and its failure has to
 * come back in a shape that tells the worker whether to retry, back off, or stop for good. Events
 * are decoded here, from the bytes the worker transferred, so they arrive with their prototypes.
 * And a connection that came back is told apart from one that came back empty: a resumed stream
 * missed nothing, and must not set off the resync a fresh session needs.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { CborWriter, IonFormatterStorage, IonRequestException } from "@argon-chat/ion.webcore";
import { UserStopTypingEvent, type IArgonEvent } from "@argon/glue";

const h = vi.hoisted(() => ({
  workers: [] as any[],
  exchange: null as unknown as (i: string, m: string) => Promise<Uint8Array>,
  recovery: "renewed" as string,
  handleSessionRejected: null as any,
  forceSignOut: null as any,
  counts: [] as { name: string; attrs?: Record<string, unknown> }[],
}));

class FakeWorker {
  posted: { message: any; transfer?: Transferable[] }[] = [];
  onmessage: ((e: { data: any }) => unknown) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  postMessage(message: any, transfer?: Transferable[]) {
    this.posted.push({ message, transfer });
  }
  terminate() {}
  /** Speak as the worker does, and wait for the handler to finish. */
  async say(data: any) {
    await this.onmessage?.({ data });
  }
  messages(type: string) {
    return this.posted.filter((p) => p.message.type === type);
  }
}

vi.mock("@/workers/realtimeWorker?worker", () => ({
  default: class {
    constructor() {
      const worker = new FakeWorker();
      h.workers.push(worker);
      return worker as never;
    }
  },
}));
vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: {
    count: (name: string, attrs?: Record<string, unknown>) => h.counts.push({ name, attrs }),
    distribution() {},
    gauge() {},
  },
  errorKind: () => "x",
}));
vi.mock("@/lib/net/sessionRecovery", () => ({
  handleSessionRejected: (...args: unknown[]) => h.handleSessionRejected(...args),
  forceSignOut: (...args: unknown[]) => h.forceSignOut(...args),
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    apiEndpoint: "https://api.test",
    ionSessionId: "sid-1",
    webTransportEndpoint: "https://api.test:4433",
    exchangeStreamTicket: (i: string, m: string) => h.exchange(i, m),
  }),
}));
vi.mock("@/store/data/channelStore", () => ({
  useChannelStore: () => ({ selectedTextChannel: null }),
}));

import { useBus } from "@/store/realtime/busStore";

async function connectedBus() {
  const bus = useBus();
  await bus.doListenMyEvents();
  return { bus, worker: h.workers.at(-1) as FakeWorker };
}

function encode(event: IArgonEvent): ArrayBuffer {
  const w = new CborWriter();
  IonFormatterStorage.get<IArgonEvent>("IArgonEvent").write(w, event);
  return w.data.slice().buffer;
}

const SPACE = "0b7a1c9e-4c6f-4d7e-9a51-3f1d2c3b4a5e";
const CHANNEL = "2d9c3eb0-6e81-4f90-9c73-513f4e5d6c70";
const USER = "3ead4fc1-7f92-4a01-8d84-624f5f6e7d81";

beforeEach(() => {
  h.workers.length = 0;
  h.counts.length = 0;
  h.recovery = "renewed";
  h.handleSessionRejected = vi.fn(async () => h.recovery);
  h.forceSignOut = vi.fn();
  h.exchange = async () => Uint8Array.of(0x81, 0x42, 0x01, 0x02);
  setActivePinia(createPinia());
});

describe("connect", () => {
  test("tells the worker where to connect, as whom, and where WebTransport is", async () => {
    const { worker } = await connectedBus();

    expect(worker.messages("connect").map((p) => p.message)).toEqual([
      { type: "connect", endpoint: "https://api.test", sessionId: "sid-1", webTransport: "https://api.test:4433" },
    ]);
  });
});

describe("ticket exchange", () => {
  test("answers with the exchange's response bytes, transferred", async () => {
    const exchange = vi.fn(async () => Uint8Array.of(0x81, 0x42, 0x01, 0x02));
    h.exchange = exchange;
    const { worker } = await connectedBus();

    await worker.say({ type: "ticketRequest", requestId: "7" });

    expect(exchange).toHaveBeenCalledWith("IEventBus", "Realtime");
    const [answer] = worker.messages("ticketResponse");
    expect(answer.message.requestId).toBe("7");
    expect([...new Uint8Array(answer.message.payload)]).toEqual([0x81, 0x42, 0x01, 0x02]);
    expect(answer.transfer).toEqual([answer.message.payload]);
  });

  test("a refusal that ended the session is fatal: the worker stops asking", async () => {
    h.exchange = async () => {
      throw new IonRequestException({ code: "NO_AUTH", message: "no auth" }, 401);
    };
    h.recovery = "signed_out";
    const { worker } = await connectedBus();

    await worker.say({ type: "ticketRequest", requestId: "1" });

    expect(h.handleSessionRejected).toHaveBeenCalledTimes(1);
    expect(worker.messages("ticketResponse")[0].message).toEqual({
      type: "ticketResponse",
      requestId: "1",
      error: { status: 401, code: "NO_AUTH", message: "no auth" },
      fatal: true,
    });
    expect(h.counts.map((c) => c.name)).toContain("realtime.ticket.failed");
  });

  test("a refusal the token refresh recovered from is not fatal, and keeps its status", async () => {
    h.exchange = async () => {
      throw new IonRequestException({ code: "NO_AUTH", message: "no auth" }, 401);
    };
    h.recovery = "renewed";
    const { worker } = await connectedBus();

    await worker.say({ type: "ticketRequest", requestId: "1" });

    expect(worker.messages("ticketResponse")[0].message).toMatchObject({
      error: { status: 401, code: "NO_AUTH" },
      fatal: false,
    });
  });

  test("a network failure is reported without a status, so the worker retries it", async () => {
    h.exchange = async () => {
      throw new TypeError("Failed to fetch");
    };
    const { worker } = await connectedBus();

    await worker.say({ type: "ticketRequest", requestId: "1" });

    expect(h.handleSessionRejected).not.toHaveBeenCalled();
    expect(worker.messages("ticketResponse")[0].message).toEqual({
      type: "ticketResponse",
      requestId: "1",
      error: { message: "Failed to fetch" },
      fatal: false,
    });
  });
});

describe("events", () => {
  test("are decoded here, from the bytes the worker forwarded", async () => {
    const { bus, worker } = await connectedBus();
    const seen: IArgonEvent[] = [];
    bus.argonEventBus.subscribe((e) => seen.push(e));

    await worker.say({ type: "event", channel: "forSpace", data: encode(new UserStopTypingEvent(SPACE, CHANNEL, USER)) });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(UserStopTypingEvent);
    expect(seen[0]).toMatchObject({ spaceId: SPACE, channelId: CHANNEL, userId: USER });
  });

  test("an unreadable payload is counted and skipped, not fatal", async () => {
    const { bus, worker } = await connectedBus();
    const seen: IArgonEvent[] = [];
    bus.argonEventBus.subscribe((e) => seen.push(e));

    await worker.say({ type: "event", channel: "forSelf", data: Uint8Array.of(0xff).buffer });

    expect(seen).toHaveLength(0);
    expect(h.counts.map((c) => c.name)).toContain("realtime.event.decode_failed");
  });
});

describe("reconnects", () => {
  test("a fresh session after an outage asks the app to resync", async () => {
    const { bus, worker } = await connectedBus();
    const reconnected = vi.fn();
    const resumed = vi.fn();
    bus.reconnected.subscribe(reconnected);
    bus.resumed.subscribe(resumed);

    await worker.say({ type: "state", state: "connected" });
    await worker.say({ type: "state", state: "reconnecting" });
    expect(bus.isReconnecting).toBe(true);
    await worker.say({ type: "state", state: "connected" });

    expect(bus.isReconnecting).toBe(false);
    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(resumed).not.toHaveBeenCalled();
  });

  test("a resumed stream missed nothing: no resync, but still a reconnect in the metrics", async () => {
    const { bus, worker } = await connectedBus();
    const reconnected = vi.fn();
    const resumed = vi.fn();
    bus.reconnected.subscribe(reconnected);
    bus.resumed.subscribe(resumed);

    await worker.say({ type: "state", state: "connected" });
    await worker.say({ type: "state", state: "reconnecting" });
    await worker.say({ type: "state", state: "connected", resumed: true });

    expect(bus.isReconnecting).toBe(false);
    expect(reconnected).not.toHaveBeenCalled();
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(h.counts.filter((c) => c.name === "realtime.connected").map((c) => c.attrs)).toEqual([
      { reconnect: false },
      { reconnect: true },
    ]);
  });

  test("the server ending the session signs the device out with its reason", async () => {
    const { worker } = await connectedBus();

    await worker.say({ type: "sessionRevoked", reason: "session_signed_out" });

    expect(h.forceSignOut).toHaveBeenCalledWith("session_signed_out", "server signal");
  });
});
