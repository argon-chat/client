/**
 * `WebSocketStream` on top of a plain `WebSocket`, for the browsers that do not have it.
 *
 * **Why.** The realtime transport reads frames as a stream rather than an event at a time, and
 * `WebSocketStream` is a Chromium-only API — Firefox and Safari have never shipped it. Without this
 * the boot gate turned them away at the door, which is a heavy price for an interface that is a thin
 * wrapper over something every browser has had for fifteen years.
 *
 * **What it is not.** The real thing carries backpressure all the way down to the socket: a consumer
 * that stops reading stops the flow of TCP acknowledgements. A `WebSocket` has no such lever — frames
 * arrive whether anyone wants them or not — so the readable here is a queue that grows while nobody
 * reads it. `highWaterMark` bounds what the stream reports as desired, not what the socket delivers.
 * For a chat feed that is the right trade; for a firehose it would not be.
 *
 * Writing does respect the one lever there is: `bufferedAmount`. A write resolves once the socket has
 * actually drained, so a producer that outruns the network is slowed by it rather than filling memory
 * inside the WebSocket.
 *
 * Installed only where the API is missing, and never on the desktop build, which ships its own
 * Chromium and has the real one.
 */
import { logger } from "@argon/core";

type Frame = Uint8Array | string;

/** How many unread frames to hold before the stream reports itself unwilling. */
const READ_QUEUE_HIGH_WATER_MARK = 64;

/** How long to wait for a send buffer to drain before giving up on the socket. */
const DRAIN_TIMEOUT_MS = 30_000;

/** How often to look at `bufferedAmount`; there is no event for it. */
const DRAIN_POLL_MS = 16;

class WebSocketStreamShim<T extends Frame = Frame> {
  readonly url: string;
  readonly opened: Promise<WebSocketConnection<T>>;
  readonly closed: Promise<WebSocketCloseInfo>;

  private socket: WebSocket | null = null;

  constructor(url: string, options: WebSocketStreamOptions = {}) {
    this.url = url;

    let resolveClosed!: (info: WebSocketCloseInfo) => void;
    let rejectClosed!: (reason: unknown) => void;
    this.closed = new Promise<WebSocketCloseInfo>((resolve, reject) => {
      resolveClosed = resolve;
      rejectClosed = reject;
    });

    this.opened = new Promise<WebSocketConnection<T>>((resolveOpened, rejectOpened) => {
      // Aborting before the socket exists still has to reject both promises, or a caller that passed
      // an already-aborted signal waits for ever on `opened`.
      if (options.signal?.aborted) {
        const reason = options.signal.reason ?? new DOMException("Aborted", "AbortError");
        rejectOpened(reason);
        rejectClosed(reason);
        return;
      }

      const socket = new WebSocket(url, options.protocols);
      this.socket = socket;

      // Binary as bytes, not Blob: the transport reads Uint8Array, and a Blob would make every frame
      // an extra asynchronous hop before it could be parsed.
      socket.binaryType = "arraybuffer";

      // Filled by the readable's start; messages that arrive before it are impossible, because the
      // stream is constructed synchronously below and `open` cannot fire before this turn ends.
      let push: (frame: T) => void = () => {};
      let finish: () => void = () => {};
      let fail: (reason: unknown) => void = () => {};

      const readable = new ReadableStream<T>(
        {
          start(controller) {
            push = (frame) => {
              try {
                controller.enqueue(frame);
              } catch {
                // Enqueued after close: the consumer has gone. Dropping is correct — the alternative
                // is an unhandled rejection for a frame nobody is waiting for.
              }
            };
            finish = () => {
              try { controller.close(); } catch { /* already closed */ }
            };
            fail = (reason) => {
              try { controller.error(reason); } catch { /* already errored */ }
            };
          },
          cancel() {
            // The consumer is done with us. There is no half-close on a WebSocket, so this ends it.
            try { socket.close(1000, "reader cancelled"); } catch { /* already closing */ }
          },
        },
        // Advisory only, as the class comment says: it changes `desiredSize`, not the socket.
        new CountQueuingStrategy({ highWaterMark: READ_QUEUE_HIGH_WATER_MARK }),
      );

      const writable = new WritableStream<T>({
        write: async (chunk) => {
          if (socket.readyState !== WebSocket.OPEN)
            throw new DOMException("The socket is not open", "InvalidStateError");

          // The frame type is `Uint8Array | string` by the interface's own generic, which is
          // narrower than what `send` accepts — the cast names that, rather than widening the
          // stream's type to something the transport never produces.
          socket.send(chunk as string | Uint8Array<ArrayBuffer>);
          await drain(socket);
        },
        close: () => {
          try { socket.close(1000); } catch { /* already closing */ }
        },
        abort: (reason) => {
          logger.warn("[ws-stream] the writer aborted; closing the socket", reason);
          try { socket.close(1011, "writer aborted"); } catch { /* already closing */ }
        },
      });

      socket.addEventListener("open", () => {
        resolveOpened({
          readable,
          writable,
          protocol: socket.protocol,
          extensions: socket.extensions,
        });
      });

      socket.addEventListener("message", (event: MessageEvent) => {
        // ArrayBuffer for binary (see binaryType above), string for text — the two the interface
        // is generic over.
        push((event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data) as T);
      });

      socket.addEventListener("close", (event: CloseEvent) => {
        finish();
        resolveClosed({ closeCode: event.code, reason: event.reason });
        // A socket that never opened rejects `opened` rather than leaving it pending for ever. The
        // event carries no cause — a browser deliberately withholds why a handshake failed — so the
        // code is all there is to report.
        rejectOpened(new DOMException(`The socket closed before opening (code ${event.code})`, "NetworkError"));
      });

      socket.addEventListener("error", () => {
        // `error` on a WebSocket is deliberately opaque; `close` always follows it and carries the
        // code, so that is where the outcome is settled. This only tears down the readable so a
        // consumer sees a failure instead of a clean end of stream.
        fail(new DOMException("The socket failed", "NetworkError"));
      });

      options.signal?.addEventListener(
        "abort",
        () => {
          const reason = options.signal!.reason ?? new DOMException("Aborted", "AbortError");
          rejectOpened(reason);
          try { socket.close(1000, "aborted"); } catch { /* already closing */ }
        },
        { once: true },
      );
    });

    // Nothing else observes these; without a handler a rejection that the caller has not yet awaited
    // is reported as unhandled.
    void this.opened.catch(() => {});
    void this.closed.catch(() => {});
  }

