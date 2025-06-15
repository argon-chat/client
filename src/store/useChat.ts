import { ref } from "vue";
import { db } from "@/store/db/dexie";
import Dexie from "dexie";
import { useApi } from "./apiStore";
import { logger } from "@/lib/logger";
import { usePoolStore } from "./poolStore";

const PAGE_SIZE = 30;

export function useChat(channelId: string) {
  const messages = ref<IArgonMessage[]>([]);
  const isLoading = ref(false);
  const hasMore = ref(true);
  const lastLoadedMessageId = ref<number | null>(null);
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
      lastLoadedMessageId.value = local[0].MessageId;
    }
    await loadOlderMessages(totalRequested);
  }

  async function loadOlderMessages(totalRequestedParam?: number) {
    if (isLoading.value || !hasMore.value) return;
    const totalRequested = totalRequestedParam ?? PAGE_SIZE;
    isLoading.value = true;

    const before = lastLoadedMessageId.value;

    try {
      const data = await api.serverInteraction.GetMessages(
        channelId,
        totalRequested,
        before ?? 0,
      );

      logger.log("Received messages", data);

      if (!data || data.length === 0) {
        hasMore.value = false;
        return;
      }

      await db.messages.bulkPut(data);
      messages.value = [...data, ...messages.value];
      lastLoadedMessageId.value = data[0].MessageId;
    } finally {
      isLoading.value = false;
    }
  }

  function addNewMessage(message: IArgonMessage) {
    if (message.ChannelId !== channelId) return;

    const exists = messages.value.some(
      (m) => m.MessageId === message.MessageId,
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
