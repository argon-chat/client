import { defineStore } from "pinia";
import { ref } from "vue";
import { logger } from "@argon/core";
import type {
  FriendRequestAcceptedEvent,
  FriendshipRemovedEvent,
  UserBlockedEvent,
  UserUnblockedEvent,
  UserIgnoredEvent,
  UserUnignoredEvent,
} from "@argon/glue";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { onSessionReset } from "@/store/system/sessionLifecycle";

/**
 * Who is a friend, who is blocked, who is ignored — as sets of ids, for the places that need a
 * yes/no about one person (a context menu, a badge on a row) rather than the full lists the
 * Friends page renders. Loaded on first use and kept current by the bus, so a second window
 * agrees with the first.
 */
export const useFriendsStore = defineStore("friends", () => {
  const api = useApi();
  const bus = useBus();

  const friends = ref(new Set<string>());
  const blocked = ref(new Set<string>());
  const ignored = ref(new Set<string>());
  const loaded = ref(false);
  let loading: Promise<void> | null = null;
  let subscribed = false;

  onSessionReset(() => {
    friends.value = new Set();
    blocked.value = new Set();
    ignored.value = new Set();
    loaded.value = false;
    loading = null;
  });

  // The bus outlives any one sign-in, so subscribe once for the life of the store.
  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    bus.onServerEvent<FriendRequestAcceptedEvent>("FriendRequestAcceptedEvent", (e) => friends.value.add(e.userId));
    bus.onServerEvent<FriendshipRemovedEvent>("FriendshipRemovedEvent", (e) => friends.value.delete(e.userId));
    bus.onServerEvent<UserBlockedEvent>("UserBlockedEvent", (e) => {
      blocked.value.add(e.blockId);
      friends.value.delete(e.blockId);
    });
    bus.onServerEvent<UserUnblockedEvent>("UserUnblockedEvent", (e) => blocked.value.delete(e.blockId));
    bus.onServerEvent<UserIgnoredEvent>("UserIgnoredEvent", (e) => ignored.value.add(e.ignoredId));
    bus.onServerEvent<UserUnignoredEvent>("UserUnignoredEvent", (e) => ignored.value.delete(e.ignoredId));
  }

  /** Load the three lists once; concurrent callers share the same request. */
  function ensureLoaded(): Promise<void> {
    subscribe();
    if (loaded.value) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
      try {
        const [f, b, i] = await Promise.all([
          api.freindsInteraction.GetMyFriendships(500, 0),
          api.freindsInteraction.GetBlockList(500, 0),
          api.freindsInteraction.GetIgnoreList(500, 0),
        ]);
        friends.value = new Set(Array.from(f, (x) => x.friendId));
        blocked.value = new Set(Array.from(b, (x) => x.blockedId));
        ignored.value = new Set(Array.from(i, (x) => x.ignoredId));
        loaded.value = true;
      } catch (e) {
        logger.error("[FriendsStore] load failed", e);
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  const isFriend = (userId: string) => friends.value.has(userId);
  const isBlocked = (userId: string) => blocked.value.has(userId);
  const isIgnored = (userId: string) => ignored.value.has(userId);

  // The sets are updated here as well as by the event, so the menu that triggered the action
  // reads the new state on its next open without waiting for the round trip back.
  async function removeFriend(userId: string) {
    await api.freindsInteraction.RemoveFriend(userId);
    friends.value.delete(userId);
  }

  async function block(userId: string) {
    await api.freindsInteraction.BlockUser(userId);
    blocked.value.add(userId);
    friends.value.delete(userId);
  }

  async function unblock(userId: string) {
    await api.freindsInteraction.UnblockUser(userId);
    blocked.value.delete(userId);
  }

  async function ignore(userId: string) {
    await api.freindsInteraction.IgnoreUser(userId);
    ignored.value.add(userId);
  }

  async function unignore(userId: string) {
    await api.freindsInteraction.UnignoreUser(userId);
    ignored.value.delete(userId);
  }

  return {
    friends,
    blocked,
    ignored,
    loaded,
    ensureLoaded,
    isFriend,
    isBlocked,
    isIgnored,
    removeFriend,
    block,
    unblock,
    ignore,
    unignore,
  };
});
