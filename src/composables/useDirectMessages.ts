import {
  ref,
  shallowRef,
  triggerRef,
  computed,
  nextTick,
} from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import {
  type ArgonMessage,
  type DirectMessage,
  type DirectMessageSent,
  EntityType,
  type IMessageEntity,
  type MessageEntityMention,
} from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useMe } from "@/store/auth/meStore";
import { useTone } from "@/store/media/toneStore";
import { useNotificationStore } from "@/store/data/notificationStore";
import { useRecentChatsStore } from "@/store/chat/useRecentChatsStore";
import { useBus } from "@/store/realtime/busStore";
import { logger } from "@argon/core";
import type { Subscription } from "rxjs";
import type { ChatMessage } from "./useChatMessages";

const MESSAGES_PER_LOAD = 50;
const OPTIMISTIC_TIMEOUT_MS = 30_000;

/**
 * Convert a DirectMessage into a ChatMessage (ArgonMessage-compatible shape).
 * peerId is used as channelId for DM context.
 */
function dmToChatMessage(dm: DirectMessage, peerId: Guid): ChatMessage {
  return {
    messageId: dm.messageId,
    replyId: dm.replyTo,
    channelId: peerId,
    spaceId: "",
    timeSent: dm.createdAt,
    sender: dm.senderId,
    text: dm.text,
    entities: dm.entities,
    version: 1,
    controls: [],
    reactions: []
  } as ChatMessage;
}

