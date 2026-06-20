import { defineStore } from "pinia";
import { ref } from "vue";
import type { UserChat } from "@argon/glue";
import type { DateTimeOffset, Guid } from "@argon-chat/ion.webcore";
import { usePoolStore } from "@/store/data/poolStore";
import { RealtimeUser } from "@/store/db/dexie";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { logger } from "@argon/core";

function toTsDate(dto: DateTimeOffset | null | undefined): number {
  if (!dto) return 0;
  return dto.date.getTime() - dto.offsetMinutes * 60_000;
}

export interface RecentChatVm {
  peerId: Guid;
  displayName: string;
  status: number;

  isPinned: boolean;
  pinnedAt: DateTimeOffset | null;

  lastMsg: string | null;
  lastMessageAt: DateTimeOffset;

  unreadCount: number;
}

export const useRecentChatsStore = defineStore("recentChatsStore", () => {
  const recent = ref<RecentChatVm[]>([]);
  const pool = usePoolStore();

  // Seamless account switch: clear DM list for the incoming account.
  onSessionReset(() => {
    recent.value = [];
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
    
    const duration = performance.now() - start;
    logger.debug(`[RecentChatsStore] Loaded ${items.length} chats in ${duration.toFixed(0)}ms`);
    
    recent.value = items.sort(sorter);
  }

  async function upsert(chat: UserChat) {
    const vm = await mergeUserInfo(chat);

    const idx = recent.value.findIndex((x) => x.peerId === chat.peerId);
    if (idx !== -1) {
      // Update in place and re-sort only if ordering properties changed
      const existing = recent.value[idx];
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
    pinnedAt: DateTimeOffset | null
  ) {
    const chat = recent.value.find((x) => x.peerId === peerId);
    if (!chat) return;

    if (chat.isPinned === value) return;

    chat.isPinned = value;
    chat.pinnedAt = value ? pinnedAt : null;
    recent.value.sort(sorter);
  }

  function markRead(peerId: string) {
    const chat = recent.value.find((x) => x.peerId === peerId);
    if (chat) chat.unreadCount = 0;
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
  };
});
