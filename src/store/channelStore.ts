import { logger } from "@/lib/logger";
import { useObservable } from "@vueuse/rxjs";
import { liveQuery, type Subscription } from "dexie";
import { defineStore } from "pinia";
import { Subject, from } from "rxjs";
import { type Ref, computed, onUnmounted, ref, watch } from "vue";
import { db } from "./db/dexie";
import { type ArgonChannel, ChannelType } from "@/lib/glue/argonChat";
import type { Guid } from "@argon-chat/ion.webcore";

/**
 * Store for managing channels
 */
export const useChannelStore = defineStore("channel", () => {
  const selectedChannel = ref<Guid | null>(null);
  const selectedTextChannel = ref<Guid | null>(null);
  
  const onChannelChanged = new Subject<Guid | null>();

  watch(selectedTextChannel, (newChannelId, oldChannelId) => {
    if (newChannelId !== oldChannelId) {
      onChannelChanged.next(newChannelId);
    }
  });

  /**
   * Get channel by ID
   */
  const getChannel = async (channelId: Guid): Promise<ArgonChannel | undefined> => {
    return await db.channels.where("channelId").equals(channelId).first();
  };

  /**
   * Get all server channels
   */
  function useActiveServerChannels(spaceId: Ref<Guid | null>) {
    const result = ref<ArgonChannel[]>([]);
    let sub: Subscription | null = null;

    watch(
      spaceId,
      (id) => {
        sub?.unsubscribe();
        if (!id) {
          result.value = [];
          return;
        }

        sub = liveQuery(() =>
          db.channels.where("spaceId").equals(id).toArray()
        ).subscribe((channels) => {
          result.value = channels;
        });
      },
      { immediate: true }
    );

    onUnmounted(() => sub?.unsubscribe());

    return result;
  }

  /**
   * Add/update channel in DB
   */
  const trackChannel = async (channel: ArgonChannel) => {
    const exist = await db.channels.get(channel.channelId);

    if (exist) {
      await db.channels.update(exist.channelId, channel);
      return;
    }
    
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
      .noneOf([...activeChannelIds])
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
  };
});
