import { defineStore } from "pinia";
import { watch } from "vue";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { useSystemStore } from "@/store/system/systemStore";
import { db, type CachedProfile } from "@/store/db/dexie";
import { onSessionReset, sessionEpoch } from "@/store/system/sessionLifecycle";
import type { ArgonUserProfile } from "@argon/glue";
import { FeatureFlagActivated, UserProfileUpdated } from "@argon/glue";
import { COSMETIC_FLAG_PREFIX } from "@/store/features/featureFlagsStore";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import type { Guid } from "@argon-chat/ion.webcore";

const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

export const useProfileCacheStore = defineStore("profileCache", () => {
  const pending = new Map<string, Promise<ArgonUserProfile>>();

  const api = useApi();
  const bus = useBus();
  const system = useSystemStore();

  // Outside a space — the friends list, a DM, a mention in a direct chat — there is nothing to
  // scope the profile to, and those rows get their own cache namespace.
  const GLOBAL_SCOPE = "@global";

  function cacheKey(spaceId: string | null, userId: string): string {
    return `${spaceId ?? GLOBAL_SCOPE}:${userId}`;
  }

  /**
   * PrefetchProfile is space-scoped and the transport rejects a null space id outright, so a
   * profile asked for outside a space goes through the space-less lookup instead. It carries no
   * archetypes, which is exactly right: there is no space for a member to hold a role in.
   */
  async function fetchProfile(spaceId: Guid | null, userId: Guid): Promise<ArgonUserProfile> {
    if (spaceId) return await api.serverInteraction.PrefetchProfile(spaceId, userId);

    const result = await api.userInteraction.LookupProfile(userId);
    if (result.isSuccessLookupProfile()) return result.profile;
    throw new Error(`Profile lookup for ${userId} failed`);
  }

  async function getProfile(spaceId: Guid | null, userId: Guid): Promise<ArgonUserProfile> {
    const key = cacheKey(spaceId, userId);

    // Check IndexedDB cache
    const cached = await db.profileCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.profile;
    }

    // Deduplicate in-flight requests
    const inflight = pending.get(key);
    if (inflight) return inflight;

    // Which account asked. A seamless switch swaps the API client and the Dexie database
    // underneath an in-flight request, and a reply fetched with the previous account's credentials
    // must not be written into the incoming account's cache.
    const askedIn = sessionEpoch.value;

    const promise = fetchProfile(spaceId, userId).then(async profile => {
      if (sessionEpoch.value !== askedIn) {
        pending.delete(key);
        return profile;
      }

      await db.profileCache.put({
        key,
        spaceId: spaceId ?? GLOBAL_SCOPE,
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

  /** Guids arrive from two calls and only agree about case by accident. */
  function idOf(value: unknown): string {
    return String(value).toLowerCase();
  }

  function movedOn(itemId: unknown, held: number | null | undefined, versionOf: ReadonlyMap<string, number>): boolean {
    // A server that does not send the version leaves nothing to compare, and guessing would mean
    // dropping every profile on every catalogue read.
    if (held === null || held === undefined) return false;

    const current = versionOf.get(idOf(itemId));

    return current !== undefined && current !== held;
  }

  function holdsStale(profile: ArgonUserProfile, versionOf: ReadonlyMap<string, number>): boolean {
    for (const worn of profile.cosmetics ?? []) {
      if (movedOn(worn.itemId, worn.version, versionOf)) return true;

      for (const option of worn.options ?? []) {
        if (movedOn(option.itemId, option.version, versionOf)) return true;
      }
    }

    return false;
  }

  /**
   * Drops the cached profiles whose worn cosmetics are older than the catalogue says they are.
   *
   * <b>Re-authoring a published cosmetic reaches nobody holding a cached profile.</b> The payload
   * travels with the person — that is what makes a member list one call instead of one per name —
   * so an operator who changes a frame's thickness changes nothing about anybody, no
   * <c>UserProfileUpdated</c> is raised, and every cached copy keeps rendering what was true when it
   * was fetched. For the lifetime of the cache, which is three hours, that reads as "I changed it
   * and half the people still see the old one".
   *
   * The version is the fix and it costs one comparison: the catalogue carries each row's authoring
   * number, the profile carries the one it was built from, and a disagreement names exactly the
   * profiles to drop. Which is why this is not <c>invalidateAll</c> — a catalogue read happens
   * whenever the picker opens, and clearing every profile each time would undo the cache.
   */
  async function invalidateStaleCosmetics(versionOf: ReadonlyMap<string, number>): Promise<string[]> {
    if (versionOf.size === 0) return [];

    const keys: string[] = [];
    const users = new Set<string>();

    await db.profileCache.each(row => {
      if (!holdsStale(row.profile, versionOf)) return;

      keys.push(row.key);
      users.add(row.userId);
    });

    if (keys.length === 0) return [];

    await db.profileCache.bulkDelete(keys);

    return [...users];
  }

  // Seamless account switch: drop in-flight profile fetches. The cached profiles live in the
  // per-account Dexie DB (swapped on switch), so there's nothing else to clear here.
  onSessionReset(() => {
    pending.clear();
  });

  // Subscribe to realtime event
  bus.onServerEvent<UserProfileUpdated>("UserProfileUpdated", (e) => {
    void (async () => {
      await updateProfile(e.spaceId, e.userId, e.profile);
      // The space-less copy of a profile is a different thing — no archetypes — so a space-scoped
      // payload cannot stand in for it. Drop it and let the next read fetch its own.
      await db.profileCache.delete(cacheKey(null, e.userId));

      // The member list and the message list read cosmetics from their own in-memory batch rather
      // than from here, and nothing else would tell them this person changed.
      useCosmeticsStore().forgetWorn(e.userId);
    })();
  });

  // Invalidate cache after long reconnect
  watch(() => system.isLongReconnecting, (val, oldVal) => {
    if (oldVal && !val) {
      invalidateAll();
    }
  });

  /**
   * An operator switching a cosmetic kind off changes what every cached profile should render, and
   * nothing about the profiles themselves — so no UserProfileUpdated arrives for any of them. Without
   * this, a kind pulled because it was a mistake would keep showing for up to the cache lifetime,
   * which is three hours.
   *
   * Clearing everything is deliberate: the flag says nothing about which people are affected, and a
   * cache miss costs one fetch on the next card that opens.
   */
  bus.onServerEvent<FeatureFlagActivated>("FeatureFlagActivated", (e) => {
    if (!e.flagId.startsWith(COSMETIC_FLAG_PREFIX)) return;

    void invalidateAll();
    useCosmeticsStore().forgetWorn();
  });

  return {
    getProfile,
    updateProfile,
    invalidateAll,
    invalidateUser,
    invalidateStaleCosmetics,
  };
});
