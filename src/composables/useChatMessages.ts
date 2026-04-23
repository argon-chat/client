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
  EntityType,
  type IMessageEntity,
  type MessageEntityMention,
} from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useMe } from "@/store/auth/meStore";
import { useTone } from "@/store/media/toneStore";
import { useNotificationStore } from "@/store/data/notificationStore";
import { MuteLevelType } from "@argon/glue";
import { logger } from "@argon/core";
import type { Subscription } from "rxjs";

export type ChatMessage = ArgonMessage & {
  _optimistic?: true;
  _randomId?: bigint;
  _failed?: true;
  _error?: string;
};

const MESSAGES_PER_LOAD = 50;
const OPTIMISTIC_TIMEOUT_MS = 30_000;

export function useChatMessages(
  channelId: () => Guid,
  spaceId: () => Guid | undefined,
) {
  const api = useApi();
  const pool = usePoolStore();
  const me = useMe();
  const tone = useTone();
  const ntf = useNotificationStore();

  const messages = shallowRef<ChatMessage[]>([]);
  const hasReachedEnd = ref(false);
  const isLoading = ref(false);
  const isLoadingOlder = ref(false);
  const isRestoringScroll = ref(false);
  const newMessagesCount = ref(0);
  const isScrolledUp = ref(false);
  const subs = ref<Subscription | null>(null);

  // Maps randomId → optimistic message's randomId (used as messageId in the optimistic msg)
  const optimisticRandomIds = new Set<bigint>();
  // Set of real messageIds that have been resolved via SendMessageWithReadback
  // Used to skip the duplicate server event that arrives via WebSocket
  const resolvedMessageIds = new Set<bigint>();
  // Timers for orphaned optimistic cleanup
  const optimisticTimers = new Map<bigint, ReturnType<typeof setTimeout>>();

  // O(1) dedup: tracks all messageIds currently in the messages array
  const messageIdSet = new Set<bigint>();

  // Batch incoming messages to avoid multiple array rebuilds per frame
  let pendingIncoming: { msg: ArgonMessage; onNewMessage: () => void }[] = [];
  let batchFlushScheduled = false;

  const flushPendingMessages = () => {
    batchFlushScheduled = false;
    if (pendingIncoming.length === 0) return;

    const batch = pendingIncoming.splice(0);
    const newMsgs = batch.map((b) => b.msg);
    for (const m of newMsgs) messageIdSet.add(m.messageId);
    messages.value.push(...newMsgs);
    triggerRef(messages);

    // Handle scroll/notification for the last message in batch
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

  const queueIncomingMessage = (msg: ArgonMessage, onNewMessage: () => void) => {
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
        for (const m of cachedOlder) messageIdSet.add(m.messageId);
        messages.value.unshift(...cachedOlder);
        triggerRef(messages);
        onPrepend(cachedOlder.length);
        isLoadingOlder.value = false;
        nextTick(() => {
          requestAnimationFrame(() => { isRestoringScroll.value = false; });
        });
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

      for (const m of sortedOlder) messageIdSet.add(m.messageId);
      messages.value.unshift(...sortedOlder);
      triggerRef(messages);
      onPrepend(sortedOlder.length);

      if (olderMessages.length < MESSAGES_PER_LOAD) {
        hasReachedEnd.value = true;
      }
    } catch (error) {
      logger.error("Failed to load older messages:", error);
    } finally {
      isLoadingOlder.value = false;
      nextTick(() => {
        requestAnimationFrame(() => { isRestoringScroll.value = false; });
      });
    }
  };

  const loadInitialMessages = async (onLoaded: () => void) => {
    if (!spaceId()) return;

    isLoading.value = true;
    hasReachedEnd.value = false;
    newMessagesCount.value = 0;
    isScrolledUp.value = false;

    try {
      // Step 6: Load from cache first WITHOUT clearing — no flash
      const cachedMessages = await pool.loadCachedMessages(spaceId()!, channelId());

      if (cachedMessages.length > 0) {
        messageIdSet.clear();
        for (const m of cachedMessages) messageIdSet.add(m.messageId);
        messages.value = cachedMessages;
        await nextTick();
        onLoaded();
      } else {
        // No cache — clear old channel's messages
        messageIdSet.clear();
        messages.value = [];
      }

      const initialMessages = await api.channelInteraction.QueryMessages(
        spaceId()!,
        channelId(),
        null,
        MESSAGES_PER_LOAD,
      );

      if (initialMessages && initialMessages.length > 0) {
        await pool.cacheMessages(initialMessages);

        const sorted = [...initialMessages].sort(
          (a, b) => Number(a.messageId - b.messageId),
        );
        messageIdSet.clear();
        for (const m of sorted) messageIdSet.add(m.messageId);
        messages.value = sorted;

        if (initialMessages.length < MESSAGES_PER_LOAD) {
          hasReachedEnd.value = true;
        }

        await nextTick();
        onLoaded();
      } else if (cachedMessages.length === 0) {
        await nextTick();
      }
    } catch (error) {
      logger.error("Failed to load initial messages:", error);
    } finally {
      isLoading.value = false;
    }
  };

  // ────────────────────────────────────────────
  // Realtime subscription
  // ────────────────────────────────────────────

  const subscribeToNewMessages = (
    chId: Guid,
    onNewMessage: () => void,
  ) => {
    subs.value?.unsubscribe();
    pendingIncoming = [];
    batchFlushScheduled = false;

    subs.value = pool.onNewMessageReceived.subscribe(async (e) => {
      if (chId !== e.channelId) return;

      // Step 1: If we already resolved this message via readback,
      // replace our optimistic-turned-resolved message with real server data
      // (server data has real fileIds, sizes, content types for attachments)
      if (resolvedMessageIds.has(e.messageId)) {
        resolvedMessageIds.delete(e.messageId);
        const idx = messages.value.findIndex((m) => m.messageId === e.messageId);
        if (idx !== -1) {
          messages.value[idx] = e;
          triggerRef(messages);
        }
        await pool.cacheMessage(e);
        return;
      }

      // Step 2: Duplicate guard — O(1) check via messageIdSet
      if (messageIdSet.has(e.messageId)) return;

      // Step 2b: WS event arrived BEFORE readback — our own message,
      // but optimistic has randomId as messageId so duplicate guard missed it.
      // Replace the oldest pending optimistic message with real server data.
      if (e.sender === me.me?.userId && optimisticRandomIds.size > 0) {
        const optIdx = messages.value.findIndex((m) => m._optimistic && !m._failed);
        if (optIdx !== -1) {
          const optMsg = messages.value[optIdx] as ChatMessage;
          const randomId = optMsg._randomId!;
          // Clean up optimistic tracking
          const timer = optimisticTimers.get(randomId);
          if (timer) { clearTimeout(timer); optimisticTimers.delete(randomId); }
          optimisticRandomIds.delete(randomId);
          // Replace optimistic with real server data (in-place)
          messageIdSet.delete(optMsg.messageId);
          messageIdSet.add(e.messageId);
          messages.value[optIdx] = e;
          triggerRef(messages);
          await pool.cacheMessage(e);
          // Mark as resolved so late readback is a no-op
          resolvedMessageIds.add(e.messageId);
          setTimeout(() => resolvedMessageIds.delete(e.messageId), 10_000);
          return;
        }
      }

      // Normal new message from others or self (not yet resolved by readback)
      await pool.cacheMessage(e);

      // Play mention sound only if channel is not muted
      const sid = spaceId();
      const muteLevel = sid ? ntf.effectiveMuteLevel(e.channelId, sid) : MuteLevelType.None;
      if (muteLevel !== MuteLevelType.All) {
        if (e.entities?.filter(filterMention).find((x) => x.userId === me.me?.userId)) {
          tone.playNotificationSound();
        }
      }

      // Batch incoming messages to avoid multiple array rebuilds per frame
      queueIncomingMessage(e, onNewMessage);
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

    // Step 5: Start timeout — auto-fail if not resolved within 30s
    const timer = setTimeout(() => {
      if (optimisticRandomIds.has(randomId)) {
        markOptimisticFailed(randomId, "Message sending timed out");
      }
    }, OPTIMISTIC_TIMEOUT_MS);
    optimisticTimers.set(randomId, timer);
  };

  /**
   * Step 1: Resolve optimistic message with real server data.
   * Called by EnterText after SendMessageWithReadback returns.
   * Replaces the optimistic placeholder (messageId === randomId) with real messageId.
   * Adds realMessageId to resolvedMessageIds so the duplicate server event is skipped.
   */
  const resolveOptimisticMessage = async (
    randomId: bigint,
    readback: { messageId: bigint; channelId: Guid; spaceId: Guid },
  ) => {
    // If WS event already resolved this optimistic message, just clean up
    if (!optimisticRandomIds.has(randomId)) {
      return;
    }

    // Clear timeout
    const timer = optimisticTimers.get(randomId);
    if (timer) {
      clearTimeout(timer);
      optimisticTimers.delete(randomId);
    }

    const idx = messages.value.findIndex(
      (m) => m._optimistic && m.messageId === randomId,
    );

    if (idx !== -1) {
      // Replace optimistic with a confirmed version — only update messageId + strip flags.
      // Do NOT cache: entities still have placeholder fileIds.
      // The real server event (via subscription) will cache the full message with real data.
      const { _optimistic, _randomId, _failed, _error, ...rest } = messages.value[idx];
      const confirmed: ChatMessage = { ...rest, messageId: readback.messageId };
      messageIdSet.delete(messages.value[idx].messageId);
      messageIdSet.add(readback.messageId);
      messages.value[idx] = confirmed;
      triggerRef(messages);
    }

    optimisticRandomIds.delete(randomId);
    // Mark realMessageId as resolved so server event is skipped (dedup)
    resolvedMessageIds.add(readback.messageId);

    // Clean up resolved IDs after 10s (server event should have arrived by then)
    setTimeout(() => {
      resolvedMessageIds.delete(readback.messageId);
    }, 10_000);
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

  /**
   * Step 4: Retry a failed optimistic message.
   * Resets the failed state, generates a new randomId, re-sends to server.
   */
  const retryMessage = async (failedMsg: ChatMessage) => {
    const oldRandomId = failedMsg._randomId;
    if (!oldRandomId) return;

    // Remove old failed message
    removeOptimisticMessage(oldRandomId);

    // Generate new randomId
    const newRandomId = crypto.getRandomValues(new BigUint64Array(1))[0] & 0x7FFFFFFFFFFFFFFFn;

    // Re-add as optimistic with new randomId
    const { _failed, _error, _optimistic, _randomId, ...rest } = failedMsg;
    const retryMsg: ArgonMessage = {
      ...rest,
      messageId: newRandomId,
      timeSent: { date: new Date(), offsetMinutes: 0 },
    };
    addOptimisticMessage(retryMsg, newRandomId);

    // Re-send
    try {
      // Filter out optimistic attachment entities (placeholder fileId) — only keep non-attachment entities
      // Attachments from failed messages can't be retried (upload may have failed)
      const retryEntities = (failedMsg.entities ?? []).filter(
        (e) => e.type !== EntityType.Attachment,
      );

      const readback = await api.channelInteraction.SendMessageWithReadback(
        spaceId()!,
        channelId(),
        failedMsg.text ?? "",
        retryEntities,
        newRandomId,
        failedMsg.replyId ?? null,
      );

      await resolveOptimisticMessage(newRandomId, readback);
    } catch (e: any) {
      logger.error("Retry failed:", e);
      markOptimisticFailed(newRandomId, e?.message ?? "Retry failed");
    }
  };

  const getMessageById = (messageId: bigint | null): ArgonMessage => {
    return messages.value.find((x) => x.messageId === (messageId ?? 0n)) ?? ({} as ArgonMessage);
  };

  const cleanup = () => {
    subs.value?.unsubscribe();
    // Step 5: Cleanup all optimistic timers
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
