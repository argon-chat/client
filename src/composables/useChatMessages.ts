import {
  ref,
  shallowRef,
  triggerRef,
  computed,
  nextTick,
} from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import { IonDateTime } from "@argon-chat/ion.webcore";
import {
  type ArgonMessage,
  EntityType,
  type IMessageEntity,
  type MessageEntityMention,
  SendMessageError,
} from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";
import { sendMessageErrorKey } from "@/lib/refusals";
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
  /**
   * Bumped when the server replaces the message in place (MessageUpdated). The list memoises rows
   * on a few fields; a link preview filled in after the send changes none of them.
   */
  _rev?: number;
};

const MESSAGES_PER_LOAD = 50;
const OPTIMISTIC_TIMEOUT_MS = 30_000;
const MAX_MESSAGES_IN_MEMORY = 500;

/** Everything a row can show, for telling a cached copy from the server's; `_rev` and the cache key left out. */
function signature(m: ChatMessage): string {
  return JSON.stringify(m, (key, value) =>
    key === "_rev" || key === "_msgId" ? undefined : typeof value === "bigint" ? value.toString() : value,
  );
}

/**
 * The server's copy of messages the list may already show. A row whose content changed gets its
 * `_rev` bumped (the list memoises rows on it); an unchanged one keeps the `_rev` it had.
 */
function revised(page: readonly ArgonMessage[], shown: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map(shown.map((m) => [m.messageId, m]));
  return page.map((m) => {
    const prev = byId.get(m.messageId);
    if (!prev) return m;
    return signature(prev) === signature(m) ? { ...m, _rev: prev._rev } : { ...m, _rev: (prev._rev ?? 0) + 1 };
  });
}

