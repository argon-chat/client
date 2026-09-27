import type { ReactionInfo } from "@argon/glue";

/**
 * Reactions by identity. A custom emoji reaction is its item, whatever `emoji` text it carries; a
 * unicode one is its emoji. The two never merge, even when a custom reaction's `emoji` happens to
 * be the same character.
 */
export interface ReactionRef {
  emoji: string;
  customEmojiId: string | null;
}

export function reactionKey(r: { emoji: string; customEmojiId?: string | null }): string {
  return r.customEmojiId ? `custom:${r.customEmojiId}` : `emoji:${r.emoji}`;
}

export function hasReacted(reactions: readonly ReactionInfo[], ref: ReactionRef, userId: string): boolean {
  const key = reactionKey(ref);
  return reactions.find((r) => reactionKey(r) === key)?.userIds.includes(userId) ?? false;
}

/** Adds a user's reaction (mutating the matching entry of a copied list, as the list rows expect). */
export function applyReactionAdded(reactions: ReactionInfo[], ref: ReactionRef, userId: string): ReactionInfo[] {
  const key = reactionKey(ref);
  const existing = reactions.find((r) => reactionKey(r) === key);
  if (existing) {
    if (existing.userIds.includes(userId)) return reactions;
    existing.count = (existing.count + 1) as any;
    existing.userIds = [...existing.userIds, userId] as any;
    if (!existing.emoji && ref.emoji) existing.emoji = ref.emoji;
  } else {
    reactions.push({
      emoji: ref.emoji,
      customEmojiId: ref.customEmojiId as any,
      count: 1 as any,
      userIds: [userId] as any,
    });
  }
  return reactions;
}

/**
 * The reaction a removal names. The ReactionRemoved event carries only `emoji`: it is the unicode
 * reaction with that emoji when there is one, else the custom reaction whose item id or emoji text
 * it is.
 */
export function findReaction(reactions: readonly ReactionInfo[], ref: ReactionRef | string): ReactionInfo | undefined {
  if (typeof ref !== "string") {
    const key = reactionKey(ref);
    return reactions.find((r) => reactionKey(r) === key);
  }
  return (
    reactions.find((r) => !r.customEmojiId && r.emoji === ref) ??
    reactions.find((r) => !!r.customEmojiId && (r.customEmojiId === ref || r.emoji === ref))
  );
}

export function applyReactionRemoved(reactions: ReactionInfo[], ref: ReactionRef | string, userId: string): ReactionInfo[] {
  const existing = findReaction(reactions, ref);
  if (!existing) return reactions;
  existing.userIds = existing.userIds.filter((id) => id !== userId) as any;
  existing.count = existing.userIds.length as any;
  if (existing.count === 0) return reactions.filter((r) => r !== existing);
  return reactions;
}
