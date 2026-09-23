/**
 * The realtime worker, run against the real Ion stream client with the network faked underneath it.
 *
 * The worker is driven exactly as the app drives it — messages on `self` — and the server side of
 * each WebSocket it opens is scripted by the test: accept, READY (resumable or not), RESUMED, the
 * realtime frames, a drop without a goodbye, a CLOSE or an ERROR. What the worker sent back is read
 * off the socket as decoded `RealtimeCommand`s. Modelled on ion.webcore's own `streamFakes`.
 */

import { vi } from "vitest";
import {
  CborReader,
  CborWriter,
  IonFormatterStorage,
  type WebSocketLike,
} from "@argon-chat/ion.webcore";
import type { IRealtimeCommand, IRealtimeFrame } from "@argon/glue";

// ─── frames ─────────────────────────────────────────────────────────────────

const OP_DATA = 0x00;
const OP_ERROR = 0x02;
const OP_CLOSE = 0x04;
const OP_READY = 0x05;
const OP_RESUME = 0x07;
const OP_RESUMED = 0x08;

function cbor(write: (w: CborWriter) => void): Uint8Array {
  const w = new CborWriter();
  write(w);
  return w.data.slice();
}

function frame(opcode: number, payload: Uint8Array): Uint8Array {
  const f = new Uint8Array(1 + payload.length);
  f[0] = opcode;
  f.set(payload, 1);
  return f;
}

/** READY; with a token the session is resumable. No keep-alive, so silence never times it out. */
function readyFrame(resumeToken?: string): Uint8Array {
  return frame(
    OP_READY,
    cbor((w) => {
      w.writeStartArray(resumeToken === undefined ? 3 : 5);
      w.writeTextString("conn-1");
      w.writeUInt32(0);
      w.writeUInt32(0);
      if (resumeToken !== undefined) {
        w.writeTextString(resumeToken);
        w.writeUInt32(30_000);
      }
      w.writeEndArray();
    }),
  );
}

export const TICKET_BYTES = Uint8Array.of(0x42, 0x01);

/** What `/ion.att` answers: `array(1)[ticket bytes]`. */
export function ticketResponseBytes(): Uint8Array {
  return cbor((w) => {
    w.writeStartArray(1);
    w.writeByteString(TICKET_BYTES);
    w.writeEndArray();
  });
}

/** An `ArgonEvent` payload stand-in: the worker forwards it untouched, so any bytes will do. */
export const payload = (...bytes: number[]) => Uint8Array.from(bytes);

// ─── the server side of one WebSocket ───────────────────────────────────────

export const sockets: FakeSocket[] = [];

export class FakeSocket implements WebSocketLike {
  binaryType: BinaryType = "blob";
  protocol = "";
  readyState = 0;
  bufferedAmount = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  /** Every message the client sent, copied; the first is the arguments or a RESUME. */
  readonly sent: Uint8Array[] = [];

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    sockets.push(this);
  }

  send(data: Uint8Array): void {
    if (this.readyState !== 1) throw new Error(`send() while readyState is ${this.readyState}`);
    this.sent.push(new Uint8Array(data));
  }

  close(): void {
    this.readyState = 3;
  }

  /** The client opened this connection to resume a session rather than start one. */
  get resuming(): boolean {
    return this.sent[0]?.[0] === OP_RESUME;
  }

  /** The commands the client sent on this connection, decoded. */
  commands(): IRealtimeCommand[] {
    return this.sent
      .filter((f) => f[0] === OP_DATA)
      .map((f) => {
        const reader = new CborReader(f.subarray(1));
        reader.readStartArray();
        const command = IonFormatterStorage.get<IRealtimeCommand>("IRealtimeCommand").read(reader);
        reader.readEndArray();
        return command;
      });
  }

  /** The commands as `UnionKey`s, the shape most assertions want. */
  commandKeys(): string[] {
    return this.commands().map((c) => c.UnionKey);
  }

  // ─── server side ───────────────────────────────────────────────────────

  /** Completes the upgrade with the sub-protocol the client offered. */
  accept(): this {
    this.protocol = this.protocols[this.protocols.length - 1] ?? "";
    this.readyState = 1;
    this.onopen?.({} as Event);
    return this;
  }

  /** READY: the server accepted a fresh session; `resumeToken` makes it resumable. */
  ready(resumeToken?: string): this {
    return this.raw(readyFrame(resumeToken));
  }

  /** RESUMED: the session survived; the server has the client's first `received` frames. */
  resumed(received: number): this {
    return this.raw(frame(OP_RESUMED, cbor((w) => {
      w.writeStartArray(1);
      w.writeUInt32(received);
      w.writeEndArray();
    })));
  }

  /** One realtime frame, as the server's stream method yields it. */
  push(value: IRealtimeFrame): this {
    return this.raw(frame(OP_DATA, cbor((w) => IonFormatterStorage.get<IRealtimeFrame>("IRealtimeFrame").write(w, value))));
  }

  /** The stream method failed the call. */
  fail(code: string, message: string): this {
    return this.raw(frame(OP_ERROR, cbor((w) => {
      w.writeStartArray(2);
      w.writeTextString(code);
      w.writeTextString(message);
      w.writeEndArray();
    })));
  }

  /** CLOSE: the server ended the stream on purpose. */
  closeStream(reason: string | null, allowReconnect: boolean): this {
    return this.raw(frame(OP_CLOSE, cbor((w) => {
      w.writeStartArray(2);
      if (reason === null) w.writeNull();
      else w.writeTextString(reason);
      w.writeBoolean(allowReconnect);
      w.writeEndArray();
    })));
  }

  /** The socket dies without an Ion goodbye. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "", wasClean: false } as CloseEvent);
  }

  private raw(bytes: Uint8Array): this {
    this.onmessage?.({ data: bytes.slice().buffer } as MessageEvent);
    return this;
  }
}

// ─── the main thread, as the worker sees it ─────────────────────────────────

/**
 * How the main thread answers a ticket request: with the exchange's response, a refusal that
 * signed the session out (`fatal`), a refusal it recovered from (`refused`), a network failure, or
 * not at all.
 */
