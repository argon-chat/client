import { defineStore } from "pinia";
import { ref } from "vue";
import type { UserChat } from "@/lib/glue/argonChat";
import type { DateTimeOffset, Guid } from "@argon-chat/ion.webcore";
import { usePoolStore } from "@/store/poolStore";
import { RealtimeUser } from "./db/dexie";
import { logger } from "@/lib/logger";

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
    const items = [];
    for (const chat of list) {
      items.push(await mergeUserInfo(chat));
    }
    recent.value = items.sort(sorter);
  }

  async function upsert(chat: UserChat) {
    const vm = await mergeUserInfo(chat);

    const idx = recent.value.findIndex((x) => x.peerId === chat.peerId);
    if (idx !== -1) {
      recent.value.splice(idx, 1);
    }

    recent.value.unshift(vm);
    recent.value.sort(sorter);
  }

  function markPinned(
    peerId: string,
    value: boolean,
    pinnedAt: DateTimeOffset | null
  ) {
    const chat = recent.value.find((x) => x.peerId === peerId);
    if (!chat) return;

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
