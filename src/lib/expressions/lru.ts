export interface ByteLruOptions<V> {
  maxEntries: number;
  maxBytes: number;
  sizeOf: (value: V) => number;
  /** Called for every value that leaves the cache (evicted, replaced, deleted, cleared). */
  onEvict?: (value: V) => void;
}

/** An LRU bounded by both entry count and total bytes. A value larger than `maxBytes` is not kept. */
export class ByteLru<K, V> {
  private readonly map = new Map<K, { value: V; bytes: number }>();
  private total = 0;

  constructor(private readonly options: ByteLruOptions<V>) {}

  get size(): number {
    return this.map.size;
  }

  get bytes(): number {
    return this.total;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Reads without touching the recency. */
  peek(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  get(key: K): V | undefined {
    const slot = this.map.get(key);
    if (!slot) return undefined;
    this.map.delete(key);
    this.map.set(key, slot);
    return slot.value;
  }

  /** False when the value is too large to keep; the caller still owns it then. */
  set(key: K, value: V): boolean {
    const bytes = this.options.sizeOf(value);
    const old = this.map.get(key);
    if (old) {
      this.map.delete(key);
      this.total -= old.bytes;
      if (old.value !== value) this.options.onEvict?.(old.value);
    }
    if (bytes > this.options.maxBytes) return false;
    this.map.set(key, { value, bytes });
    this.total += bytes;
    this.trim();
    return true;
  }

  delete(key: K): boolean {
    const slot = this.map.get(key);
    if (!slot) return false;
    this.map.delete(key);
    this.total -= slot.bytes;
    this.options.onEvict?.(slot.value);
    return true;
  }

  clear(): void {
    for (const slot of this.map.values()) this.options.onEvict?.(slot.value);
    this.map.clear();
    this.total = 0;
  }

  private trim(): void {
    const { maxEntries, maxBytes } = this.options;
    for (const [key, slot] of this.map) {
      if (this.map.size <= maxEntries && this.total <= maxBytes) break;
      this.map.delete(key);
      this.total -= slot.bytes;
      this.options.onEvict?.(slot.value);
    }
  }
}
