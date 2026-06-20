import { logger } from "@argon/core";
import { computedAsync } from "@vueuse/core";
import { useObservable } from "@vueuse/rxjs";
import { liveQuery, type Subscription } from "dexie";
import { defineStore } from "pinia";
import { from, shareReplay } from "rxjs";
import { type Ref, computed, ref, watch, type ComputedRef, reactive } from "vue";
import { useApi } from "@/store/system/apiStore";
import { type RealtimeUser, db } from "@/store/db/dexie";
import { onSessionReset } from "@/store/system/sessionLifecycle";
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

  // Seamless account switch: drop all live user subscriptions (bound to the old DB) and caches.
  onSessionReset(() => {
    for (const entry of reactiveUserCache.values()) {
      try { entry.subscription.unsubscribe(); } catch { /* ignore */ }
    }
    reactiveUserCache.clear();
    userCache.clear();
    pendingRequests.clear();
    requestTimestamps.clear();
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

          // Cache result
          userCache.set(userId, { user: result, timestamp: Date.now() });

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

    pendingRequests.set(userId, request);
    return request;
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
   * Update user status
   */
  const updateUserStatus = async (userId: Guid, status: UserStatus) => {
    // Skip ignored users
    if (ignoredUsers.has(userId)) {
      return;
    }

    const updated = await db.users.update(userId, (user) => {
      user.status = status;
      if (status === UserStatus.Offline && user.activity) {
        user.activity = undefined;
      }
    });
    if (updated === 0) {
      logger.warn(`User ${userId} not found for status update, fetching from server...`);
      
      // Try to fetch user from server (parallel requests, limit to first 5 servers)
      try {
        const servers = await db.servers.limit(5).toArray();
        
        // Parallel fetch from multiple servers
        const results = await Promise.allSettled(
          servers.map(server => api.serverInteraction.PrefetchUser(server.spaceId, userId))
        );
        
        // Find first successful result
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === 'fulfilled' && result.value) {
            await trackUser(result.value, status);
            logger.info(`Successfully fetched and updated user ${userId} from server ${servers[i].spaceId}`);
            return;
          }
        }
        
        // Failed to fetch - ignore this user in future
        logger.error(`Failed to fetch user ${userId} from any server, ignoring future updates`);
        ignoredUsers.add(userId);
      } catch (err) {
        logger.error(`Error fetching user ${userId}:`, err);
        ignoredUsers.add(userId);
      }
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
    getUsersBatch,
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
