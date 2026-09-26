import { logger } from "@argon/core";
import { useApi } from "@/store/system/apiStore";

/**
 * "Read by N" under announcements. Fetched lazily (when the line scrolls into view or is hovered)
 * and kept for a short while, so a list of announcements costs one call per message at most every
 * {@link READ_COUNT_TTL_MS}.
 */

export interface ReadCount {
  readers: number;
  members: number;
}

export const READ_COUNT_TTL_MS = 30_000;

interface Entry {
  /** Null when the server refused: no permission, gone, or not an announcement. */
  value: ReadCount | null;
  fetchedAt: number;
  pending: Promise<ReadCount | null> | null;
}

const cache = new Map<string, Entry>();

export const readCountKey = (channelId: string, messageId: bigint) => `${channelId}:${messageId}`;

/** The cached answer, fresh or not, without asking the server. */
export function peekReadCount(channelId: string, messageId: bigint): ReadCount | null | undefined {
  return cache.get(readCountKey(channelId, messageId))?.value;
}

/**
 * The read count, from the cache while it is fresh; otherwise one request, shared by everyone
 * asking at the same time. A failure is cached like an answer, so a refused message is not asked
 * about again on every hover.
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

  const pending = (async (): Promise<ReadCount | null> => {
    try {
      const result = await useApi().channelInsightsInteraction.GetReadCount(spaceId, channelId, messageId);
      return result.isSuccessReadCount() ? { readers: result.readers, members: result.members } : null;
    } catch (e) {
      logger.warn("[ReadCount] GetReadCount failed", e);
      return entry?.value ?? null;
    }
  })();

  cache.set(key, { value: entry?.value ?? null, fetchedAt: entry?.fetchedAt ?? 0, pending });

  return pending.then((value) => {
    cache.set(key, { value, fetchedAt: now(), pending: null });
    return value;
  });
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

/** For tests. */
export function clearReadCountCache() {
  cache.clear();
}
