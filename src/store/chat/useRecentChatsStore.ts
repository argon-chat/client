import { defineStore } from "pinia";
import { ref } from "vue";
import type { UserChat } from "@argon/glue";
import type { Guid, IonDateTime } from "@argon-chat/ion.webcore";
import { usePoolStore } from "@/store/data/poolStore";
import { RealtimeUser } from "@/store/db/dexie";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { logger } from "@argon/core";

/**
 * Sort key only: milliseconds since the epoch, UTC.
 *
 * `unixTicks` is already offset-normalised, which is what the old
 * `date.getTime() - offsetMinutes * 60_000` was reaching for by hand — so ordering no longer
 * depends on every chat carrying the same offset. 100ns ticks are divided down to milliseconds
 * to stay inside the safe integer range; two chats within the same millisecond keep their
 * relative order from the previous comparison, which is all this needs.
 */
function toTsDate(dto: IonDateTime | null | undefined): number {
  if (!dto) return 0;
  return Number(dto.unixTicks / 10_000n);
}

export interface RecentChatVm {
  peerId: Guid;
  displayName: string;
  status: number;

  isPinned: boolean;
  pinnedAt: IonDateTime | null;

  lastMsg: string | null;
  lastMessageAt: IonDateTime;

  unreadCount: number;
}

export const useRecentChatsStore = defineStore("recentChatsStore", () => {
  const recent = ref<RecentChatVm[]>([]);
  const pool = usePoolStore();

  /**
   * A first message from someone you have never talked to arrives as two events, in no fixed order:
   * one that says the conversation moved (and creates the row) and one that says who spoke. Counts
   * that land before the row exists wait here for it.
   */
  const pendingUnread = new Map<Guid, number>();

  // Seamless account switch: clear DM list for the incoming account.
  onSessionReset(() => {
    recent.value = [];
    pendingUnread.clear();
  });

  async function mergeUserInfo(chat: UserChat): Promise<RecentChatVm> {
    const user: RealtimeUser | undefined = await pool.getUser(chat.peerId);

    return {
      peerId: chat.peerId,
      displayName: user?.displayName ?? chat.peerId,
      status: user?.status ?? 0,

      isPinned: chat.isPinned,
      pinnedAt: chat.pinnedAt,

      lastMsg: chat.lastMsg ?? null,
      lastMessageAt: chat.lastMessageAt,

      unreadCount: chat.unreadCount ?? 0,
    };
  }

  async function setChats(list: UserChat[]) {
    logger.debug(`[RecentChatsStore] Loading ${list.length} chats...`);
    const start = performance.now();

    // Whatever was buffered before the snapshot was asked for is already counted inside it.
    pendingUnread.clear();
    
    const userIds = list.map(chat => chat.peerId);
    const usersMap = await pool.getUsersBatch(userIds);
    
    const items = list.map(chat => {
      const user = usersMap.get(chat.peerId);
      return {
        peerId: chat.peerId,
        displayName: user?.displayName ?? chat.peerId,
        status: user?.status ?? 0,
        isPinned: chat.isPinned,
        pinnedAt: chat.pinnedAt,
        lastMsg: chat.lastMsg ?? null,
        lastMessageAt: chat.lastMessageAt,
        unreadCount: chat.unreadCount ?? 0,
      };
    });
    
    // Decorating the snapshot is asynchronous, and events do not wait for it. Anything that landed
    // while it was in flight is not in the server's counts, so it is folded in here rather than
    // dropped with the buffer — and a conversation that exists only because of one of those events
    // survives the replacement instead of being wiped by it.
    for (const item of items) {
      const buffered = pendingUnread.get(item.peerId);
      if (!buffered) continue;
      pendingUnread.delete(item.peerId);
      item.unreadCount += buffered;
    }

    const inSnapshot = new Set(items.map((x) => x.peerId));
    for (const existing of recent.value) {
      if (!inSnapshot.has(existing.peerId)) items.push(existing);
    }

    const duration = performance.now() - start;
    logger.debug(`[RecentChatsStore] Loaded ${items.length} chats in ${duration.toFixed(0)}ms`);
    
    recent.value = items.sort(sorter);
  }

  async function upsert(chat: UserChat) {
    const vm = await mergeUserInfo(chat);

    const idx = recent.value.findIndex((x) => x.peerId === chat.peerId);
    const existing = idx !== -1 ? recent.value[idx] : undefined;

    // The payload's count was read before this method awaited; a bump that landed since then lives
    // on the committed row, so that — not the stale capture — is what carries forward.
    if (existing) vm.unreadCount = existing.unreadCount;

    const buffered = pendingUnread.get(chat.peerId);
    if (buffered) {
      pendingUnread.delete(chat.peerId);
      vm.unreadCount += buffered;
    }

    if (existing) {
      // Update in place and re-sort only if ordering properties changed
      const orderChanged = existing.isPinned !== vm.isPinned 
        || toTsDate(existing.pinnedAt) !== toTsDate(vm.pinnedAt)
        || toTsDate(existing.lastMessageAt) !== toTsDate(vm.lastMessageAt);
      
      recent.value[idx] = vm;
      if (orderChanged) {
        recent.value.sort(sorter);
      }
    } else {
      // Insert at correct sorted position
      const insertIdx = recent.value.findIndex((x) => sorter(vm, x) <= 0);
      if (insertIdx === -1) {
        recent.value.push(vm);
      } else {
        recent.value.splice(insertIdx, 0, vm);
      }
    }
  }

  function markPinned(
    peerId: string,
    value: boolean,
    pinnedAt: IonDateTime | null
  ) {
    const chat = recent.value.find((x) => x.peerId === peerId);
    if (!chat) return;

    if (chat.isPinned === value) return;

    chat.isPinned = value;
    chat.pinnedAt = value ? pinnedAt : null;
    recent.value.sort(sorter);
  }

  function markRead(peerId: string) {
    pendingUnread.delete(peerId);
    const chat = recent.value.find((x) => x.peerId === peerId);
    if (chat) chat.unreadCount = 0;
  }

  /**
   * RecentChatUpdatedEvent says a conversation moved, not who spoke — it is raised for the owner of
   * the list either way. DirectMessageSent is the one that knows the direction, so that is what
   * drives the unread count.
   */
  function bumpUnread(peerId: string) {
    const chat = recent.value.find((x) => x.peerId === peerId);
    if (chat) {
      chat.unreadCount += 1;
      return;
    }
    pendingUnread.set(peerId, (pendingUnread.get(peerId) ?? 0) + 1);
  }

  function sorter(a: RecentChatVm, b: RecentChatVm): number {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    if (a.isPinned && b.isPinned) {
      return toTsDate(b.pinnedAt) - toTsDate(a.pinnedAt);
    }

    return toTsDate(b.lastMessageAt) - toTsDate(a.lastMessageAt);
  }

  return {
    recent,
    setChats,
    upsert,
    markPinned,
    markRead,
    bumpUnread,
  };
});
