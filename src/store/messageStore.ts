import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { db } from "./db/dexie";
import { type ArgonMessage } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

/**
 * Store for managing messages and their caching
 */
export const useMessageStore = defineStore("message", () => {
  /**
   * Load cached messages from Dexie for a specific channel
   */
  const loadCachedMessages = async (
    spaceId: Guid,
    channelId: Guid
  ): Promise<ArgonMessage[]> => {
    try {
      const messages = await db.messages
        .where("[spaceId+channelId+messageId]")
        .between(
          [spaceId, channelId, 0],
          [spaceId, channelId, Number.MAX_SAFE_INTEGER]
        )
        .toArray();

      return messages;
    } catch (error) {
      logger.error("Failed to load cached messages:", error);
      return [];
    }
  };

  /**
   * Load older cached messages from Dexie (for pagination/scroll up)
   */
  const loadOlderCachedMessages = async (
    spaceId: Guid,
    channelId: Guid,
    beforeMessageId: bigint,
    limit: number
  ): Promise<ArgonMessage[]> => {
    try {
      const messages = await db.messages
        .where("[spaceId+channelId+messageId]")
        .between(
          [spaceId, channelId, 0],
          [spaceId, channelId, Number(beforeMessageId)]
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

  /**
   * Cache multiple messages to Dexie
   */
  const cacheMessages = async (messages: ArgonMessage[]): Promise<void> => {
    try {
      if (messages.length === 0) return;
      await db.messages.bulkPut(messages);
    } catch (error) {
      logger.error("Failed to cache messages:", error);
    }
  };

  /**
   * Cache a single message to Dexie
   */
  const cacheMessage = async (message: ArgonMessage): Promise<void> => {
    try {
      await db.messages.put(message);
    } catch (error) {
      logger.error("Failed to cache message:", error);
    }
  };

  /**
   * Get message by ID from cache
   */
  const getMessageById = async (messageId: bigint): Promise<ArgonMessage | undefined> => {
    try {
      return await db.messages.where("messageId").equals(Number(messageId)).first();
    } catch (error) {
      logger.error("Failed to get message by ID:", error);
      return undefined;
    }
  };

  /**
   * Delete all messages for a specific channel (useful for cleanup)
   */
  const clearChannelMessages = async (
    spaceId: Guid,
    channelId: Guid
  ): Promise<void> => {
    try {
      await db.messages
        .where("[spaceId+channelId+messageId]")
        .between(
          [spaceId, channelId, 0],
          [spaceId, channelId, Number.MAX_SAFE_INTEGER]
        )
        .delete();
    } catch (error) {
      logger.error("Failed to clear channel messages:", error);
    }
  };

  /**
   * Get message count for a channel
   */
  const getChannelMessageCount = async (
    spaceId: Guid,
    channelId: Guid
  ): Promise<number> => {
    try {
      return await db.messages
        .where("[spaceId+channelId+messageId]")
        .between(
          [spaceId, channelId, 0],
          [spaceId, channelId, Number.MAX_SAFE_INTEGER]
        )
        .count();
    } catch (error) {
      logger.error("Failed to get message count:", error);
      return 0;
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
  };
});
