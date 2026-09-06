import { logger } from "@argon/core";
import { computedAsync } from "@vueuse/core";
import { useObservable } from "@vueuse/rxjs";
import { liveQuery, type Subscription } from "dexie";
import { defineStore } from "pinia";
import { from, shareReplay } from "rxjs";
import { type Ref, computed, ref, watch, type ComputedRef, reactive } from "vue";
import { useApi } from "@/store/system/apiStore";
import { type RealtimeUser, db } from "@/store/db/dexie";
import { onSessionReset, sessionEpoch } from "@/store/system/sessionLifecycle";
import {
  type ArgonUser,
  UserStatus,
  type UserActivityPresence,
} from "@argon/glue";
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

  // Cache for reactive user queries - one subscription per userId
  const reactiveUserCache = new Map<string, { subscription: Subscription; ref: Ref<RealtimeUser | undefined>; lastAccessed: number }>();
  const MAX_REACTIVE_SUBSCRIPTIONS = 50;

  // In-memory cache for getUser (TTL 5 sec)
  const userCache = new Map<string, { user: RealtimeUser | undefined; timestamp: number }>();
  const USER_CACHE_TTL = 5000; // 5 seconds
  const REQUEST_TIMEOUT = 10000; // 10 seconds timeout for requests

  // Deduplication of parallel requests
  const pendingRequests = new Map<string, Promise<RealtimeUser | undefined>>();
  const requestTimestamps = new Map<string, number>();
  
  // Throttling for IndexedDB - limit on parallel requests
  const MAX_PARALLEL_REQUESTS = 20;
  let activeRequests = 0;
  const requestQueue: Array<() => void> = [];

  // Ignored users - users that failed to fetch from server
  const ignoredUsers = new Set<Guid>();
  // One id per unresolvable user seen, only ever cleared on account switch — bounded here so a busy
  // space with many departed users cannot grow it for the whole session.
  const MAX_IGNORED_USERS = 5000;
  function rememberIgnored(userId: Guid) {
    if (ignoredUsers.size >= MAX_IGNORED_USERS) ignoredUsers.clear();
    ignoredUsers.add(userId);
  }

  // Lookups in flight, so several callers wanting the same unknown user share one request
  const pendingLookups = new Map<Guid, Promise<RealtimeUser | undefined>>();
  const LOOKUP_BATCH = 10;

  // What the newest status event for a user carried, and in which order it arrived. Kept only
  // while a lookup for that user is in flight, which is the only window in which a status can be
  // written out of order: `updateUserStatus` has to wait for the row to exist, and by the time it
  // does, the status it waited with may be two events old. Whoever finishes the row finishes it
  // with what arrived LAST, and this is where "last" is recorded.
  const latestStatus = new Map<Guid, { seq: number; status: UserStatus }>();
  let statusSeq = 0;

  // Seamless account switch: drop all live user subscriptions (bound to the old DB) and caches.
  onSessionReset(() => {
    for (const entry of reactiveUserCache.values()) {
      try { entry.subscription.unsubscribe(); } catch { /* ignore */ }
    }
    reactiveUserCache.clear();
    userCache.clear();
    pendingRequests.clear();
    requestTimestamps.clear();
    pendingLookups.clear();
    latestStatus.clear();
    ignoredUsers.clear();
  });

  // Diagnostics - make reactive!
  const diagnostics = reactive({
    totalSubscriptionsCreated: 0,
    totalQueriesExecuted: 0,
    slowQueries: [] as { operation: string; duration: number; timestamp: number }[],
    maxSlowQueries: 50,
    criticalQueries: 0, // >1000ms
    errorCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    deduplicatedRequests: 0,
  });

  /**
   * Get diagnostics info
   */
  const getDiagnostics = () => {
    return {
      activeSubscriptions: reactiveUserCache.size,
      totalSubscriptionsCreated: diagnostics.totalSubscriptionsCreated,
      totalQueriesExecuted: diagnostics.totalQueriesExecuted,
      slowQueries: diagnostics.slowQueries,
      criticalQueries: diagnostics.criticalQueries,
      errorCount: diagnostics.errorCount,
      cacheHits: diagnostics.cacheHits,
      cacheMisses: diagnostics.cacheMisses,
      cacheHitRate: diagnostics.totalQueriesExecuted > 0 
        ? ((diagnostics.cacheHits / diagnostics.totalQueriesExecuted) * 100).toFixed(1) + '%'
        : '0%',
      deduplicatedRequests: diagnostics.deduplicatedRequests,
      cacheSize: userCache.size,
      pendingRequests: pendingRequests.size,
      activeRequests,
      queuedRequests: requestQueue.length,
    };
  };

  /**
   * Log slow query
   */
  const logSlowQuery = (operation: string, duration: number, caller?: string) => {
    if (duration > 100) { // Log queries > 100ms
      if (caller) {
        logger.warn(`[UserStore] Slow query: ${operation} took ${duration}ms\n📞 Called from:\n${caller}`);
      } else {
        logger.warn(`[UserStore] Slow query: ${operation} took ${duration}ms`);
      }
      diagnostics.slowQueries.push({ operation, duration, timestamp: Date.now() });
      if (diagnostics.slowQueries.length > diagnostics.maxSlowQueries) {
        diagnostics.slowQueries.shift();
      }
      
      if (duration > 1000) {
        diagnostics.criticalQueries++;
      }
    }
  };

  /**
   * Periodic diagnostics logging
   */
  if (typeof window !== 'undefined') {
    setInterval(() => {
      const stats = getDiagnostics();
      if (stats.activeSubscriptions > 50) {
        logger.warn(`[UserStore] High subscription count: ${stats.activeSubscriptions} active subscriptions`, stats);
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Resolve a user the local database has never seen.
   *
   * db.users is filled from space rosters, so a peer you share no space with is simply absent on a
   * fresh install — which is what left direct messages rendering raw ids instead of names and
   * avatars. LookupUser takes the user id alone and lets the server decide whether this account has
   * standing to know it; the answer is written to the database, so every reactive binding on that
   * user picks it up on its own.
   *
   * `status` is for the one caller that already knows one — a presence event about a user the cache
   * has never seen. Passing it through means the row is created carrying the status that arrived
   * rather than being inserted Offline and corrected a write later, which is a grey dot on screen
   * in between.
   */
  const lookupUser = async (
    userId: Guid,
    status: UserStatus | null = null
  ): Promise<RealtimeUser | undefined> => {
    if (ignoredUsers.has(userId)) return undefined;

    const inFlight = pendingLookups.get(userId);
    if (inFlight) {
      diagnostics.deduplicatedRequests++;
      return inFlight;
    }

    // Which session asked. A seamless account switch swaps the API client and the database
    // underneath an in-flight request, and the reply — fetched with the previous account's
    // credentials — would otherwise be written into the incoming account's cache.
    const askedIn = sessionEpoch.value;

    const lookup = (async () => {
      try {
        const result = await api.userInteraction.LookupUser(userId);

        if (sessionEpoch.value !== askedIn) {
          logger.warn(`[UserStore] Discarding lookup for ${userId} from a previous session`);
          return undefined;
        }

        if (!result.isSuccessLookupUser()) {
          // A real answer, not a failure to reach: this account has no standing reason to know that
          // one, so there is nothing to retry and no point asking again.
          logger.warn(`[UserStore] Cannot resolve user ${userId}, ignoring future lookups`);
          rememberIgnored(userId);
          return undefined;
        }

        await trackUser(result.user, status);
        return await db.users.get(userId);
      } catch (err) {
        logger.error(`[UserStore] Lookup failed for user ${userId}:`, err);
        diagnostics.errorCount++;
        return undefined;
      } finally {
        pendingLookups.delete(userId);
      }
    })();

    pendingLookups.set(userId, lookup);
    return lookup;
  };

  /** Look up several unknown users at once, in bounded batches. */
  const lookupUsers = async (userIds: Guid[]): Promise<RealtimeUser[]> => {
    const wanted = userIds.filter((id) => !ignoredUsers.has(id));
    const resolved: RealtimeUser[] = [];

    for (let i = 0; i < wanted.length; i += LOOKUP_BATCH) {
      // Wrapped rather than passed by reference: `map` hands its callback the index too, and that
      // would arrive as the `status` argument.
      const batch = await Promise.all(wanted.slice(i, i + LOOKUP_BATCH).map((id) => lookupUser(id)));
      for (const user of batch) if (user) resolved.push(user);
    }

    return resolved;
  };

  /**
   * Batch get users by IDs - much faster than multiple getUser calls
   */
  const getUsersBatch = async (userIds: Guid[]): Promise<Map<Guid, RealtimeUser>> => {
    const now = Date.now();
    const result = new Map<Guid, RealtimeUser>();
    const toFetch: Guid[] = [];

    // Check cache for each userId
    for (const userId of userIds) {
      const cached = userCache.get(userId);
      if (cached && (now - cached.timestamp) < USER_CACHE_TTL && cached.user) {
        result.set(userId, cached.user);
        diagnostics.cacheHits++;
      } else {
        toFetch.push(userId);
        diagnostics.cacheMisses++;
      }
    }

    // If everything is in cache - return immediately
    if (toFetch.length === 0) {
      return result;
    }

    // Single query for all missing users
    const startTime = performance.now();
    logger.debug(`[UserStore] Batch loading ${toFetch.length} users...`);
    
    try {
      const users = await db.users.where('userId').anyOf(toFetch).toArray();
      const duration = performance.now() - startTime;
      
      logger.debug(`[UserStore] Batch loaded ${users.length}/${toFetch.length} users in ${duration.toFixed(0)}ms`);
      
      if (duration > 100) {
        logSlowQuery(`getUsersBatch(${toFetch.length} users)`, duration);
      }

      // Cache results
      for (const user of users) {
        result.set(user.userId, user);
        userCache.set(user.userId, { user, timestamp: Date.now() });
      }

      // Whoever the database has never heard of is asked for by id rather than left to the caller's
      // "no user" fallback, which is a raw id on screen.
      const missing = toFetch.filter((id) => !result.has(id));
      if (missing.length > 0) {
        for (const user of await lookupUsers(missing)) {
          result.set(user.userId, user);
          userCache.set(user.userId, { user, timestamp: Date.now() });
        }
      }

      return result;
    } catch (err) {
      logger.error(`[UserStore] Error in getUsersBatch:`, err);
      diagnostics.errorCount++;
      return result;
    }
  };

  /**
   * Get user by ID with in-memory cache and deduplication
   */
  const getUser = async (userId: Guid): Promise<RealtimeUser | undefined> => {
    const now = Date.now();
    
    diagnostics.totalQueriesExecuted++;

    // Check in-memory cache
    const cached = userCache.get(userId);
    if (cached && (now - cached.timestamp) < USER_CACHE_TTL) {
      diagnostics.cacheHits++;
      return cached.user;
    }
    diagnostics.cacheMisses++;

    // Check for stuck requests
    const pendingTimestamp = requestTimestamps.get(userId);
    if (pendingTimestamp && (now - pendingTimestamp) > REQUEST_TIMEOUT) {
      pendingRequests.delete(userId);
      requestTimestamps.delete(userId);
      diagnostics.errorCount++;
    }

    // Deduplication: if request is already in progress, return same promise
    const pending = pendingRequests.get(userId);
    if (pending) {
      diagnostics.deduplicatedRequests++;
      return pending;
    }

    // New IndexedDB request with timeout
    const startTime = performance.now();
    requestTimestamps.set(userId, now);
    
    // Wait for our turn if too many active requests
    if (activeRequests >= MAX_PARALLEL_REQUESTS) {
      await Promise.race([
        new Promise<void>(resolve => requestQueue.push(resolve)),
        new Promise<void>((resolve) => setTimeout(resolve, 5000))
      ]);
    }
    
    activeRequests++;
    
    // Timeout handler that can be cancelled
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    
    const request = Promise.race([
      (async () => {
        try {
          const result = await db.users.get(userId);
          const duration = performance.now() - startTime;
          
          if (duration > 100) {
            logSlowQuery(`getUser(${userId})`, duration);
          }

          // Cache result. A miss stays uncached so the lookup below gets its turn.
          if (result) userCache.set(userId, { user: result, timestamp: Date.now() });

          // Clean up old cache (if >500 entries)
          if (userCache.size > 500) {
            const entries = Array.from(userCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            for (let i = 0; i < 100; i++) {
              userCache.delete(entries[i][0]);
            }
          }

          return result ?? undefined;
        } catch (err) {
          logger.error(`[UserStore] Exception in getUser(${userId}):`, err);
          diagnostics.errorCount++;
          throw err;
        } finally {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
          
          activeRequests--;
          pendingRequests.delete(userId);
          requestTimestamps.delete(userId);
          
          const nextResolve = requestQueue.shift();
          if (nextResolve) {
            nextResolve();
          }
        }
      })(),
      new Promise<RealtimeUser | undefined>((_, reject) => 
        timeoutId = setTimeout(() => {
          diagnostics.errorCount++;
          reject(new Error(`Request timeout for userId=${userId}`));
        }, REQUEST_TIMEOUT)
      )
    ]);

    // The database is not the last word: a user it has never seen is asked for by id, so callers
    // get an identity instead of undefined.
    const resolved = request.then(async (user) => {
      if (user) return user;
      const fetched = await lookupUser(userId);
      userCache.set(userId, { user: fetched, timestamp: Date.now() });
      return fetched;
    });

    pendingRequests.set(userId, resolved);
    return resolved;
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
   * Reactive user - cached subscription per userId
   */
  function getUserReactive(userId: Ref<string | undefined>): ComputedRef<RealtimeUser | null> {
    return computed(() => {
      const currentId = userId.value;
      if (!currentId) return null;
      
      const existing = reactiveUserCache.get(currentId);
      if (existing) {
        existing.lastAccessed = Date.now();
        return existing.ref.value ?? null;
      }

      // Evict LRU subscriptions if at capacity
      if (reactiveUserCache.size >= MAX_REACTIVE_SUBSCRIPTIONS) {
        const entries = Array.from(reactiveUserCache.entries());
        entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
        const toEvict = entries.slice(0, Math.floor(MAX_REACTIVE_SUBSCRIPTIONS * 0.25));
        for (const [key, entry] of toEvict) {
          entry.subscription.unsubscribe();
          reactiveUserCache.delete(key);
        }
      }

      diagnostics.totalSubscriptionsCreated++;
      const userRef = ref<RealtimeUser | undefined>(undefined);

      const subscription = liveQuery(() => db.users.get(currentId)).subscribe({
        next: (user) => {
          userRef.value = user;
        },
        error: (err) => {
          diagnostics.errorCount++;
          logger.error(`[UserStore] Error in getUserReactive liveQuery for userId=${currentId}:`, err);
          userRef.value = undefined;
        }
      });

      reactiveUserCache.set(currentId, { subscription, ref: userRef, lastAccessed: Date.now() });
      
      return userRef.value ?? null;
    });
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
    await db.users.put(
      {
        ...user,
        status: extendedStatus ?? (exist?.status || UserStatus.Offline),
        activity:
          extendedActivity ??
          (extendedStatus || (exist?.status ?? UserStatus.Offline) === UserStatus.Offline
            ? undefined
            : exist?.activity),
      },
      user.userId
    );
  };

  /**
   * Update user status.
   *
   * The miss goes through this store's own `lookupUser` rather than straight to
   * `api.userInteraction.LookupUser`, because that is the only place that tells the two possible
   * failures apart. A NO_ANCHOR answer is the server saying this account has no standing to know
   * that user, so it is remembered and never asked again; a THROWN request is a failure to reach —
   * a 502, an expired token, a dropped connection — and remembering it used to mute that user for
   * the whole session (`ignoredUsers` is cleared only on an account switch), taking their name and
   * avatar down with their presence. `lookupUser` also folds a burst of events about the same
   * stranger into one request via `pendingLookups`.
   *
   * Defects C3 and C4, pinned by `test/store/userStatusUpdates.test.ts` — "a request that failed to
   * reach the server does not ignore the user forever" and "a burst of events for one stranger is a
   * single lookup".
   */
  const updateUserStatus = async (userId: Guid, status: UserStatus) => {
    // Skip ignored users
    if (ignoredUsers.has(userId)) {
      return;
    }

    // Where this event sits in the arrival order for that user — the only thing that decides who
    // gets the last word once a lookup has made one event wait for another.
    const arrival = ++statusSeq;
    latestStatus.set(userId, { seq: arrival, status });

    try {
      const updated = await db.users.update(userId, (user) => {
        user.status = status;
        if (status === UserStatus.Offline && user.activity) {
          user.activity = undefined;
        }
      });
      if (updated !== 0) return;

      logger.warn(`User ${userId} not found for status update, fetching from server...`);

      // One call, not a shotgun across the first five servers. PrefetchUser needs a space id, so
      // this used to guess which space the two of you shared and fire five requests hoping one
      // landed — capped at five, so a user in the sixth was silently unresolvable. LookupUser takes
      // the user id alone and lets the server find the relationship, whichever one it is.
      const resolved = await lookupUser(userId, status);
      if (!resolved) return;

      // The row exists now, stamped with the status THIS event handed the lookup — and that status
      // is not necessarily the user's any more. A second event may have shared this very lookup and
      // be waiting behind it, or have written the row while the lookup was in flight only for the
      // lookup's own write to land on top of it. So the row is finished with whatever arrived last
      // for this user, tested against the live row rather than against `resolved`, which is a
      // snapshot from before any of that. It used to be finished with `status` whenever it differed
      // from that snapshot, which is how an older status ended up overwriting a newer one.
      const newest = latestStatus.get(userId) ?? { seq: arrival, status };
      await db.users.update(userId, (user) => {
        if (user.status === newest.status) return false;
        user.status = newest.status;
        if (newest.status === UserStatus.Offline && user.activity) {
          user.activity = undefined;
        }
      });
    } finally {
      // Nothing can still be waiting to write once no lookup for this user is in flight, so the
      // arrival record goes with it rather than growing one entry per user seen this session.
      if (!pendingLookups.has(userId)) latestStatus.delete(userId);
    }
  };

  /**
   * Update user activity
   */
  const updateUserActivity = async (
    userId: Guid,
    activity: UserActivityPresence | undefined
  ) => {
    await db.users.update(userId, { activity });
  };

  /**
   * Reset all users to Offline status (on reconnect).
   *
   * The activity goes with the status: offline and "Playing X" cannot both be true, and every other
   * path that takes a user offline (`updateUserStatus`, `loadServerDetails`'s reconciliation pass)
   * already says so. This one is the first to run on a bootstrap, so when the presence snapshot
   * that follows it never lands — a rejected `GetMemberPresence` — the roster would otherwise show
   * grey dots under yesterday's games. Defect C5, pinned by
   * `test/store/userStatusUpdates.test.ts` "a user taken offline does not keep the game they were
   * playing".
   *
   * The rows this touches are the ones that are not already where it leaves them — either not
   * Offline, or Offline and still wearing an activity. That second half is the one that used to be
   * missed: selecting on `status != Offline` skipped precisely the rows nobody else will revisit,
   * so a user who reached Offline by a path that left the activity behind kept yesterday's game
   * under a grey dot until something else happened to write that row.
   */
  const resetAllUsersToOffline = async () => {
    await db.transaction("rw", db.users, async () => {
      await db.users
        .filter((user) => user.status !== UserStatus.Offline || user.activity !== undefined)
        .modify((user) => {
          user.status = UserStatus.Offline;
          user.activity = undefined;
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
    getUsersBatch,
    lookupUser,
    lookupUsers,
    getUsersByServerMemberIds,
    getUserReactive,
    // Diagnostics
    getDiagnostics,
    searchMentions,
    searchUser,
    trackUser,
    updateUserStatus,
    updateUserActivity,
    resetAllUsersToOffline,
    debug_getAllUser,
  };
});
