import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type {
  UserChat,
  RecentChatUpdatedEvent,
  DirectMessageSent,
  ChatDeletedEvent,
  ChatPinnedEvent,
  ChatUnpinnedEvent,
  ChatReadEvent,
} from "@argon/glue";
import type { Guid, IonDateTime } from "@argon-chat/ion.webcore";
import { usePoolStore } from "@/store/data/poolStore";
import { useFriendsStore } from "@/store/data/friendsStore";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { useMe } from "@/store/auth/meStore";
import { RealtimeUser } from "@/store/db/dexie";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { logger } from "@argon/core";

const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

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

  /**
   * Peers whose row was created or touched by an event while a snapshot was being decorated. The
   * snapshot cannot know about them, so they outrank its silence; anything else it does not list
   * is gone for real.
   */
  const touchedInFlight = new Set<string>();
  let loadsInFlight = 0;

  /** The list has come from the server at least once; until then the server's own DM count stands in. */
  const loaded = ref(false);

  /** The chat on screen with its newest message in view: what arrives there is read on arrival. */
  const viewingPeer = ref<string | null>(null);

  /** Chats read here whose server-side count still has to be cleared, one call per burst. */
  const serverReads = new Map<string, ReturnType<typeof setTimeout>>();

  /** Conversations with something unread — the unit the server counts in, and what the badges show. */
  const unreadConversations = computed(() => recent.value.filter((c) => c.unreadCount > 0).length);

  // Seamless account switch: clear DM list for the incoming account.
  onSessionReset(() => {
    recent.value = [];
    pendingUnread.clear();
    loaded.value = false;
    viewingPeer.value = null;
    for (const timer of serverReads.values()) clearTimeout(timer);
    serverReads.clear();
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
    touchedInFlight.clear();
    loadsInFlight++;
    try {
      await applySnapshot(list);
    } finally {
      loadsInFlight--;
    }
  }

  async function applySnapshot(list: UserChat[]) {
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

    // Only rows the snapshot could not know about yet survive it: one created or touched by an
    // event that landed while the request was in flight, or a count still waiting above. Carrying
    // every missing row over made the list grow for the whole session — a conversation removed on
    // the server was re-appended on every resync and never went away.
    const inSnapshot = new Set(items.map((x) => x.peerId));
    for (const existing of recent.value) {
      if (inSnapshot.has(existing.peerId)) continue;
      const bornInFlight = pendingUnread.has(existing.peerId) || touchedInFlight.has(existing.peerId);
      if (bornInFlight) items.push(existing);
    }

    const duration = performance.now() - start;
    logger.debug(`[RecentChatsStore] Loaded ${items.length} chats in ${duration.toFixed(0)}ms`);
    
    recent.value = items.sort(sorter);
  }

  async function upsert(chat: UserChat) {
    if (loadsInFlight > 0) touchedInFlight.add(chat.peerId);
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

  /** Clears the row here only: the server already knows (ChatReadEvent), or readChat tells it. */
  function markRead(peerId: string) {
    pendingUnread.delete(peerId);
    const chat = recent.value.find((x) => x.peerId === peerId);
    if (chat) chat.unreadCount = 0;
  }

  async function load() {
    const list = await useApi().userChatInteractions.GetRecentChats(50, 0);
    await setChats(list);
    loaded.value = true;
  }

  function markReadOnServer(peerId: string) {
    if (serverReads.has(peerId)) return;
    serverReads.set(peerId, setTimeout(() => {
      serverReads.delete(peerId);
      useApi().userChatInteractions.MarkChatRead(peerId as Guid).catch((e) =>
        logger.warn("[RecentChatsStore] MarkChatRead failed", e));
    }, 1000));
  }

  /**
   * The user has seen the chat: the row clears now and the server's count with it. The server is
   * asked only when there is something to clear — this runs on every scroll pass at the bottom.
   */
  function readChat(peerId: string) {
    const owed = (recent.value.find((x) => x.peerId === peerId)?.unreadCount ?? 0) > 0 || pendingUnread.has(peerId);
    markRead(peerId);
    if (owed) markReadOnServer(peerId);
  }

  /** Which chat is on screen with its newest message in view; null when none is. */
  function setViewing(peerId: string | null) {
    viewingPeer.value = peerId;
    if (peerId && isVisible()) readChat(peerId);
  }

  let listening = false;

  /** Once per session, from the event store: the list keeps counting whichever view is open. */
  function listen() {
    if (listening) return;
    listening = true;
    const bus = useBus();

    bus.onServerEvent<RecentChatUpdatedEvent>("RecentChatUpdatedEvent", (e) => {
      const existing = recent.value.find((x) => x.peerId === e.peerId);
      void upsert({
        peerId: e.peerId,
        lastMsg: e.lastMessage,
        lastMessageAt: e.lastMessageAt,
        isPinned: existing?.isPinned ?? false,
        pinnedAt: existing?.pinnedAt ?? null,
        // The event carries no count; upsert keeps whatever the committed row already had.
        unreadCount: 0,
        userId: e.userId,
      });
    });

    // Both directions move the conversation to the top, and a first message from someone new is what
    // creates its row: the server sends nothing else for a direct message.
    bus.onServerEvent<DirectMessageSent>("DirectMessageSent", (e) => {
      const myId = useMe().me?.userId;
      if (!myId || (e.receiverId !== myId && e.senderId !== myId)) return;
      const incoming = e.receiverId === myId;
      const peerId = incoming ? e.senderId : e.receiverId;
      const existing = recent.value.find((x) => x.peerId === peerId);
      void upsert({
        peerId,
        lastMsg: e.message.text.length > 200 ? e.message.text.slice(0, 200) : e.message.text,
        lastMessageAt: e.message.createdAt,
        isPinned: existing?.isPinned ?? false,
        pinnedAt: existing?.pinnedAt ?? null,
        unreadCount: 0,
        userId: myId,
      });

      if (!incoming) return;
      // An ignored sender's message arrives but does not count, matching the server's count.
      if (useFriendsStore().isIgnored(e.senderId)) return;
      if (viewingPeer.value === e.senderId && isVisible()) {
        // Counted by the server all the same, so it is cleared there too.
        markReadOnServer(e.senderId);
        return;
      }
      bumpUnread(e.senderId);
    });

    bus.onServerEvent<ChatDeletedEvent>("ChatDeletedEvent", (e) => removeChat(e.peerId));
    bus.onServerEvent<ChatPinnedEvent>("ChatPinnedEvent", (e) => markPinned(e.peerId, true, e.pinnedAt));
    bus.onServerEvent<ChatUnpinnedEvent>("ChatUnpinnedEvent", (e) => markPinned(e.peerId, false, null));
    // Read in another window or on another device.
    bus.onServerEvent<ChatReadEvent>("ChatReadEvent", (e) => markRead(e.peerId));

    // Back from a minimised window: the chat on screen is read now, not when it arrived.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (isVisible() && viewingPeer.value) readChat(viewingPeer.value);
      });
    }
  }

  /** The chat left this account's list (deleted here or in another window). */
  function removeChat(peerId: string) {
    pendingUnread.delete(peerId);
    recent.value = recent.value.filter((x) => x.peerId !== peerId);
  }

  /**
   * RecentChatUpdatedEvent says a conversation moved, not who spoke — it is raised for the owner of
   * the list either way. DirectMessageSent is the one that knows the direction, so that is what
   * drives the unread count.
   */
  function bumpUnread(peerId: string) {
    if (loadsInFlight > 0) touchedInFlight.add(peerId);
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
    loaded,
    viewingPeer,
    unreadConversations,
    load,
    listen,
    setChats,
    upsert,
    markPinned,
    markRead,
    readChat,
    setViewing,
    removeChat,
    bumpUnread,
  };
});
