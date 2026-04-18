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

  const cacheMessage = async (message: ArgonMessage): Promise<void> => {
    try {
      await db.messages.put(toStoredMessage(message));
    } catch (error) {
      logger.error("Failed to cache message:", error);
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
    cacheMessage,
    getMessageById,
    clearChannelMessages,
    getChannelMessageCount,
    updateMessageReactions,
  };
});
