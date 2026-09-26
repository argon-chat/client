import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { db, toStoredMessage } from "@/store/db/dexie";
import { type ArgonMessage, type ReactionInfo } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

/**
 * Store for managing messages and their caching.
 * Messages are stored with a numeric _msgId (Number(messageId)) because
 * IndexedDB keys don't support bigint.
 */
export const useMessageStore = defineStore("message", () => {
  const loadCachedMessages = async (
    spaceId: Guid,
    channelId: Guid,
    limit: number = 50
  ): Promise<ArgonMessage[]> => {
    try {
      const messages = await db.messages
        .where("[spaceId+channelId+_msgId]")
        .between(
          [spaceId, channelId, 0],
          [spaceId, channelId, Infinity]
        )
        .reverse()
        .limit(limit)
        .toArray();

      return messages.reverse();
    } catch (error) {
      logger.error("Failed to load cached messages:", error);
      return [];
    }
  };

  const loadOlderCachedMessages = async (
    spaceId: Guid,
    channelId: Guid,
    beforeMessageId: bigint,
    limit: number
  ): Promise<ArgonMessage[]> => {
    try {
      const messages = await db.messages
        .where("[spaceId+channelId+_msgId]")
        .between(
          [spaceId, channelId, 0],
          [spaceId, channelId, Number(beforeMessageId)],
          false,
          false
        )
        .reverse()
        .limit(limit)
        .toArray();

      return messages.reverse();
    } catch (error) {
      logger.error("Failed to load older cached messages:", error);
      return [];
    }
  };

  const cacheMessages = async (messages: ArgonMessage[]): Promise<void> => {
    try {
      if (messages.length === 0) return;
      await db.messages.bulkPut(messages.map(toStoredMessage));
    } catch (error) {
      logger.error("Failed to cache messages:", error);
    }
  };

  /**
   * Makes the cache agree with a page of history the server just returned, and caches the page.
   *
   * MessageDeleted and MessageUpdated reach only the channel's current viewers, so a cached row can
   * outlive the message or keep its old text. The page is the truth for the ids it spans: from its
   * oldest message (or the channel's start, when `reachedStart`) up to `before`, exclusive, or
   * without an upper bound for the newest page (`before` null). Cached rows in that span the server
   * did not return are deleted; the returned ones overwrite theirs. `keep`: ids that arrived live
   * while the page was on its way, which the page could not have known about.
   *
   * @returns the ids deleted from the cache
   */
  const reconcileMessages = async (
    spaceId: Guid,
    channelId: Guid,
    page: readonly ArgonMessage[],
    span: { before: bigint | null; reachedStart: boolean; keep?: ReadonlySet<bigint> },
  ): Promise<bigint[]> => {
    let lower: bigint | null = null;
    if (!span.reachedStart) {
      if (page.length === 0) return [];
      lower = page.reduce((min, m) => (m.messageId < min ? m.messageId : min), page[0].messageId);
    }
    const upper = span.before;
    const returned = new Set(page.map((m) => m.messageId));
    // `_msgId` is a rounded Number: the key range is widened by the rounding, the exact bigint
    // bounds are checked per row.
    const inSpan = (id: bigint) => (lower === null || id >= lower) && (upper === null || id < upper);

    try {
      return await db.transaction("rw", db.messages, async () => {
        const rows = await db.messages
          .where("[spaceId+channelId+_msgId]")
          .between(
            [spaceId, channelId, lower === null ? -Infinity : Number(lower)],
            [spaceId, channelId, upper === null ? Infinity : Number(upper)],
            true,
            true,
          )
          .toArray();
        const gone = rows.filter(
          (r) => inSpan(r.messageId) && !returned.has(r.messageId) && !span.keep?.has(r.messageId),
        );
        if (gone.length) await db.messages.bulkDelete(gone.map((r) => r._msgId));
        if (page.length) await db.messages.bulkPut(page.map(toStoredMessage));
        return gone.map((r) => r.messageId);
      });
    } catch (error) {
      logger.error("Failed to reconcile cached messages:", error);
      return [];
    }
  };

  const cacheMessage = async (message: ArgonMessage): Promise<void> => {
    try {
      await db.messages.put(toStoredMessage(message));
    } catch (error) {
      logger.error("Failed to cache message:", error);
    }
  };

  const removeCachedMessage = async (messageId: bigint): Promise<void> => {
    try {
      await db.messages.delete(Number(messageId));
    } catch (error) {
      logger.error("Failed to remove cached message:", error);
    }
  };

  const getMessageById = async (messageId: bigint): Promise<ArgonMessage | undefined> => {
    try {
      return await db.messages.get(Number(messageId));
    } catch (error) {
      logger.error("Failed to get message by ID:", error);
      return undefined;
    }
  };

  const clearChannelMessages = async (
    spaceId: Guid,
    channelId: Guid
  ): Promise<void> => {
    try {
      await db.messages
        .where("[spaceId+channelId+_msgId]")
        .between(
          [spaceId, channelId, 0],
          [spaceId, channelId, Infinity]
        )
        .delete();
    } catch (error) {
      logger.error("Failed to clear channel messages:", error);
    }
  };

  const getChannelMessageCount = async (
    spaceId: Guid,
    channelId: Guid
  ): Promise<number> => {
    try {
      return await db.messages
        .where("[spaceId+channelId+_msgId]")
        .between(
          [spaceId, channelId, 0],
          [spaceId, channelId, Infinity]
        )
        .count();
    } catch (error) {
      logger.error("Failed to get message count:", error);
      return 0;
    }
  };

  const updateMessageReactions = async (
    messageId: bigint,
    updater: (reactions: ReactionInfo[]) => ReactionInfo[],
  ): Promise<void> => {
    try {
      await db.messages
        .where("_msgId")
        .equals(Number(messageId))
        .modify((msg: any) => {
          msg.reactions = updater(msg.reactions ?? []);
        });
    } catch (error) {
      logger.error("Failed to update message reactions:", error);
    }
  };

  return {
    loadCachedMessages,
    loadOlderCachedMessages,
    cacheMessages,
    reconcileMessages,
    cacheMessage,
    removeCachedMessage,
    getMessageById,
    clearChannelMessages,
    getChannelMessageCount,
    updateMessageReactions,
  };
});
