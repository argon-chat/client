import { type ShallowRef, computed } from "vue";
import { usePoolStore } from "@/store/data/poolStore";
import { useApi } from "@/store/system/apiStore";
import { useMe } from "@/store/auth/meStore";
import { usePexStore } from "@/store/data/permissionStore";
import { logger } from "@argon/core";
import type { Guid } from "@argon-chat/ion.webcore";
import type { ReactionInfo, ReactionAdded, ReactionRemoved } from "@argon/glue";
import type { ChatMessage } from "./useChatMessages";
import type { Subscription } from "rxjs";

export const DEFAULT_REACTIONS = ["👍", "👎", "❤️", "💩", "🤡", "😄", "😏", "🔥"];

function applyReactionAdded(
  reactions: ReactionInfo[],
  emoji: string,
  userId: string,
): ReactionInfo[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (existing) {
    if (existing.userIds.includes(userId)) return reactions;
    existing.count = (existing.count + 1) as any;
    existing.userIds = [...existing.userIds, userId] as any;
  } else {
    reactions.push({
      emoji,
      customEmojiId: null,
      count: 1 as any,
      userIds: [userId] as any,
    });
  }
  return reactions;
}

function applyReactionRemoved(
  reactions: ReactionInfo[],
  emoji: string,
  userId: string,
): ReactionInfo[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) return reactions;
  existing.userIds = existing.userIds.filter((id) => id !== userId) as any;
  existing.count = existing.userIds.length as any;
  if (existing.count === 0) {
    return reactions.filter((r) => r.emoji !== emoji);
  }
  return reactions;
}

export function useMessageReactions(
  messages: ShallowRef<ChatMessage[]>,
  channelId: () => Guid,
  spaceId: () => Guid | undefined,
) {
  const pool = usePoolStore();
  const api = useApi();
  const me = useMe();
  const pex = usePexStore();

  const canReact = computed(() => pex.has("AddReactions"));

  const subs: Subscription[] = [];

  function updateInMemory(messageId: bigint, updater: (reactions: ReactionInfo[]) => ReactionInfo[]) {
    const idx = messages.value.findIndex((m) => m.messageId === messageId);
    if (idx === -1) return;
    const msg = messages.value[idx];
    const updated = updater([...(msg.reactions ?? [])]);
    const newMessages = [...messages.value];
    newMessages[idx] = { ...msg, reactions: updated as any };
    messages.value = newMessages;
  }

  function subscribe() {
    subs.push(
      pool.onReactionAdded.subscribe((ev: ReactionAdded & { spaceId: string }) => {
        if (ev.channelId !== channelId()) return;
        updateInMemory(ev.messageId, (r) => applyReactionAdded(r, ev.emoji, ev.userId));
        void pool.updateMessageReactions(ev.messageId, (r) =>
          applyReactionAdded(r, ev.emoji, ev.userId),
        );
      }),
    );

    subs.push(
      pool.onReactionRemoved.subscribe((ev: ReactionRemoved & { spaceId: string }) => {
        if (ev.channelId !== channelId()) return;
        updateInMemory(ev.messageId, (r) => applyReactionRemoved(r, ev.emoji, ev.userId));
        void pool.updateMessageReactions(ev.messageId, (r) =>
          applyReactionRemoved(r, ev.emoji, ev.userId),
        );
      }),
    );
  }

  function unsubscribe() {
    for (const s of subs) s.unsubscribe();
    subs.length = 0;
  }

  async function toggleReaction(messageId: bigint, emoji: string) {
    if (!canReact.value || !spaceId()) return;

    const msg = messages.value.find((m) => m.messageId === messageId);
    if (!msg) return;

    const myId = me.me?.userId;
    if (!myId) return;

    const existing = (msg.reactions ?? []).find((r) => r.emoji === emoji);
    const hasMyReaction = existing?.userIds.includes(myId) ?? false;

    // Optimistic update
    if (hasMyReaction) {
      updateInMemory(messageId, (r) => applyReactionRemoved(r, emoji, myId));
    } else {
      updateInMemory(messageId, (r) => applyReactionAdded(r, emoji, myId));
    }

    try {
      if (hasMyReaction) {
        const result = await api.channelInteraction.RemoveReaction(
          spaceId()!,
          channelId(),
          messageId,
          emoji,
        );
        if (result.isFailedRemoveReaction()) {
          // Revert
          updateInMemory(messageId, (r) => applyReactionAdded(r, emoji, myId));
        }
      } else {
        const result = await api.channelInteraction.AddReaction(
          spaceId()!,
          channelId(),
          messageId,
          emoji,
        );
        if (result.isFailedAddReaction()) {
          // Revert
          updateInMemory(messageId, (r) => applyReactionRemoved(r, emoji, myId));
        }
      }
    } catch (error) {
      logger.error("Failed to toggle reaction:", error);
      // Revert on error
      if (hasMyReaction) {
        updateInMemory(messageId, (r) => applyReactionAdded(r, emoji, myId));
      } else {
        updateInMemory(messageId, (r) => applyReactionRemoved(r, emoji, myId));
      }
    }
  }

  async function batchLoadReactions(messageIds: bigint[]) {
    if (!spaceId() || messageIds.length === 0) return;

    try {
      const entries = await api.channelInteraction.BatchGetReactions(
        spaceId()!,
        channelId(),
        messageIds as any,
      );

      if (!entries || entries.length === 0) return;

      for (const entry of entries) {
        if (!entry.reactions || entry.reactions.length === 0) continue;
        updateInMemory(entry.messageId, () => [...entry.reactions]);
        void pool.updateMessageReactions(entry.messageId, () => [...entry.reactions]);
      }
    } catch (error) {
      logger.error("Failed to batch load reactions:", error);
    }
  }

  return {
    canReact,
    toggleReaction,
    batchLoadReactions,
    subscribe,
    unsubscribe,
  };
}
