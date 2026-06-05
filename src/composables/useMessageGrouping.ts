import { computed, type ShallowRef } from "vue";
import type { ChatMessage } from "@/composables/useChatMessages";

/** Max gap between two messages from the same sender to still group them. */
const GROUP_GAP_MS = 5 * 60 * 1000;

export interface GroupMeta {
  /** This message continues the previous sender's group (no avatar/name). */
  isGrouped: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  /** Show a date separator above this message. */
  showDate: boolean;
  /** Show the "new messages" separator above this message (channels only). */
  showUnread: boolean;
}

export interface MessageGroupingOptions {
  /**
   * Reactive getter for the last-read message id. When provided, an unread
   * separator is placed immediately after that message. DMs omit this.
   */
  lastReadId?: () => bigint | null | undefined;
}

function isSameDay(a?: Date, b?: Date): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Derive per-message visual metadata (date separators, sender grouping, unread
 * line) from a message list. Shared by ChatView (channels) and DmChatView.
 */
export function useMessageGrouping(
  messages: ShallowRef<ChatMessage[]>,
  opts: MessageGroupingOptions = {},
) {
  const groupingMap = computed<GroupMeta[]>(() => {
    const msgs = messages.value;
    const len = msgs.length;
    const out: GroupMeta[] = new Array(len);
    const lastReadId = opts.lastReadId?.();
    let unreadPlaced = false;

    for (let i = 0; i < len; i++) {
      const msg = msgs[i];
      const prev = i > 0 ? msgs[i - 1] : null;

      // Date separator: first message or a new calendar day.
      const showDate = i === 0 || !isSameDay(prev?.timeSent?.date, msg?.timeSent?.date);

      // Unread line: immediately after the last read message.
      let showUnread = false;
      if (
        !unreadPlaced &&
        lastReadId != null &&
        i > 0 &&
        prev?.messageId === lastReadId &&
        !msg._optimistic
      ) {
        showUnread = true;
        unreadPlaced = true;
      }

      if (!msg?.sender) {
        out[i] = { isGrouped: false, isFirstInGroup: true, isLastInGroup: true, showDate, showUnread };
        continue;
      }

      const next = i < len - 1 ? msgs[i + 1] : null;

      const samePrev =
        !!prev?.sender &&
        prev.sender === msg.sender &&
        !prev._optimistic &&
        !!msg.timeSent?.date &&
        !!prev.timeSent?.date &&
        Math.abs(msg.timeSent.date.getTime() - prev.timeSent.date.getTime()) < GROUP_GAP_MS &&
        !showDate &&
        !showUnread;

      const sameNext =
        !!next?.sender &&
        next.sender === msg.sender &&
        !msg._optimistic &&
        !!msg.timeSent?.date &&
        !!next.timeSent?.date &&
        Math.abs(next.timeSent.date.getTime() - msg.timeSent.date.getTime()) < GROUP_GAP_MS;

      out[i] = {
        isGrouped: samePrev,
        isFirstInGroup: !samePrev,
        isLastInGroup: !sameNext,
        showDate,
        showUnread,
      };
    }
    return out;
  });

  return { groupingMap };
}
