export const DEFAULT_FRAME_CACHE_BUDGET = 64 * 1024 * 1024;

export interface FrameCacheEntry<F> {
  readonly key: string;
  readonly frames: Map<number, F>;
  readonly refs: Set<number>;
  bytes: number;
}

/**
 * Rendered frames per animation (key `${fileId}-${w}-${h}-${tone}`), shared by every player of that
 * key in one worker. One byte budget for all entries; going over it evicts whole unreferenced
 * entries, least recently used first. When only referenced entries are left, new frames are simply
 * not cached — the players render them each time instead of growing past the budget.
 *
 * A frame handed to `put` belongs to the cache when it returns true: the caller must not close or
 * transfer it.
 */
export class FrameCache<F extends { close?(): void }> {
  // Map order is the LRU order: touching an entry moves it to the end.
  private readonly entries = new Map<string, FrameCacheEntry<F>>();
  private total = 0;

  constructor(
    private readonly sizeOf: (frame: F) => number,
    private budget = DEFAULT_FRAME_CACHE_BUDGET,
  ) {}

  get totalBytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  setBudget(bytes: number): void {
    this.budget = bytes;
    this.evict(0);
  }

  peek(key: string): FrameCacheEntry<F> | undefined {
    return this.entries.get(key);
  }

  acquire(key: string, ref: number): FrameCacheEntry<F> {
    let entry = this.entries.get(key);
    if (!entry) entry = { key, frames: new Map(), refs: new Set(), bytes: 0 };
    else this.entries.delete(key);
    this.entries.set(key, entry);
    entry.refs.add(ref);
    return entry;
  }

  /** The entry stays (its frames may serve the next player of the key) until the budget needs it. */
  release(entry: FrameCacheEntry<F>, ref: number): void {
    entry.refs.delete(ref);
    if (!entry.refs.size && this.total > this.budget) this.evict(0);
  }

  get(entry: FrameCacheEntry<F>, frameNo: number): F | undefined {
    const frame = entry.frames.get(frameNo);
    if (frame && this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key);
      this.entries.set(entry.key, entry);
    }
    return frame;
  }

  put(entry: FrameCacheEntry<F>, frameNo: number, frame: F): boolean {
    if (this.entries.get(entry.key) !== entry || entry.frames.has(frameNo)) return false;
    const bytes = this.sizeOf(frame);
    if (!this.evict(bytes)) return false;
    entry.frames.set(frameNo, frame);
    entry.bytes += bytes;
    this.total += bytes;
    return true;
  }

  clear(): void {
    for (const entry of this.entries.values()) this.drop(entry);
    this.entries.clear();
    this.total = 0;
  }

  /** Makes room for `bytes` more; false when that would take a referenced entry. */
  private evict(bytes: number): boolean {
    if (this.total + bytes <= this.budget) return true;
    for (const entry of [...this.entries.values()]) {
      if (entry.refs.size) continue;
      this.entries.delete(entry.key);
      this.drop(entry);
      if (this.total + bytes <= this.budget) return true;
    }
    return this.total + bytes <= this.budget;
  }

  private drop(entry: FrameCacheEntry<F>): void {
    for (const frame of entry.frames.values()) frame.close?.();
    entry.frames.clear();
    this.total -= entry.bytes;
    entry.bytes = 0;
  }
}
