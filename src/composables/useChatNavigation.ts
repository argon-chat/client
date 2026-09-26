import { nextTick, type Ref } from "vue";
import type { useChatMessages } from "@/composables/useChatMessages";

type Chat = Pick<
  ReturnType<typeof useChatMessages>,
  | "messages"
  | "isScrolledUp"
  | "newMessagesCount"
  | "hasReachedEnd"
  | "hasReachedLatest"
  | "isLoadingOlder"
  | "loadOlderMessages"
  | "loadNewerMessages"
  | "jumpToMessage"
  | "returnToPresent"
>;

export interface ChatListHandle {
  scrollToMessage(messageId: bigint): void;
}

/** Distance from the bottom (px) within which history opened by a jump pages further down. */
export const PAGE_DOWN_DISTANCE = 400;
/** Further from the bottom than this (px) the reader is scrolled up: new messages do not pull them down. */
export const SCROLLED_UP_DISTANCE = 100;

/**
 * How the message list moves through a channel's history: older pages when nearing the top, newer
 * ones when nearing the bottom of history opened by a jump, jumps to a message (a pin, a reply's
 * original) and the way back to the present. Shared by the chat view and its tests.
 */
export function useChatNavigation(
  chat: Chat,
  list: Ref<ChatListHandle | null | undefined>,
  opts: { onOpened?: (messageIds: bigint[]) => void } = {},
) {
  function onNearTop() {
    if (!chat.isLoadingOlder.value && !chat.hasReachedEnd.value) {
      void chat.loadOlderMessages({ beforePrepend: () => {}, afterPrepend: () => {} });
    }
  }

  /** The list reports where it is scrolled to. */
  function onScrollState(distance: number) {
    const away = !chat.hasReachedLatest.value;
    if (away && distance < PAGE_DOWN_DISTANCE) void chat.loadNewerMessages();

    const was = chat.isScrolledUp.value;
    chat.isScrolledUp.value = distance > SCROLLED_UP_DISTANCE;
    // Back at the bottom of the present: nothing is left unseen. The bottom of history opened by a
    // jump is not that; what arrived meanwhile is still held.
    if (was && !chat.isScrolledUp.value && !away) chat.newMessagesCount.value = 0;
  }

  /** Scrolls to a message, opening the history around it first when it is not loaded. False when it is gone. */
  async function jumpToMessage(messageId: bigint): Promise<boolean> {
    if (!chat.messages.value.some((m) => m.messageId === messageId)) {
      if (!(await chat.jumpToMessage(messageId))) return false;
      opts.onOpened?.(chat.messages.value.filter((m) => !m._optimistic).map((m) => m.messageId));
      await nextTick();
    }
    list.value?.scrollToMessage(messageId);
    return true;
  }

  const goToPresent = () => chat.returnToPresent();

  return { onNearTop, onScrollState, jumpToMessage, goToPresent };
}
