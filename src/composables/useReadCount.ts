import { logger } from "@argon/core";
import { useApi } from "@/store/system/apiStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";

/**
 * "Read by N" under announcements. Fetched lazily (when the line scrolls into view or is hovered),
 * batched: the posts asked about within {@link READ_COUNT_BATCH_MS} go out as one GetReadCounts
 * call per channel, up to {@link READ_COUNT_BATCH_MAX} ids each. An answer is kept for
 * {@link READ_COUNT_TTL_MS}.
 */

export interface ReadCount {
  readers: number;
  members: number;
}

export const READ_COUNT_TTL_MS = 60_000;
export const READ_COUNT_BATCH_MS = 300;
/** The server takes at most this many ids in one call. */
export const READ_COUNT_BATCH_MAX = 50;

interface Entry {
  /** Null when there is no count to show: no permission, too few members, gone, not an announcement. */
  value: ReadCount | null;
  fetchedAt: number;
  pending: Promise<ReadCount | null> | null;
}

/** A batch call that failed, as opposed to an answer that left the message out. */
const FAILED = Symbol("failed");
type Answer = ReadCount | null | typeof FAILED;

interface Batch {
  spaceId: string;
  channelId: string;
  waiting: Map<bigint, (answer: Answer) => void>;
  timer: ReturnType<typeof setTimeout>;
}

const cache = new Map<string, Entry>();
const batches = new Map<string, Batch>();

export const readCountKey = (channelId: string, messageId: bigint) => `${channelId}:${messageId}`;

/** The cached answer, fresh or not, without asking the server; undefined until there is one. */
export function peekReadCount(channelId: string, messageId: bigint): ReadCount | null | undefined {
  const entry = cache.get(readCountKey(channelId, messageId));
  if (!entry || (entry.pending && entry.fetchedAt === 0)) return undefined;
  return entry.value;
}

function send(batch: Batch) {
  const ids = [...batch.waiting.keys()];
  for (let i = 0; i < ids.length; i += READ_COUNT_BATCH_MAX) {
    const chunk = ids.slice(i, i + READ_COUNT_BATCH_MAX);
    void (async () => {
      let answers: Map<bigint, ReadCount> | null = null;
      try {
        const entries = await useApi().channelInsightsInteraction.GetReadCounts(batch.spaceId, batch.channelId, chunk);
        answers = new Map(entries.map((e) => [e.messageId, { readers: e.readers, members: e.members }]));
      } catch (e) {
        logger.warn("[ReadCount] GetReadCounts failed", e);
      }
      // A message left out of the answer has no count to show (TOO_FEW_MEMBERS among the reasons).
      for (const id of chunk) batch.waiting.get(id)?.(answers ? (answers.get(id) ?? null) : FAILED);
    })();
  }
}

function ask(spaceId: string, channelId: string, messageId: bigint): Promise<Answer> {
  const key = `${spaceId}:${channelId}`;
  let batch = batches.get(key);
  if (!batch) {
    const created: Batch = {
      spaceId,
      channelId,
      waiting: new Map(),
      timer: setTimeout(() => {
        batches.delete(key);
        send(created);
      }, READ_COUNT_BATCH_MS),
    };
    batch = created;
    batches.set(key, batch);
  }
  const target = batch;
  return new Promise((resolve) => target.waiting.set(messageId, resolve));
}

/**
 * The read count, from the cache while it is fresh; otherwise it joins the channel's next batch,
 * and everyone asking about the same message at the same time shares the answer. A refusal is
 * cached like an answer, so a message with no count is not asked about again on every hover; a
 * failed call keeps the last answer.
 */
export function fetchReadCount(
  spaceId: string,
  channelId: string,
  messageId: bigint,
  now: () => number = Date.now,
): Promise<ReadCount | null> {
  const key = readCountKey(channelId, messageId);
  const entry = cache.get(key);

  if (entry?.pending) return entry.pending;
  if (entry && now() - entry.fetchedAt < READ_COUNT_TTL_MS) return Promise.resolve(entry.value);

  const pending: Promise<ReadCount | null> = ask(spaceId, channelId, messageId).then((answer) => {
    const value = answer === FAILED ? (entry?.value ?? null) : answer;
    // Dropped by a session reset while waiting: nothing to keep for the next account.
    if (cache.get(key)?.pending === pending) cache.set(key, { value, fetchedAt: now(), pending: null });
    return value;
  });

  cache.set(key, { value: entry?.value ?? null, fetchedAt: entry?.fetchedAt ?? 0, pending });
  return pending;
}

/** Who sees the line: the author of the post, and anyone who may manage messages in the channel. */
export function canSeeReadCount(
  message: { sender: string; _optimistic?: true; _failed?: true },
  myUserId: string | null | undefined,
  canManageMessages: boolean,
): boolean {
  if (message._optimistic || message._failed) return false;
  return canManageMessages || (!!myUserId && message.sender === myUserId);
}

/** Forgets every answer, and answers whatever is still waiting with nothing. */
export function clearReadCountCache() {
  for (const batch of batches.values()) {
    clearTimeout(batch.timer);
    for (const resolve of batch.waiting.values()) resolve(null);
  }
  batches.clear();
  cache.clear();
}

// The next account sees other counts, if any.
onSessionReset(clearReadCountCache);