  close(closeInfo: WebSocketCloseInfo = {}): void {
    try {
      this.socket?.close(closeInfo.closeCode ?? 1000, closeInfo.reason);
    } catch {
      /* already closing, or never opened */
    }
  }
}

/**
 * Resolves once the socket has sent what it was given.
 *
 * There is no drain event on a WebSocket, so this polls `bufferedAmount` — the only signal the
 * platform offers. Bounded, because a socket that stops draining will never start: a write that
 * hangs for ever is worse than one that fails.
 */
function drain(socket: WebSocket): Promise<void> {
  if (socket.bufferedAmount === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const tick = () => {
      if (socket.bufferedAmount === 0) return resolve();

      if (socket.readyState !== WebSocket.OPEN)
        return reject(new DOMException("The socket closed while sending", "NetworkError"));

      if (Date.now() - startedAt > DRAIN_TIMEOUT_MS)
        return reject(new DOMException("The socket did not drain", "TimeoutError"));

      setTimeout(tick, DRAIN_POLL_MS);
    };

    setTimeout(tick, DRAIN_POLL_MS);
  });
}

/**
 * Puts the shim in place where the browser has no `WebSocketStream`.
 *
 * Call before anything opens a socket. Returns whether it installed one, which is worth knowing in
 * a bug report: the shim and the real API fail differently under load.
 */
export function installWebSocketStreamShim(): boolean {
  const scope = globalThis as unknown as { WebSocketStream?: unknown; WebSocket?: unknown };

  if (typeof scope.WebSocketStream === "function") return false;

  if (typeof scope.WebSocket !== "function") {
    // Nothing to build on. The boot gate still requires WebSocket itself, so this is unreachable in
    // the app and present so the module is safe to import anywhere.
    logger.warn("[ws-stream] no WebSocket to build on; the shim was not installed");
    return false;
  }

  scope.WebSocketStream = WebSocketStreamShim;
  logger.info("[ws-stream] this browser has no WebSocketStream; a WebSocket-backed shim is in use");

  return true;
}
