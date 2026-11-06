/**
 * A worker's body run on the main thread, behind an object shaped like the `Worker` it stands for.
 *
 * vue-native has no Workers yet (its Workers v1 is designed, not built), so `new RealtimeWorker()`
 * is a stub there that throws a named error, and the app would run with no incoming events at all.
 * Until Workers land, the realtime core runs here instead. vue-native's
 * research/reports/m26/client-gap.md §4, "realtime worker in-thread"; client-gap/A-webapi.md #10.
 *
 * The two sides talk through a pair of fake MessagePorts, because vue-native has no MessageChannel
 * either. What a port pair promises, these keep:
 * - each message is its own task (a `setTimeout(0)`), in the order it was posted, never
 *   synchronously inside `postMessage`;
 * - a port holds what it is sent until it is started, the way a MessagePort holds its messages until
 *   `onmessage` is set: the body loads asynchronously, and what the caller posted in the meantime
 *   (the first `connect`) waits for it;
 * - after `terminate()` nothing is delivered either way.
 *
 * Messages are handed over as they are, not structured-cloned. That is safe for the realtime
 * protocol: its messages are plain data, and neither side reads or changes a message, or a buffer it
 * transferred, after posting it.
 */

/** A worker body: what its `self.onmessage` does, and how to stop what it started. */
export interface WorkerBody {
  handle(message: unknown): void;
  /** What `Worker.terminate()` gets for free: the body's sockets and timers stopped. */
  dispose(): void;
}

/** Starts a body that answers through `post` (its `self.postMessage`). */
export type StartWorkerBody = (post: (message: unknown, transfer?: Transferable[]) => void) => WorkerBody;

/** One end of a {@link portPair}. */
export interface FakePort {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  /** Delivers what was held, and from now on each message as it comes. */
  start(): void;
  /** Drops what is held, and everything posted to or from this end from now on. */
  close(): void;
}

/** Two connected ends: what one posts, the other receives. */
export function portPair(): [FakePort, FakePort] {
  const a = new PortEnd();
  const b = new PortEnd();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

class PortEnd implements FakePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  peer: PortEnd | null = null;
  private readonly held: unknown[] = [];
  private started = false;
  private closed = false;

  postMessage(message: unknown): void {
    const peer = this.peer;
    if (this.closed || !peer || peer.closed) return;
    peer.receive(message);
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    for (const message of this.held.splice(0)) this.schedule(message);
  }

  close(): void {
    this.closed = true;
    this.held.length = 0;
  }

  private receive(message: unknown): void {
    if (this.started) this.schedule(message);
    else this.held.push(message);
  }

  private schedule(message: unknown): void {
    setTimeout(() => {
      if (!this.closed) this.onmessage?.({ data: message } as MessageEvent);
    }, 0);
  }
}

/** The subset of `Worker` a caller of a dedicated worker uses, run on this thread. */
class InThreadWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  private readonly outside: FakePort;
  private readonly inside: FakePort;
  private body: WorkerBody | null = null;
  private terminated = false;

  constructor(load: () => Promise<StartWorkerBody>) {
    [this.outside, this.inside] = portPair();
    this.outside.onmessage = (event) => this.onmessage?.(event);
    this.outside.start();

    load().then(
      (start) => {
        if (this.terminated) return;
        const body = start((message) => this.inside.postMessage(message));
        this.body = body;
        this.inside.onmessage = (event) => {
          // In a worker an uncaught error in its handler becomes an `error` event at the Worker.
          try {
            body.handle(event.data);
          } catch (error) {
            this.fail(error);
          }
        };
        this.inside.start();
      },
      (error) => this.fail(error),
    );
  }

  postMessage(message: unknown, _transfer?: Transferable[] | StructuredSerializeOptions): void {
    this.outside.postMessage(message);
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.outside.close();
    this.inside.close();
    this.body?.dispose();
    this.body = null;
  }

  private fail(error: unknown): void {
    if (this.terminated) return;
    const message = error instanceof Error ? error.message : String(error);
    const event = { type: "error", message, error } as unknown as ErrorEvent;
    if (this.onerror) this.onerror(event);
    else console.error("[vue-native] in-thread worker:", error);
  }
}

/**
 * A `Worker` whose body runs on this thread. `load` resolves to the body's start function; it is
 * loaded lazily so a browser build, which never takes this path, does not carry the body twice.
 */
export function inThreadWorker(load: () => Promise<StartWorkerBody>): Worker {
  // Typed as the Worker it replaces for its one caller (busStore), which uses exactly
  // postMessage, terminate, onmessage and onerror.
  return new InThreadWorker(load) as unknown as Worker;
}
