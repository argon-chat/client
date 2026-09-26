import { shallowRef, watch } from "vue";

/** What a dragged voice member carries: their user id, for the chat area to read on drop. */
export const MEMBER_DRAG_TYPE = "application/x-argon-member";

/** A mention asked for from outside the composer: a voice member dropped on a text channel. */
export interface ComposerMention {
  channelId: string;
  userId: string;
  at: number;
}

// A drop whose channel never opened a composer must not surface there minutes later.
const TTL_MS = 15_000;

export const pendingMention = shallowRef<ComposerMention | null>(null);

export function requestMention(channelId: string, userId: string) {
  pendingMention.value = { channelId, userId, at: Date.now() };
}

/** The pending mention for this channel's composer, handed over once. */
export function takeMention(channelId: string): ComposerMention | null {
  const m = pendingMention.value;
  if (!m || m.channelId !== channelId) return null;
  pendingMention.value = null;
  return Date.now() - m.at > TTL_MS ? null : m;
}

/**
 * Hands a composer the mentions dropped on its channel, but not before `ready`: a composer with
 * text in it no longer takes its draft, so the mention must not arrive ahead of the draft.
 * `channelId` is null while the composer cannot take one.
 */
export function useDroppedMentions(
  channelId: () => string | null,
  ready: Promise<void>,
  insert: (userId: string) => void,
) {
  let settled = false;
  const take = () => {
    const id = settled ? channelId() : null;
    const m = id ? takeMention(id) : null;
    if (m) insert(m.userId);
  };
  watch(pendingMention, take);
  void ready.then(() => {
    settled = true;
    take();
  });
}
