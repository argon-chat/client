import { logger } from "@/lib/logger";
import { computedAsync } from "@vueuse/core";
import { useObservable } from "@vueuse/rxjs";
import { liveQuery } from "dexie";
import { defineStore } from "pinia";
import { BehaviorSubject, from, of, switchMap } from "rxjs";
import { type Ref, computed, ref, watch } from "vue";
import { useApi } from "./apiStore";
import { type RealtimeUser, db } from "./db/dexie";
import {
  type ArgonUser,
  UserStatus,
  type UserActivityPresence,
} from "@/lib/glue/argonChat";
import type { Guid } from "@argon-chat/ion.webcore";

export interface MentionUser {
  id: string;
  displayName: string;
  username: string;
}

/**
 * Store for managing users
 */
export const useUserStore = defineStore("user", () => {
  const api = useApi();

  /**
   * Get user by ID
   */
  const getUser = async (userId: Guid): Promise<RealtimeUser | undefined> => {
    const result = await db.users.where("userId").equals(userId).first();
    if (result) {
      return result;
    }

    // echo bot
    if (userId === "44444444-2222-1111-2222-444444444444") {
      await trackUser({
        avatarFileId: "echo-avatar.png",
        displayName: "Echo",
        userId: userId,
        username: "echo",
      });
      return await db.users.where("userId").equals(userId).first();
    }

    return undefined;
  };

  /**
   * Get users by server member IDs
   */
  const getUsersByServerMemberIds = (serverId: Guid, memberIds: Guid[]) => {
    return liveQuery(async () => {
      const members = await db.members
        .where("[memberId+spaceId]")
        .anyOf(memberIds.map((id) => [id, serverId] as [Guid, Guid]))
        .toArray();
      const userIds = members.map((m) => m.userId);
      const users = await db.users.where("userId").anyOf(userIds).toArray();
      return users;
    });
  };

  /**
   * Reactive user
   */
  function getUserReactive(userId: Ref<string | undefined>) {
    const userId$ = new BehaviorSubject<string | undefined>(userId.value);

    watch(userId, (id) => {
      userId$.next(id);
    });

    const user$ = userId$.pipe(
      switchMap((id) => {
        if (!id) return of(null);
        return liveQuery(() => db.users.where("userId").equals(id).first());
      })
    );

    return useObservable(user$);
  }

  /**
   * Search users for mentions
   */
  async function searchMentions(query: string): Promise<MentionUser[]> {
    const normalized = query.toLowerCase();
    return await db.users
      .filter((user: RealtimeUser) => {
        return (
          user.username.toLowerCase().includes(normalized) ||
          user.displayName.toLowerCase().includes(normalized)
        );
      })
      .limit(10)
      .toArray()
      .then((users) =>
        users.map((u) => ({
          id: u.userId,
          displayName: u.displayName,
          username: u.username,
        }))
      );
  }

  /**
   * Search users
   */
  async function searchUser(query: string): Promise<RealtimeUser[]> {
    const normalized = query.toLowerCase();
    return await db.users
      .filter((user: RealtimeUser) => {
        return (
          user.username.toLowerCase().includes(normalized) ||
          user.displayName.toLowerCase().includes(normalized)
        );
      })
      .limit(10)
      .toArray();
  }

  /**
   * Add/update user in DB
   */
  const trackUser = async (
    user: ArgonUser,
    extendedStatus: UserStatus | null = null,
    extendedActivity: UserActivityPresence | null = null
  ) => {
    const exist = await db.users.get(user.userId);
    if (exist) {
      await db.users.update(exist.userId, {
        ...user,
        status: extendedStatus ? extendedStatus : exist.status,
        activity:
          extendedActivity ??
          (extendedStatus || exist.status === UserStatus.Offline
            ? undefined
            : exist.activity),
      });
      return;
    }
    await db.users.put(
      {
        ...user,
        status: extendedStatus ?? UserStatus.Offline,
        activity: extendedActivity ?? undefined,
      },
      user.userId
    );
  };

  /**
   * Update user status
   */
  const updateUserStatus = async (userId: Guid, status: UserStatus) => {
    const user = await db.users.get(userId);
    if (!user) return;

    user.status = status;
    if (status === UserStatus.Offline && user.activity) {
      user.activity = undefined;
    }

    await db.users.put(user);
  };

  /**
   * Update user activity
   */
  const updateUserActivity = async (
    userId: Guid,
    activity: UserActivityPresence | undefined
  ) => {
    const user = await db.users.get(userId);
    if (!user) return;

    user.activity = activity;
    await db.users.put(user);
  };

  /**
   * Reset all users to Offline status (on reconnect)
   */
  const resetAllUsersToOffline = async () => {
    await db.transaction("rw", db.users, async () => {
      await db.users
        .where("status")
        .notEqual(UserStatus.Offline)
        .modify((user) => {
          user.status = UserStatus.Offline;
        });
    });
  };

  /**
   * Debug: получить пользователей с пагинацией
   */
  const debug_getAllUser = async (offset: number, limit: number) =>
    await db.users.offset(offset).limit(limit).toArray();

  return {
    getUser,
    getUsersByServerMemberIds,
    getUserReactive,
    searchMentions,
    searchUser,
    trackUser,
    updateUserStatus,
    updateUserActivity,
    resetAllUsersToOffline,
    debug_getAllUser,
  };
});
