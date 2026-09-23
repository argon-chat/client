/**
 * The input side of a full-duplex stream: commands pushed by the worker, pulled by the stream.
 *
 * Single consumer: the call's input pump. The pump asks for the next item as soon as it has sent
 * the last one, so it is usually already waiting when the connection drops — and whatever it is
 * handed then, it holds and sends on the next connection. So while the stream is down the queue is
 * {@link hold held}: items wait here, where {@link pushLatest} can still replace them, and nothing
 * reaches the pump until {@link release}.
 */
export class CommandQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiter: ((result: IteratorResult<T>) => void) | null = null;
  private held: boolean;
  private closed = false;

  constructor(options: { held?: boolean } = {}) {
    this.held = options.held ?? false;
  }

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.deliver();
  }

  /**
   * Replaces a waiting item `same` recognises instead of queueing another, so at most one of its
   * kind waits. For commands where only the latest one means anything.
   */
  pushLatest(item: T, same: (queued: T) => boolean): void {
    const at = this.items.findIndex(same);
    if (at >= 0) this.items[at] = item;
    else this.push(item);
  }

  /** Keeps items from the consumer until {@link release}. */
  hold(): void {
    this.held = true;
  }

  release(): void {
    this.held = false;
    this.deliver();
  }

  /** Ends the iteration; what is still waiting is dropped. */
  close(): void {
    this.closed = true;
    this.items.length = 0;
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.({ value: undefined, done: true });
  }

  private deliver(): void {
    const waiter = this.waiter;
    if (waiter === null || this.held || this.items.length === 0) return;
    this.waiter = null;
    waiter({ value: this.items.shift()!, done: false });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiter = resolve;
          this.deliver();
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
