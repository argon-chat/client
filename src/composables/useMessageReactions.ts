import { type ShallowRef, computed } from "vue";
import { usePoolStore } from "@/store/data/poolStore";
import { useApi } from "@/store/system/apiStore";
import { useMe } from "@/store/auth/meStore";
import { usePexStore } from "@/store/data/permissionStore";
import { logger } from "@argon/core";
import { metrics, errorKind } from "@/lib/telemetry/metrics";
import type { Guid } from "@argon-chat/ion.webcore";
import type { ReactionInfo, ReactionAdded, ReactionRemoved } from "@argon/glue";
import { applyReactionAdded, applyReactionRemoved, hasReacted, type ReactionRef } from "@/lib/chat/reactions";
import type { ChatMessage } from "./useChatMessages";
import type { Subscription } from "rxjs";

export const DEFAULT_REACTIONS = ["👍", "👎", "❤️", "💩", "🤡", "😄", "😏", "🔥"];

export function useMessageReactions(
  messages: ShallowRef<ChatMessage[]>,
  channelId: () => Guid,
  spaceId: () => Guid | undefined,
) {
  const pool = usePoolStore();
  const api = useApi();
  const me = useMe();
  const pex = usePexStore();

  const canReact = computed(() => pex.hasIn(channelId(), "AddReactions", spaceId()));

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
        const ref = { emoji: ev.emoji, customEmojiId: ev.customEmojiId ?? null };
        updateInMemory(ev.messageId, (r) => applyReactionAdded(r, ref, ev.userId));
        void pool.updateMessageReactions(ev.messageId, (r) => applyReactionAdded(r, ref, ev.userId));
      }),
    );

    subs.push(
      pool.onReactionRemoved.subscribe((ev: ReactionRemoved & { spaceId: string }) => {
        if (ev.channelId !== channelId()) return;
        updateInMemory(ev.messageId, (r) => applyReactionRemoved(r, ev.emoji, ev.userId));
        void pool.updateMessageReactions(ev.messageId, (r) => applyReactionRemoved(r, ev.emoji, ev.userId));
      }),
    );
  }

  function unsubscribe() {
    for (const s of subs) s.unsubscribe();
    subs.length = 0;
  }

  /** Adds or takes back the user's reaction, at once on screen and then on the server. */
  async function toggle(messageId: bigint, ref: ReactionRef) {
    if (!canReact.value || !spaceId()) return;

    const msg = messages.value.find((m) => m.messageId === messageId);
    if (!msg) return;

    const myId = me.me?.userId;
    if (!myId) return;

    const hasMyReaction = hasReacted(msg.reactions ?? [], ref, myId);
    const add = () => updateInMemory(messageId, (r) => applyReactionAdded(r, ref, myId));
    const remove = () => updateInMemory(messageId, (r) => applyReactionRemoved(r, ref, myId));

    // Optimistic update
    if (hasMyReaction) remove();
    else add();

    const custom = ref.customEmojiId;
    try {
      if (hasMyReaction) {
        const result = custom
          ? await api.channelInteraction.RemoveCustomReaction(spaceId()!, channelId(), messageId, custom)
          : await api.channelInteraction.RemoveReaction(spaceId()!, channelId(), messageId, ref.emoji);
        metrics.count("reaction.toggle", { action: "remove", result: result.isFailedRemoveReaction() ? "failed" : "ok" });
        if (result.isFailedRemoveReaction()) add();
      } else {
        const result = custom
          ? await api.channelInteraction.AddCustomReaction(spaceId()!, channelId(), messageId, custom)
          : await api.channelInteraction.AddReaction(spaceId()!, channelId(), messageId, ref.emoji);
        metrics.count("reaction.toggle", { action: "add", result: result.isFailedAddReaction() ? "failed" : "ok" });
        if (result.isFailedAddReaction()) remove();
      }
    } catch (error) {
      logger.error("Failed to toggle reaction:", error);
      metrics.count("reaction.toggle", { action: hasMyReaction ? "remove" : "add", result: "failed", error: errorKind(error) });
      // Revert on error
      if (hasMyReaction) add();
      else remove();
    }
  }

  function toggleReaction(messageId: bigint, emoji: string) {
    return toggle(messageId, { emoji, customEmojiId: null });
  }

  /** A custom emoji reaction, by its item. `emoji` is only what the optimistic pill carries. */
  function toggleCustomReaction(messageId: bigint, itemId: string, emoji = "") {
    return toggle(messageId, { emoji, customEmojiId: itemId });
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
    toggleCustomReaction,
    batchLoadReactions,
    subscribe,
    unsubscribe,
  };
}
