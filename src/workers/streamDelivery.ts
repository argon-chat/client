/**
 * What to deliver off a replayable event stream, and where to resume it from.
 *
 * One instance per delivery channel — the caller's own stream, and one per space. Never one shared:
 * a stream entry id is unique only within its own stream, so the same `<unixMs>-<seq>` can name a
 * different event in another space.
 *
 * These two questions used to be one. The cursor was also the filter: an entry whose id was not
 * greater than the last one seen was taken for a duplicate and dropped. That only holds while
 * publishes are ordered relative to each other, and they are not — an event is handed to the
 * backplane after the grain turn rather than inside it, so one can land a few hundred milliseconds
 * behind an event with a higher id. Late is not the same as duplicate, and dropping it was final:
 * the cursor had already moved past it, so no resume would ever replay it either. On desktop that
 * was occasional silent message loss.
 *
 * So they are separate here. Delivery is decided by id, against a bounded window of what has
 * already been delivered; the cursor stays the high-water mark, which is what Resume hands the
 * server to replay from.
 */
export class DeliveryFilter {
  /**
   * How many delivered ids to remember. This is a duplicate filter, not a log — the only duplicate
   * that can turn up is a replayed event that also arrived live, and that overlap is one gap's worth
   * of events, not a session's.
   */
  static readonly window = 1024;

  // Insertion-ordered, so the first value is the oldest id and the one to drop when the window fills.
  private readonly delivered = new Set<string>();
  private highWater: string | null = null;

  /** Where a Resume picks up: the highest id offered so far, delivered or not. */
  get cursor(): string | null {
    return this.highWater;
  }

  /** True the first time an id is offered, false for a repeat. Moves the cursor either way. */
  accept(entryId: string): boolean {
    if (!this.highWater || compareStreamIds(entryId, this.highWater) > 0)
      this.highWater = entryId;

    if (this.delivered.has(entryId)) return false;

    this.delivered.add(entryId);

    if (this.delivered.size > DeliveryFilter.window) {
      const oldest = this.delivered.values().next().value;
      if (oldest !== undefined) this.delivered.delete(oldest);
    }

    return true;
  }
}

/**
 * Compare Redis stream ids of the form `<unixMs>-<seq>`. Returns <0, 0, >0.
 *
 * Compared part by part as numbers rather than as strings: the sequence half is not zero-padded, so
 * `"5-9"` sorts after `"5-10"` lexicographically.
 */
export function compareStreamIds(a: string, b: string): number {
  const ai = a.indexOf("-");
  const bi = b.indexOf("-");
  const aMs = Number(a.slice(0, ai));
  const bMs = Number(b.slice(0, bi));
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  const aSeq = Number(a.slice(ai + 1));
  const bSeq = Number(b.slice(bi + 1));
  if (aSeq !== bSeq) return aSeq < bSeq ? -1 : 1;
  return 0;
}