export type TicketMode = "ok" | "fatal" | "refused" | "network" | "silent";

export const host = {
  posted: [] as any[],
  ticketMode: "ok" as TicketMode,
  ticketRequests: 0,
  onmessage: null as ((e: { data: any }) => void) | null,
  postMessage(message: any) {
    host.posted.push(message);
    if (message.type === "ticketRequest") {
      host.ticketRequests++;
      const mode = host.ticketMode;
      if (mode !== "silent") queueMicrotask(() => host.onmessage?.({ data: ticketAnswer(message.requestId, mode) }));
    }
  },
};

function ticketAnswer(requestId: string, mode: TicketMode) {
  switch (mode) {
    case "ok":
      return { type: "ticketResponse", requestId, payload: ticketResponseBytes().buffer };
    case "fatal":
      return { type: "ticketResponse", requestId, error: { status: 401, code: "NO_AUTH", message: "no auth" }, fatal: true };
    case "refused":
      return { type: "ticketResponse", requestId, error: { status: 401, code: "NO_AUTH", message: "no auth" }, fatal: false };
    default:
      return { type: "ticketResponse", requestId, error: { message: "Failed to fetch" }, fatal: false };
  }
}

/** Lets every promise chain the last step started run to its end, on fake timers. */
export async function settle() {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
}

/** Hand the worker a message as the main thread would, then let its async work settle. */
export async function send(data: any) {
  host.onmessage?.({ data });
  await settle();
}

export const posted = (type: string) => host.posted.filter((m) => m.type === type);
export const states = () => posted("state").map(({ type: _, ...rest }) => rest);

/** A fresh worker module on a fresh fake network. Call from `beforeEach`. */
export async function startWorker() {
  vi.useFakeTimers();
  sockets.length = 0;
  host.posted.length = 0;
  host.ticketMode = "ok";
  host.ticketRequests = 0;
  host.onmessage = null;
  vi.stubGlobal("self", host);
  vi.stubGlobal("WebSocket", FakeSocket);
  // Fresh module state per test: the worker keeps its call, cursors and timers in module scope.
  vi.resetModules();
  await import("@/workers/realtimeWorker");
}

/** Ends whatever the test left running, so no call outlives it. Call from `afterEach`. */
export async function stopWorker() {
  await send({ type: "disconnect" });
  vi.useRealTimers();
  vi.unstubAllGlobals();
}

/** `connect`, then the server accepts the socket, sends READY and a Welcome. */
export async function connectFresh(options: { resumeToken?: string; endpoint?: string } = {}) {
  await send({ type: "connect", endpoint: options.endpoint ?? "https://api.test", sessionId: "sid-1" });
  const ws = sockets.at(-1)!;
  await welcome(ws, options.resumeToken);
  return ws;
}

/** The server side of a fresh session on `ws`: accept, READY, Welcome. */
export async function welcome(ws: FakeSocket, resumeToken?: string) {
  const { Welcome } = await import("@argon/glue");
  ws.accept().ready(resumeToken).push(new Welcome("conn-1"));
  await settle();
}
