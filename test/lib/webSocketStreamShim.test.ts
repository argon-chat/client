/**
 * The `WebSocketStream` shim, driven through a fake socket.
 *
 * What these guard: the shim exists so Firefox and Safari can run the app at all — `WebSocketStream`
 * is Chromium-only — and it is the transport every realtime frame travels through. It cannot be
 * exercised here in the browsers it was written for, so what is pinned instead is the contract it
 * claims to implement: `opened` resolves with a duplex pair, frames arrive as `Uint8Array`, writes
 * reach the socket, and both ends settle when the socket closes rather than hanging a caller for
 * ever.
 *
 * The failure this is really watching for is a promise that never settles. A transport that throws
 * is debuggable; one that waits is a blank screen with nothing in the console.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { installWebSocketStreamShim } from "@/lib/shims/webSocketStream";

/** Enough of a WebSocket to drive the shim, with the events under the test's control. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  bufferedAmount = 0;
  protocol = "";
  extensions = "";

  readonly sent: unknown[] = [];
  readonly closedWith: { code?: number; reason?: string }[] = [];

  private listeners = new Map<string, ((event: any) => void)[]>();

  constructor(readonly url: string, readonly protocols?: string | string[]) {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    lastSocket = this;
  }

  addEventListener(type: string, handler: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler]);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closedWith.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  // ── the test's handles ──────────────────────────────────────────────────────────────────────

  emit(type: string, event: any = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }

  open(protocol = "argon") {
    this.readyState = FakeWebSocket.OPEN;
    this.protocol = protocol;
    this.emit("open");
  }

  deliver(data: unknown) {
    this.emit("message", { data });
  }

  remoteClose(code = 1000, reason = "bye") {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }
}

let lastSocket: FakeWebSocket | null = null;

const socket = () => {
  if (!lastSocket) throw new Error("no socket was constructed");
  return lastSocket;
};

/** The shim, installed over the fake. */
function connect(url = "wss://example.test/socket") {
  const Stream = (globalThis as any).WebSocketStream;
  return new Stream(url) as WebSocketStream;
}

describe("WebSocketStream shim", () => {
  beforeEach(() => {
    lastSocket = null;
    (globalThis as any).WebSocket = FakeWebSocket;
    delete (globalThis as any).WebSocketStream;
    expect(installWebSocketStreamShim()).toBe(true);
  });

  afterEach(() => {
    delete (globalThis as any).WebSocketStream;
    vi.restoreAllMocks();
  });

  it("does not replace a real implementation", () => {
    // Already installed by beforeEach, so a second call must decline — a browser that has the API
    // must keep it, backpressure and all.
    expect(installWebSocketStreamShim()).toBe(false);
  });

  it("resolves opened with the duplex pair once the socket opens", async () => {
    const stream = connect();
    socket().open("argon.v1");

    const connection = await stream.opened;

    expect(connection.readable).toBeInstanceOf(ReadableStream);
    expect(connection.writable).toBeInstanceOf(WritableStream);
    expect(connection.protocol).toBe("argon.v1");
    // The transport reads bytes; a Blob would put an extra async hop before every frame.
    expect(socket().binaryType).toBe("arraybuffer");
  });

  it("delivers binary frames as Uint8Array and text as string", async () => {
    const stream = connect();
    socket().open();
    const { readable } = await stream.opened;
    const reader = readable.getReader();

    socket().deliver(new Uint8Array([1, 2, 3]).buffer);
    socket().deliver("hello");

    const binary = await reader.read();
    expect(binary.value).toBeInstanceOf(Uint8Array);
    expect(Array.from(binary.value as Uint8Array)).toEqual([1, 2, 3]);

    const text = await reader.read();
    expect(text.value).toBe("hello");
  });

  it("sends what is written", async () => {
    const stream = connect();
    socket().open();
    const { writable } = await stream.opened;

    const writer = writable.getWriter();
    await writer.write(new Uint8Array([7, 7]));

    expect(socket().sent).toHaveLength(1);
    expect(Array.from(socket().sent[0] as Uint8Array)).toEqual([7, 7]);
  });

  it("refuses a write once the socket is gone rather than dropping it silently", async () => {
    const stream = connect();
    socket().open();
    const { writable } = await stream.opened;
    const writer = writable.getWriter();

    socket().remoteClose(1006, "gone");

    await expect(writer.write(new Uint8Array([1]))).rejects.toThrow();
  });

  it("ends the readable and settles closed when the socket closes", async () => {
    const stream = connect();
    socket().open();
    const { readable } = await stream.opened;
    const reader = readable.getReader();

    socket().remoteClose(1001, "going away");

    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
    await expect(stream.closed).resolves.toEqual({ closeCode: 1001, reason: "going away" });
  });

  /**
   * The one that matters most: a handshake that never completes must reject, not hang. A pending
   * `opened` is a boot that stops with nothing on screen and nothing in the console.
   */
  it("rejects opened when the socket closes before opening", async () => {
    const stream = connect();

    socket().remoteClose(1006, "handshake failed");

    await expect(stream.opened).rejects.toThrow(/closed before opening/);
    await expect(stream.closed).resolves.toMatchObject({ closeCode: 1006 });
  });

  it("closes the socket with the code it was given", async () => {
    const stream = connect();
    socket().open();
    await stream.opened;

    stream.close({ closeCode: 4000, reason: "done" });

    expect(socket().closedWith).toContainEqual({ code: 4000, reason: "done" });
  });

  it("cancelling the reader closes the socket", async () => {
    const stream = connect();
    socket().open();
    const { readable } = await stream.opened;

    await readable.getReader().cancel();

    expect(socket().closedWith.length).toBeGreaterThan(0);
  });
});
