import { ref } from "vue";
import { db } from "@/store/db/dexie";
import Dexie from "dexie";
import { useApi } from "./apiStore";
import { logger } from "@/lib/logger";
import { usePoolStore } from "./poolStore";
import { ArgonMessage } from "@/lib/glue/argonChat";
import { Guid } from "@argon-chat/ion.webcore";

const PAGE_SIZE = 30;

export function useChat(serverId: Guid, channelId: Guid) {
  const messages = ref<ArgonMessage[]>([]);
  const isLoading = ref(false);
  const hasMore = ref(true);
  const lastLoadedMessageId = ref<bigint | null>(null);
  const api = useApi();
  const pool = usePoolStore();

  async function loadInitial(totalRequestedParam?: number) {
    const totalRequested = totalRequestedParam ?? PAGE_SIZE;
    const local = await db.messages
      .where("[ChannelId+MessageId]")
      .between([channelId, Dexie.minKey], [channelId, Dexie.maxKey])
      .limit(totalRequested)
      .sortBy("MessageId");

    messages.value = local;
    if (local.length) {
      lastLoadedMessageId.value = local[0].messageId;
    }
    await loadOlderMessages(totalRequested);
  }

  async function loadOlderMessages(totalRequestedParam?: number) {
    if (isLoading.value || !hasMore.value) return;
    const totalRequested = totalRequestedParam ?? PAGE_SIZE;
    isLoading.value = true;

    const before = lastLoadedMessageId.value;

    try {
      const data = await api.channelInteraction.GetMessages(
        serverId,
        channelId,
        totalRequested,
        before ?? 0n,
      );

      logger.log("Received messages", data);

      if (!data || data.length === 0) {
        hasMore.value = false;
        return;
      }

      await db.messages.bulkPut(data);
      messages.value = [...data, ...messages.value];
      lastLoadedMessageId.value = data[0].messageId;
    } finally {
      isLoading.value = false;
    }
  }

  function addNewMessage(message: ArgonMessage) {
    if (message.channelId !== channelId) return;

    const exists = messages.value.some(
      (m) => m.messageId === message.messageId,
    );
    if (exists) return;

    messages.value = [...messages.value, message];
    db.messages.put(message);
  }
  pool.onNewMessageReceived.subscribe(addNewMessage);

  return {
    messages,
    loadOlderMessages,
    isLoading,
    hasMore,
    loadInitial,
  };
}
