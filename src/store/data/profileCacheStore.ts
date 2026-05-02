import { defineStore } from "pinia";
import { watch } from "vue";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { useSystemStore } from "@/store/system/systemStore";
import { db, type CachedProfile } from "@/store/db/dexie";
import type { ArgonUserProfile } from "@argon/glue";
import { UserProfileUpdated } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

export const useProfileCacheStore = defineStore("profileCache", () => {
  const pending = new Map<string, Promise<ArgonUserProfile>>();

  const api = useApi();
  const bus = useBus();
  const system = useSystemStore();

  function cacheKey(spaceId: string, userId: string): string {
    return `${spaceId}:${userId}`;
  }

  async function getProfile(spaceId: Guid, userId: Guid): Promise<ArgonUserProfile> {
    const key = cacheKey(spaceId, userId);

    // Check IndexedDB cache
    const cached = await db.profileCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.profile;
    }

    // Deduplicate in-flight requests
    const inflight = pending.get(key);
    if (inflight) return inflight;

    const promise = api.serverInteraction.PrefetchProfile(spaceId, userId).then(async profile => {
      await db.profileCache.put({
        key,
        spaceId,
        userId,
        profile,
        fetchedAt: Date.now(),
      });
      pending.delete(key);
      return profile;
    }).catch(err => {
      pending.delete(key);
      throw err;
    });

    pending.set(key, promise);
    return promise;
  }

  async function updateProfile(spaceId: string, userId: string, profile: ArgonUserProfile) {
    const key = cacheKey(spaceId, userId);
    await db.profileCache.put({
      key,
      spaceId,
      userId,
      profile,
      fetchedAt: Date.now(),
    });
  }

  async function invalidateAll() {
    await db.profileCache.clear();
  }

  async function invalidateUser(userId: string) {
    await db.profileCache.where("userId").equals(userId).delete();
  }

  // Subscribe to realtime event
  bus.onServerEvent<UserProfileUpdated>("UserProfileUpdated", (e) => {
    updateProfile(e.spaceId, e.userId, e.profile);
  });

  // Invalidate cache after long reconnect
  watch(() => system.isLongReconnecting, (val, oldVal) => {
    if (oldVal && !val) {
      invalidateAll();
    }
  });

  return {
    getProfile,
    updateProfile,
    invalidateAll,
    invalidateUser,
  };
});