export function useDirectMessages(peerId: () => Guid) {
  const api = useApi();
  const pool = usePoolStore();
  const me = useMe();
  const tone = useTone();
  const ntf = useNotificationStore();
  const recentChats = useRecentChatsStore();
  const bus = useBus();

  const messages = shallowRef<ChatMessage[]>([]);
  const hasReachedEnd = ref(false);
  const isLoading = ref(false);
  const isLoadingOlder = ref(false);
  const isRestoringScroll = ref(false);
  const newMessagesCount = ref(0);
  const isScrolledUp = ref(false);
  const subs = ref<Subscription | null>(null);

  const optimisticRandomIds = new Set<bigint>();
  const resolvedMessageIds = new Set<bigint>();
  const optimisticTimers = new Map<bigint, ReturnType<typeof setTimeout>>();
  const messageIdSet = new Set<bigint>();

  // Batch incoming messages to avoid multiple array rebuilds per frame
  let pendingIncoming: { msg: ChatMessage; onNewMessage: () => void }[] = [];
  let batchFlushScheduled = false;

  const flushPendingMessages = () => {
    batchFlushScheduled = false;
    if (pendingIncoming.length === 0) return;

    const batch = pendingIncoming.splice(0);
    const newMsgs = batch.map((b) => b.msg);
    for (const m of newMsgs) messageIdSet.add(m.messageId);
    messages.value.push(...newMsgs);
    triggerRef(messages);

    const lastEntry = batch[batch.length - 1];
    const lastMsg = lastEntry.msg;
    if (lastMsg.sender === me.me?.userId) {
      nextTick(lastEntry.onNewMessage);
    } else if (isScrolledUp.value) {
      newMessagesCount.value += batch.filter((b) => b.msg.sender !== me.me?.userId).length;
    } else {
      nextTick(lastEntry.onNewMessage);
    }
  };

  const queueIncomingMessage = (msg: ChatMessage, onNewMessage: () => void) => {
    pendingIncoming.push({ msg, onNewMessage });
    if (!batchFlushScheduled) {
      batchFlushScheduled = true;
      requestAnimationFrame(flushPendingMessages);
    }
  };

  const oldestMessageId = computed(() => {
    if (messages.value.length === 0) return null;
    return messages.value[0].messageId;
  });

  const filterMention = (e: IMessageEntity): e is MessageEntityMention => {
    return e.type === EntityType.Mention;
  };

  // ────────────────────────────────────────────
  // Loading
  // ────────────────────────────────────────────

  const loadOlderMessages = async (onPrepend: (count: number) => void) => {
    if (isLoadingOlder.value || hasReachedEnd.value || isRestoringScroll.value) return;

    isLoadingOlder.value = true;
    isRestoringScroll.value = true;

    try {
      const fromId = oldestMessageId.value;
      if (!fromId) {
        hasReachedEnd.value = true;
        return;
      }

      const olderMessages = await api.userChatInteractions.QueryDirectMessages(
        peerId(),
        fromId,
        MESSAGES_PER_LOAD,
      );

      if (!olderMessages || olderMessages.length === 0) {
        hasReachedEnd.value = true;
        return;
      }

      // Preload senders
      const uniqueSenderIds = [...new Set(olderMessages.map((m) => m.senderId))];
      if (uniqueSenderIds.length > 0) {
        await pool.getUsersBatch(uniqueSenderIds);
      }

      const sorted = [...olderMessages]
        .sort((a, b) => Number(a.messageId - b.messageId))
        .map((dm) => dmToChatMessage(dm, peerId()));

      for (const m of sorted) messageIdSet.add(m.messageId);
      messages.value.unshift(...sorted);
      triggerRef(messages);
      onPrepend(sorted.length);

      if (olderMessages.length < MESSAGES_PER_LOAD) {
        hasReachedEnd.value = true;
      }
    } catch (error) {
      logger.error("Failed to load older DM messages:", error);
    } finally {
      isLoadingOlder.value = false;
      nextTick(() => {
        requestAnimationFrame(() => {
          isRestoringScroll.value = false;
        });
      });
    }
  };

  const loadInitialMessages = async (onLoaded: () => void) => {
    isLoading.value = true;
    hasReachedEnd.value = false;
    newMessagesCount.value = 0;
    isScrolledUp.value = false;

    try {
      messageIdSet.clear();
      messages.value = [];

      const initialMessages = await api.userChatInteractions.QueryDirectMessages(
        peerId(),
        null,
        MESSAGES_PER_LOAD,
      );

      if (initialMessages && initialMessages.length > 0) {
        const uniqueSenderIds = [...new Set(initialMessages.map((m) => m.senderId))];
        if (uniqueSenderIds.length > 0) {
          await pool.getUsersBatch(uniqueSenderIds);
        }

        const sorted = [...initialMessages]
          .sort((a, b) => Number(a.messageId - b.messageId))
          .map((dm) => dmToChatMessage(dm, peerId()));

        for (const m of sorted) messageIdSet.add(m.messageId);
        messages.value = sorted;

        if (initialMessages.length < MESSAGES_PER_LOAD) {
          hasReachedEnd.value = true;
        }

        await nextTick();
        onLoaded();
      } else {
        await nextTick();
      }
    } catch (error) {
      logger.error("Failed to load initial DM messages:", error);
    } finally {
      isLoading.value = false;
    }
  };

  // ────────────────────────────────────────────
  // Realtime subscription
  // ────────────────────────────────────────────

  const subscribeToNewMessages = (
    targetPeerId: Guid,
    onNewMessage: () => void,
  ) => {
    subs.value?.unsubscribe();
    pendingIncoming = [];
    batchFlushScheduled = false;

    subs.value = bus.onServerEvent<DirectMessageSent>("DirectMessageSent", (e: DirectMessageSent) => {
      // Only handle messages for this conversation
      if (e.senderId !== targetPeerId && e.receiverId !== targetPeerId) return;

      const msg = dmToChatMessage(e.message, targetPeerId);

      // If we already resolved this message via readback, update with server data
      if (resolvedMessageIds.has(msg.messageId)) {
        resolvedMessageIds.delete(msg.messageId);
        const idx = messages.value.findIndex((m) => m.messageId === msg.messageId);
        if (idx !== -1) {
          messages.value[idx] = msg;
          triggerRef(messages);
        }
        return;
      }

      // Duplicate guard
      if (messageIdSet.has(msg.messageId)) return;

      // WS event for our own message (arrived before readback)
      if (e.message.senderId === me.me?.userId && optimisticRandomIds.size > 0) {
        const optIdx = messages.value.findIndex((m) => m._optimistic && !m._failed);
        if (optIdx !== -1) {
          const optMsg = messages.value[optIdx] as ChatMessage;
          const randomId = optMsg._randomId!;
          const timer = optimisticTimers.get(randomId);
          if (timer) { clearTimeout(timer); optimisticTimers.delete(randomId); }
          optimisticRandomIds.delete(randomId);
          messageIdSet.delete(optMsg.messageId);
          messageIdSet.add(msg.messageId);
          messages.value[optIdx] = msg;
          triggerRef(messages);
          resolvedMessageIds.add(msg.messageId);
          setTimeout(() => resolvedMessageIds.delete(msg.messageId), 10_000);
          return;
        }
      }

      // Play mention sound
      if (msg.entities?.filter(filterMention).find((x) => x.userId === me.me?.userId)) {
        tone.playNotificationSound();
      }

      // Mark read when at bottom
      if (!isScrolledUp.value) {
        recentChats.markRead(targetPeerId);
        ntf.decrementDmUnread();
      }

      queueIncomingMessage(msg, onNewMessage);
    });
  };

  // ────────────────────────────────────────────
  // Optimistic message management
  // ────────────────────────────────────────────

  const addOptimisticMessage = (msg: ArgonMessage, randomId: bigint) => {
    const optimistic: ChatMessage = { ...msg, _optimistic: true, _randomId: randomId };
    optimisticRandomIds.add(randomId);
    messageIdSet.add(optimistic.messageId);
    messages.value.push(optimistic);
    triggerRef(messages);

    const timer = setTimeout(() => {
      if (optimisticRandomIds.has(randomId)) {
        markOptimisticFailed(randomId, "Message sending timed out");
      }
    }, OPTIMISTIC_TIMEOUT_MS);
    optimisticTimers.set(randomId, timer);
  };

  const resolveOptimisticMessage = async (
    randomId: bigint,
    readback: { messageId: bigint },
  ) => {
    if (!optimisticRandomIds.has(randomId)) return;

    const timer = optimisticTimers.get(randomId);
    if (timer) {
      clearTimeout(timer);
      optimisticTimers.delete(randomId);
    }

    const idx = messages.value.findIndex(
      (m) => m._optimistic && m.messageId === randomId,
    );

    if (idx !== -1) {
      const { _optimistic, _randomId, _failed, _error, ...rest } = messages.value[idx];
      const confirmed: ChatMessage = { ...rest, messageId: readback.messageId };
      messageIdSet.delete(messages.value[idx].messageId);
      messageIdSet.add(readback.messageId);
      messages.value[idx] = confirmed;
      triggerRef(messages);
    }

    optimisticRandomIds.delete(randomId);
    resolvedMessageIds.add(readback.messageId);
    setTimeout(() => resolvedMessageIds.delete(readback.messageId), 10_000);
  };

  const removeOptimisticMessage = (randomId: bigint) => {
    const timer = optimisticTimers.get(randomId);
    if (timer) {
      clearTimeout(timer);
      optimisticTimers.delete(randomId);
    }
    optimisticRandomIds.delete(randomId);
    const idx = messages.value.findIndex(
      (m) => m._optimistic && m.messageId === randomId,
    );
    if (idx !== -1) {
      messageIdSet.delete(messages.value[idx].messageId);
      messages.value.splice(idx, 1);
      triggerRef(messages);
    }
  };

  const markOptimisticFailed = (randomId: bigint, error: string) => {
    const timer = optimisticTimers.get(randomId);
    if (timer) {
      clearTimeout(timer);
      optimisticTimers.delete(randomId);
    }

    const idx = messages.value.findIndex(
      (m) => m._optimistic && m.messageId === randomId,
    );
    if (idx !== -1) {
      messages.value[idx] = { ...messages.value[idx], _failed: true, _error: error };
      triggerRef(messages);
    }
  };

  const retryMessage = async (failedMsg: ChatMessage) => {
    const oldRandomId = failedMsg._randomId;
    if (!oldRandomId) return;

    removeOptimisticMessage(oldRandomId);

    const newRandomId = crypto.getRandomValues(new BigUint64Array(1))[0] & 0x7FFFFFFFFFFFFFFFn;

    const { _failed, _error, _optimistic, _randomId, ...rest } = failedMsg;
    const retryMsg: ArgonMessage = {
      ...rest,
      messageId: newRandomId,
      timeSent: { date: new Date(), offsetMinutes: 0 },
    };
    addOptimisticMessage(retryMsg, newRandomId);

    try {
      const retryEntities = (failedMsg.entities ?? []).filter(
        (e) => e.type !== EntityType.Attachment,
      );

      const realMessageId = await api.userChatInteractions.SendDirectMessage(
        peerId(),
        failedMsg.text ?? "",
        retryEntities,
        newRandomId,
        failedMsg.replyId ?? null,
      );

      await resolveOptimisticMessage(newRandomId, { messageId: realMessageId });
    } catch (e: any) {
      logger.error("DM retry failed:", e);
      markOptimisticFailed(newRandomId, e?.message ?? "Retry failed");
    }
  };

  const getMessageById = (messageId: bigint | null): ArgonMessage => {
    return messages.value.find((x) => x.messageId === (messageId ?? 0n)) ?? ({} as ArgonMessage);
  };

  const cleanup = () => {
    subs.value?.unsubscribe();
    for (const timer of optimisticTimers.values()) {
      clearTimeout(timer);
    }
    optimisticTimers.clear();
    optimisticRandomIds.clear();
    resolvedMessageIds.clear();
    messageIdSet.clear();
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
    addOptimisticMessage,
    resolveOptimisticMessage,
    removeOptimisticMessage,
    markOptimisticFailed,
    retryMessage,
    cleanup,
  };
}