export function useChatMessages(
  channelId: () => Guid,
  spaceId: () => Guid | undefined,
) {
  const api = useApi();
  const pool = usePoolStore();
  const me = useMe();
  const tone = useTone();
  const ntf = useNotificationStore();
  const { t } = useLocale();

  const messages = shallowRef<ChatMessage[]>([]);
  const hasReachedEnd = ref(false);
  const isLoading = ref(false);
  const isLoadingOlder = ref(false);
  const newMessagesCount = ref(0);
  const isScrolledUp = ref(false);
  // False while the list shows a stretch of history opened by a jump (a pin, a reply) that does not
  // reach the present: new messages are held and counted rather than appended, and scrolling down
  // pages towards the present.
  const hasReachedLatest = ref(true);
  const isLoadingNewer = ref(false);
  const heldLive = new Map<bigint, ArgonMessage>();
  // What the last load of the present did once it landed (scroll to the bottom), for coming back.
  let onPresentLoaded: () => void = () => {};
  const subs = ref<Subscription | null>(null);
  const updateSubs = ref<Subscription | null>(null);
  const deleteSubs = ref<Subscription | null>(null);
  const publishSubs = ref<Subscription | null>(null);

  // Maps randomId → optimistic message's randomId (used as messageId in the optimistic msg)
  const optimisticRandomIds = new Set<bigint>();
  // Set of real messageIds that have been resolved via SendMessage's readback
  // Used to skip the duplicate server event that arrives via WebSocket
  const resolvedMessageIds = new Set<bigint>();
  // Timers for orphaned optimistic cleanup
  const optimisticTimers = new Map<bigint, ReturnType<typeof setTimeout>>();

  // O(1) dedup: tracks all messageIds currently in the messages array
  const messageIdSet = new Set<bigint>();

  // Bumped per channel load: a page or a check that comes back after the channel changed is dropped.
  let loadGeneration = 0;
  // While a page is on its way: what arrived or was deleted live in the meantime, which the page
  // cannot know about and must not undo.
  let pagesInFlight = 0;
  const arrivedLive = new Set<bigint>();
  const deletedLive = new Set<bigint>();
  // The server check of the last older page served from the cache; the next page waits for it.
  let revalidating: Promise<void> = Promise.resolve();

  /**
   * One page of history from the server, reconciled into the cache (see messageStore), minus what
   * was deleted live since it was asked for. `use` applies it to the list, unless the channel has
   * changed by then.
   */
  async function serverPage(
    before: bigint | null,
    use: (page: ArgonMessage[], reachedStart: boolean) => void | Promise<void>,
  ): Promise<void> {
    const sid = spaceId();
    const cid = channelId();
    if (!sid) return;
    const generation = loadGeneration;
    pagesInFlight++;
    try {
      const answer = (await api.channelInteraction.QueryMessages(sid, cid, before, MESSAGES_PER_LOAD)) ?? [];
      const reachedStart = answer.length < MESSAGES_PER_LOAD;
      const page = [...answer].filter((m) => !deletedLive.has(m.messageId)).sort((a, b) => Number(a.messageId - b.messageId));
      await pool.reconcileMessages(sid, cid, page, { before, reachedStart, keep: arrivedLive });
      if (generation === loadGeneration) await use(page, reachedStart);
    } finally {
      if (--pagesInFlight === 0) {
        arrivedLive.clear();
        deletedLive.clear();
      }
    }
  }

  /**
   * Drop the oldest messages beyond MAX_MESSAGES_IN_MEMORY (newest kept). Only for the append path:
   * history loads prepend at the head, and trimming from the head right after used to delete exactly
   * the page just fetched — the list never grew, hasReachedEnd flipped back, and scrolling past
   * 500 messages re-fetched the same page forever.
   */
  const trimMessages = () => {
    if (messages.value.length > MAX_MESSAGES_IN_MEMORY) {
      const removed = messages.value.splice(0, messages.value.length - MAX_MESSAGES_IN_MEMORY);
      for (const m of removed) messageIdSet.delete(m.messageId);
      hasReachedEnd.value = false;
    }
  };

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
    trimMessages();
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

  /**
   * Load older messages.
   * @param callbacks.beforePrepend — called BEFORE messages are prepended (save scroll anchor)
   * @param callbacks.afterPrepend  — called AFTER messages are prepended (restore scroll anchor)
   */
  const loadOlderMessages = async (callbacks: {
    beforePrepend: () => void;
    afterPrepend: () => void;
  }) => {
    if (isLoadingOlder.value || hasReachedEnd.value || !spaceId()) return;

    isLoadingOlder.value = true;

    try {
      // A check still on its way may change which message is the oldest.
      await revalidating;
      if (hasReachedEnd.value) return;

      const fromId = oldestMessageId.value;
      if (!fromId) {
        hasReachedEnd.value = true;
        return;
      }

      const generation = loadGeneration;
      const cachedOlder = await pool.loadOlderCachedMessages(
        spaceId()!,
        channelId(),
        fromId,
        MESSAGES_PER_LOAD,
      );
      if (generation !== loadGeneration) return;

      if (cachedOlder.length >= MESSAGES_PER_LOAD) {
        callbacks.beforePrepend();
        for (const m of cachedOlder) messageIdSet.add(m.messageId);
        messages.value.unshift(...cachedOlder);
        triggerRef(messages);
        callbacks.afterPrepend();
        // Shown from the cache at once; the server's copy of the same span follows.
        revalidating = revalidateOlder(fromId).catch((error) =>
          logger.warn("Failed to check cached messages with the server:", error),
        );
        return;
      }

      await serverPage(fromId, (sortedOlder, reachedStart) => {
        if (sortedOlder.length > 0) {
          callbacks.beforePrepend();
          for (const m of sortedOlder) messageIdSet.add(m.messageId);
          messages.value.unshift(...sortedOlder);
          triggerRef(messages);
          callbacks.afterPrepend();
        }
        if (reachedStart) hasReachedEnd.value = true;
      });
    } catch (error) {
      logger.error("Failed to load older messages:", error);
    } finally {
      isLoadingOlder.value = false;
    }
  };

  /**
   * Stale-while-revalidate for an older page shown from the cache: the server's page for the same
   * span replaces it. Rows the server no longer has leave the list (and the cache), changed ones are
   * swapped in, and ones the cache never had are added. Everything below `before` in the list is
   * that cached page (the next older page waits for this), so the server's page takes its place.
   */
  async function revalidateOlder(before: bigint): Promise<void> {
    await serverPage(before, (page, reachedStart) => {
      const current = messages.value;
      const rest = current.filter((m) => m._optimistic || m.messageId >= before);
      const block = current.filter((m) => !m._optimistic && m.messageId < before);
      const next = revised(page, block);
      const unchanged =
        block.length === next.length && block.every((m, i) => m.messageId === next[i].messageId && m._rev === next[i]._rev);
      if (reachedStart) hasReachedEnd.value = true;
      if (unchanged) return;

      for (const m of block) messageIdSet.delete(m.messageId);
      for (const m of next) messageIdSet.add(m.messageId);
      messages.value = [...next, ...rest];
    });
  }

  const loadInitialMessages = async (onLoaded: () => void, opts: { keepOptimistic?: boolean } = {}) => {
    if (!spaceId()) return;

    const generation = ++loadGeneration;
    revalidating = Promise.resolve();
    isLoading.value = true;
    hasReachedEnd.value = false;
    hasReachedLatest.value = true;
    heldLive.clear();
    onPresentLoaded = onLoaded;
    newMessagesCount.value = 0;
    isScrolledUp.value = false;
    // Coming back from a jump: what is being sent stays in view.
    const pending = opts.keepOptimistic ? messages.value.filter((m) => m._optimistic) : [];

    try {
      // Step 6: Load from cache first WITHOUT clearing — no flash
      const cachedMessages = await pool.loadCachedMessages(spaceId()!, channelId());
      if (generation !== loadGeneration) return;

      if (cachedMessages.length > 0) {
        messageIdSet.clear();
        for (const m of [...cachedMessages, ...pending]) messageIdSet.add(m.messageId);
        messages.value = [...cachedMessages, ...pending];
        await nextTick();
        onLoaded();
      } else {
        // No cache — clear old channel's messages
        messageIdSet.clear();
        for (const m of pending) messageIdSet.add(m.messageId);
        messages.value = pending;
      }

      // The newest page is the truth for everything from its oldest message on: what the cache
      // showed and the server no longer has was deleted (or edited) while nobody here was watching.
      await serverPage(null, async (sorted, reachedStart) => {
        const shown = messages.value;
        const newest = sorted.length ? sorted[sorted.length - 1].messageId : -1n;
        // Sent or received while the page was on its way: newer than anything it could hold.
        const live = shown.filter((m) => m._optimistic || (arrivedLive.has(m.messageId) && m.messageId > newest));
        messageIdSet.clear();
        for (const m of sorted) messageIdSet.add(m.messageId);
        for (const m of live) messageIdSet.add(m.messageId);
        messages.value = [...revised(sorted, shown), ...live];
        if (reachedStart) hasReachedEnd.value = true;

        await nextTick();
        if (sorted.length > 0) onLoaded();
      });
    } catch (error) {
      logger.error("Failed to load initial messages:", error);
    } finally {
      if (generation === loadGeneration) isLoading.value = false;
    }
  };

  /**
   * Opens the stretch of history around a message that is not loaded: the list is replaced by the
   * server's page around it and stops following the present until paging down reaches it. False
   * when the message no longer exists (or cannot be read); the list is then left as it was.
   *
   * These pages stay out of the local cache: it holds one run back from the newest message, and a
   * stretch from further back would sit under it as if it came next when scrolling up from the
   * present.
   */
  const jumpToMessage = async (messageId: bigint): Promise<boolean> => {
    if (messageIdSet.has(messageId)) return true;
    const sid = spaceId();
    const cid = channelId();
    if (!sid) return false;

    const newerAsked = Math.floor(MESSAGES_PER_LOAD / 2);
    const olderAsked = MESSAGES_PER_LOAD - newerAsked;
    const generation = loadGeneration;
    const stretch = await api.channelInteraction.QueryMessagesAround(sid, cid, messageId, olderAsked, newerAsked);
    if (generation !== loadGeneration || cid !== channelId()) return false;
    if (!stretch.containsAnchor) return false;

    const page = [...stretch.messages].sort((a, b) => Number(a.messageId - b.messageId));
    const reachedLatest = !stretch.hasNewer;
    const reachedStart = !stretch.hasOlder;

    ++loadGeneration;
    revalidating = Promise.resolve();
    heldLive.clear();
    newMessagesCount.value = 0;
    const pending = reachedLatest ? messages.value.filter((m) => m._optimistic) : [];
    messageIdSet.clear();
    for (const m of [...page, ...pending]) messageIdSet.add(m.messageId);
    messages.value = [...page, ...pending];
    hasReachedEnd.value = reachedStart;
    hasReachedLatest.value = reachedLatest;
    return true;
  };

  /** Pages down from a jump towards the present; once there, the list follows it again. */
  const loadNewerMessages = async () => {
    const sid = spaceId();
    const cid = channelId();
    if (hasReachedLatest.value || isLoadingNewer.value || !sid) return;
    const last = [...messages.value].reverse().find((m) => !m._optimistic);
    if (!last) return;

    const generation = loadGeneration;
    isLoadingNewer.value = true;
    try {
      const stretch = await api.channelInteraction.QueryMessagesAround(sid, cid, last.messageId, 0, MESSAGES_PER_LOAD);
      if (generation !== loadGeneration) return;

      const reachedLatest = !stretch.hasNewer;
      const page = [...stretch.messages].sort((a, b) => Number(a.messageId - b.messageId));

      // Held while away: what arrived live and the last page came too early to include.
      const held = reachedLatest ? [...heldLive.values()] : [];
      const added = [...page, ...held]
        .filter((m) => !messageIdSet.has(m.messageId))
        .sort((a, b) => Number(a.messageId - b.messageId));
      for (const m of added) messageIdSet.add(m.messageId);
      if (added.length) {
        messages.value.push(...added);
        trimMessages();
        triggerRef(messages);
      }
      if (reachedLatest) {
        hasReachedLatest.value = true;
        heldLive.clear();
        newMessagesCount.value = 0;
      }
    } catch (error) {
      logger.error("Failed to load newer messages:", error);
    } finally {
      isLoadingNewer.value = false;
    }
  };

  /** Back to the newest messages after a jump; what is being sent stays. */
  const returnToPresent = async () => {
    if (hasReachedLatest.value) return;
    await loadInitialMessages(onPresentLoaded, { keepOptimistic: true });
  };

  // ────────────────────────────────────────────
  // Realtime subscription
  // ────────────────────────────────────────────

  const subscribeToNewMessages = (
    chId: Guid,
    onNewMessage: () => void,
  ) => {
    subs.value?.unsubscribe();
    updateSubs.value?.unsubscribe();
    deleteSubs.value?.unsubscribe();
    publishSubs.value?.unsubscribe();
    pendingIncoming = [];
    batchFlushScheduled = false;

    // The server rewrote a message we may already show (a link preview that arrived after the
    // send): replace it whole, as the event carries it whole.
    updateSubs.value = pool.onMessageUpdated.subscribe(async (e) => {
      if (chId !== e.channelId) return;
      await applyServerMessage(e);
    });

    deleteSubs.value = pool.onMessageDeleted.subscribe(async (e) => {
      if (chId !== e.channelId) return;
      if (pagesInFlight > 0) deletedLive.add(e.messageId);
      await removeMessage(e.messageId);
    });

    publishSubs.value = pool.onMessagePublished.subscribe(async (e) => {
      if (chId !== e.channelId) return;
      await markPublished(e.messageId, e.publishedAt);
    });

    subs.value = pool.onNewMessageReceived.subscribe(async (e) => {
      if (chId !== e.channelId) return;
      if (pagesInFlight > 0) arrivedLive.add(e.messageId);

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

      // Away in older history: counted and held, not appended past a gap.
      if (!hasReachedLatest.value) {
        heldLive.set(e.messageId, e);
        if (e.sender !== me.me?.userId) newMessagesCount.value++;
        return;
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

    // Sent from older history: back to the present, where it lands.
    if (!hasReachedLatest.value) void returnToPresent();
  };

  /**
   * Step 1: Resolve optimistic message with real server data.
   * Called by EnterText after SendMessage succeeds.
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
      // Stamped at UTC, as the old `{ date, offsetMinutes: 0 }` literal was: the server
      // rewrites this the moment the send is acknowledged, so it only has to render right
      // locally in the meantime, and `toDate()` puts it back in the viewer's zone.
      timeSent: IonDateTime.now(),
    };
    addOptimisticMessage(retryMsg, newRandomId);

    // Re-send
    try {
      // Filter out optimistic attachment entities (placeholder fileId) — only keep non-attachment entities
      // Attachments from failed messages can't be retried (upload may have failed)
      const retryEntities = (failedMsg.entities ?? []).filter(
        (e) => e.type !== EntityType.Attachment,
      );

      const result = await api.channelInteraction.SendMessage(
        spaceId()!,
        channelId(),
        failedMsg.text ?? "",
        retryEntities,
        newRandomId,
        failedMsg.replyId ?? null,
      );

      if (result.isSuccessSendMessage()) {
        await resolveOptimisticMessage(newRandomId, result.readback);
        return;
      }
      const error = result.isFailedSendMessage() ? result.error : SendMessageError.NONE;
      logger.warn("Retry refused:", SendMessageError[error] ?? error);
      markOptimisticFailed(newRandomId, t(sendMessageErrorKey(error)));
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
    updateSubs.value?.unsubscribe();
    deleteSubs.value?.unsubscribe();
    publishSubs.value?.unsubscribe();
    // Step 5: Cleanup all optimistic timers
    for (const timer of optimisticTimers.values()) {
      clearTimeout(timer);
    }
    optimisticTimers.clear();
    optimisticRandomIds.clear();
    resolvedMessageIds.clear();
    messageIdSet.clear();
    heldLive.clear();
    hasReachedLatest.value = true;
    loadGeneration++;
  };

  /** Swaps in the server's copy of a message already in the list (MessageUpdated, or an edit's answer). */
  async function applyServerMessage(e: ArgonMessage) {
    const idx = messages.value.findIndex((m) => m.messageId === e.messageId);
    if (idx !== -1) {
      const prev = messages.value[idx];
      messages.value[idx] = { ...e, _rev: (prev._rev ?? 0) + 1 };
      triggerRef(messages);
    }
    await pool.cacheMessage(e);
  }

  /** Takes a message out of the list and the local cache (MessageDeleted, or the user's own delete). */
  async function removeMessage(messageId: bigint) {
    heldLive.delete(messageId);
    const idx = messages.value.findIndex((m) => m.messageId === messageId);
    if (idx !== -1) {
      messages.value.splice(idx, 1);
      messageIdSet.delete(messageId);
      triggerRef(messages);
    }
    await pool.removeCachedMessage(messageId);
  }

  /** Stamps an announcement as sent to its followers (MessagePublished, or the user's own publish). */
  async function markPublished(messageId: bigint, publishedAt: IonDateTime) {
    const idx = messages.value.findIndex((m) => m.messageId === messageId);
    if (idx !== -1) {
      const prev = messages.value[idx];
      if (prev.publishedAt) return;
      const { _rev, ...rest } = prev;
      messages.value[idx] = { ...rest, publishedAt, _rev: (_rev ?? 0) + 1 };
      triggerRef(messages);
      await pool.cacheMessage({ ...rest, publishedAt });
      return;
    }
    const cached = await pool.getMessageById(messageId);
    if (cached && cached.messageId === messageId && cached.channelId === channelId() && !cached.publishedAt) await pool.cacheMessage({ ...cached, publishedAt });
  }

  return {
    messages,
    hasReachedEnd,
    isLoading,
    isLoadingOlder,
    newMessagesCount,
    isScrolledUp,
    hasReachedLatest,
    isLoadingNewer,
    loadOlderMessages,
    loadInitialMessages,
    jumpToMessage,
    loadNewerMessages,
    returnToPresent,
    subscribeToNewMessages,
    getMessageById,
    addOptimisticMessage,
    resolveOptimisticMessage,
    removeOptimisticMessage,
    markOptimisticFailed,
    retryMessage,
    applyServerMessage,
    removeMessage,
    markPublished,
    cleanup,
  };
}
