import { logger } from "@argon/core";
import { liveQuery, type Subscription } from "dexie";
import { defineStore } from "pinia";
import { Subject } from "rxjs";
import { type Ref, onUnmounted, ref, watch, reactive } from "vue";
import { db } from "./db/dexie";
import { type ArgonChannel, ChannelType } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

/**
 * Store for managing channels
 */
export const useChannelStore = defineStore("channel", () => {
  const selectedChannel = ref<Guid | null>(null);
  const selectedTextChannel = ref<Guid | null>(null);
  
  const onChannelChanged = new Subject<Guid | null>();

  // Diagnostics
  const diagnostics = reactive({
    totalQueriesExecuted: 0,
    slowQueries: [] as { operation: string; duration: number; timestamp: number }[],
    maxSlowQueries: 50,
    criticalQueries: 0,
    errorCount: 0,
    activeSubscriptions: 0,
  });

  /**
   * Get diagnostics info
   */
  const getDiagnostics = () => ({
    totalQueriesExecuted: diagnostics.totalQueriesExecuted,
    slowQueries: diagnostics.slowQueries,
    criticalQueries: diagnostics.criticalQueries,
    errorCount: diagnostics.errorCount,
    activeSubscriptions: diagnostics.activeSubscriptions,
  });

  /**
   * Log slow query
   */
  const logSlowQuery = (operation: string, duration: number) => {
    if (duration > 100) {
      logger.warn(`[ChannelStore] Slow query: ${operation} took ${duration}ms`);
      diagnostics.slowQueries.push({ operation, duration, timestamp: Date.now() });
      if (diagnostics.slowQueries.length > diagnostics.maxSlowQueries) {
        diagnostics.slowQueries.shift();
      }
      
      if (duration > 1000) {
        diagnostics.criticalQueries++;
      }
    }
  };

  /**
   * Periodic diagnostics logging
   */
  if (typeof window !== 'undefined') {
    setInterval(() => {
      if (diagnostics.activeSubscriptions > 20) {
        logger.warn(`[ChannelStore] High subscription count: ${diagnostics.activeSubscriptions} active subscriptions`);
      }
    }, 30000);
  }

  watch(selectedTextChannel, (newChannelId, oldChannelId) => {
    if (newChannelId !== oldChannelId) {
      onChannelChanged.next(newChannelId);
    }
  });

  /**
   * Get channel by ID
   */
  const getChannel = async (channelId: Guid): Promise<ArgonChannel | undefined> => {
    const startTime = performance.now();
    diagnostics.totalQueriesExecuted++;

    const result = await db.channels.get(channelId);
    const duration = performance.now() - startTime;
    logSlowQuery(`getChannel(${channelId})`, duration);

    return result;
  };

  /**
   * Get all server channels
   */
  function useActiveServerChannels(spaceId: Ref<Guid | null>) {
    const result = ref<ArgonChannel[]>([]);
    let sub: Subscription | null = null;

    const updateChannels = (id: Guid | null) => {
      if (sub) {
        sub.unsubscribe();
        diagnostics.activeSubscriptions--;
      }
      if (!id) {
        result.value = [];
        return;
      }

      diagnostics.activeSubscriptions++;
      const startTime = performance.now();

      sub = liveQuery(() =>
        db.channels.where("spaceId").equals(id).toArray()
      ).subscribe({
        next: (channels) => {
          const duration = performance.now() - startTime;
          logSlowQuery(`liveQuery.useActiveServerChannels(${id})`, duration);
          result.value = channels;
        },
        error: (err) => {
          diagnostics.errorCount++;
          logger.error("[ChannelStore] Error in liveQuery subscription:", err);
          result.value = [];
        }
      });
    };

    watch(spaceId, updateChannels, { immediate: true });

    onUnmounted(() => {
      if (sub) {
        sub.unsubscribe();
        diagnostics.activeSubscriptions--;
      }
    });

    return result;
  }

  /**
   * Add/update channel in DB
   */
  const trackChannel = async (channel: ArgonChannel) => {
    await db.channels.put(channel, channel.channelId);
  };

  /**
   * Remove channel
   */
  const removeChannel = async (channelId: Guid) => {
    await db.channels.delete(channelId);
  };

  /**
   * Select first text channel of server
   */
  const selectFirstTextChannel = async (serverId: Guid) => {
    const channels = await db.channels
      .where("spaceId")
      .equals(serverId)
      .filter((c) => c.type === ChannelType.Text)
      .toArray();

    if (channels.length > 0 && !selectedTextChannel.value) {
      selectedTextChannel.value = channels[0].channelId;
    }
  };

  /**
   * Remove stale channels (pruning)
   */
  const pruneChannels = async (serverId: Guid, activeChannelIds: Guid[]) => {
    const prunedCount = await db.channels
      .where("channelId")
      .noneOf(activeChannelIds)
      .and((q) => q.spaceId === serverId)
      .delete();

    if (prunedCount !== 0) {
      logger.warn(`Pruned ${prunedCount} channels`);
    }

    return prunedCount;
  };

  return {
    selectedChannel,
    selectedTextChannel,
    onChannelChanged,
    getChannel,
    useActiveServerChannels,
    trackChannel,
    removeChannel,
    selectFirstTextChannel,
    pruneChannels,
    // Diagnostics
    getDiagnostics,
  };
});
