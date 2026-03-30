import {
  ref,
  shallowRef,
  computed,
  nextTick,
  watch,
  onMounted,
  onUnmounted,
} from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import {
  ArgonMessage,
  EntityType,
  type IMessageEntity,
  type MessageEntityMention,
} from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useMe } from "@/store/auth/meStore";
import { useTone } from "@/store/media/toneStore";
import { logger } from "@argon/core";
import type { Subscription } from "rxjs";

const MESSAGES_PER_LOAD = 50;

export function useChatMessages(
  channelId: () => Guid,
  spaceId: () => Guid | undefined,
) {
  const api = useApi();
  const pool = usePoolStore();
  const me = useMe();
  const tone = useTone();

  const messages = shallowRef<ArgonMessage[]>([]);
  const hasReachedEnd = ref(false);
  const isLoading = ref(false);
  const isLoadingOlder = ref(false);
  const isRestoringScroll = ref(false);
  const newMessagesCount = ref(0);
  const isScrolledUp = ref(false);
  const subs = ref<Subscription | null>(null);

  const oldestMessageId = computed(() => {
    if (messages.value.length === 0) return null;
    return messages.value[0].messageId;
  });

  const filterMention = (e: IMessageEntity): e is MessageEntityMention => {
    return e.type === EntityType.Mention;
  };

  const loadOlderMessages = async (onPrepend: (count: number) => void) => {
    if (isLoadingOlder.value || hasReachedEnd.value || !spaceId() || isRestoringScroll.value) return;

    isLoadingOlder.value = true;
    isRestoringScroll.value = true;

    try {
      const fromId = oldestMessageId.value;
      if (!fromId) {
        hasReachedEnd.value = true;
        return;
      }

      const cachedOlder = await pool.loadOlderCachedMessages(
        spaceId()!,
        channelId(),
        fromId,
        MESSAGES_PER_LOAD,
      );

      if (cachedOlder.length >= MESSAGES_PER_LOAD) {
        messages.value = [...cachedOlder, ...messages.value];
        onPrepend(cachedOlder.length);
        isLoadingOlder.value = false;
        setTimeout(() => { isRestoringScroll.value = false; }, 200);
        return;
      }

      const olderMessages = await api.channelInteraction.QueryMessages(
        spaceId()!,
        channelId(),
        fromId,
        MESSAGES_PER_LOAD,
      );

      if (!olderMessages || olderMessages.length === 0) {
        hasReachedEnd.value = true;
        return;
      }

      await pool.cacheMessages(olderMessages);

      const sortedOlder = [...olderMessages].sort(
        (a, b) => Number(a.messageId - b.messageId),
      );

      messages.value = [...sortedOlder, ...messages.value];
      onPrepend(sortedOlder.length);

      if (olderMessages.length < MESSAGES_PER_LOAD) {
        hasReachedEnd.value = true;
      }
    } catch (error) {
      logger.error("Failed to load older messages:", error);
    } finally {
      isLoadingOlder.value = false;
      setTimeout(() => { isRestoringScroll.value = false; }, 200);
    }
  };

  const loadInitialMessages = async (onLoaded: () => void) => {
    if (!spaceId()) return;

    isLoading.value = true;
    messages.value = [];
    hasReachedEnd.value = false;
    newMessagesCount.value = 0;
    isScrolledUp.value = false;

    try {
      const cachedMessages = await pool.loadCachedMessages(spaceId()!, channelId());

      if (cachedMessages.length > 0) {
        messages.value = cachedMessages;
        await nextTick();
        setTimeout(onLoaded, 100);
      }

      const initialMessages = await api.channelInteraction.QueryMessages(
        spaceId()!,
        channelId(),
        null,
        MESSAGES_PER_LOAD,
      );

      if (initialMessages && initialMessages.length > 0) {
        await pool.cacheMessages(initialMessages);

        messages.value = [...initialMessages].sort(
          (a, b) => Number(a.messageId - b.messageId),
        );

        if (initialMessages.length < MESSAGES_PER_LOAD) {
          hasReachedEnd.value = true;
        }

        await nextTick();
        setTimeout(onLoaded, 100);
      } else if (cachedMessages.length === 0) {
        await nextTick();
      }
    } catch (error) {
      logger.error("Failed to load initial messages:", error);
    } finally {
      isLoading.value = false;
    }
  };

  const subscribeToNewMessages = (
    chId: Guid,
    onNewMessage: () => void,
  ) => {
    subs.value?.unsubscribe();

    subs.value = pool.onNewMessageReceived.subscribe(async (e) => {
      if (chId === e.channelId) {
        await pool.cacheMessage(e);
        messages.value = [...messages.value, e];

        if (e.entities.filter(filterMention).find((x) => x.userId === me.me?.userId)) {
          tone.playNotificationSound();
        }

        if (e.sender === me.me?.userId) {
          nextTick(onNewMessage);
        } else if (isScrolledUp.value) {
          newMessagesCount.value++;
        } else {
          nextTick(onNewMessage);
        }
      }
    });
  };

  const getMessageById = (messageId: bigint | null): ArgonMessage => {
    return messages.value.find((x) => x.messageId === (messageId ?? 0n)) ?? ({} as ArgonMessage);
  };

  const cleanup = () => {
    subs.value?.unsubscribe();
  };

  return {
    messages,
    hasReachedEnd,
    isLoading,
    isLoadingOlder,
    isRestoringScroll,
    newMessagesCount,
    isScrolledUp,
    loadOlderMessages,
    loadInitialMessages,
    subscribeToNewMessages,
    getMessageById,
    cleanup,
  };
}
