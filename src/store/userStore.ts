import { logger } from "@argon/core";
import { computedAsync } from "@vueuse/core";
import { useObservable } from "@vueuse/rxjs";
import { liveQuery, type Subscription } from "dexie";
import { defineStore } from "pinia";
import { from, shareReplay } from "rxjs";
import { type Ref, computed, ref, watch, type ComputedRef, reactive } from "vue";
import { useApi } from "./apiStore";
import { type RealtimeUser, db } from "./db/dexie";
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
  const reactiveUserCache = new Map<string, { subscription: Subscription; ref: Ref<RealtimeUser | undefined>; createdAt: number }>();

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
    recentCallTimestamps: [] as number[],
  });

  /**
   * Get diagnostics info
   */
  const getDiagnostics = () => {
    // Calculate call frequency for the last second
    const now = Date.now();
    const recentCalls = diagnostics.recentCallTimestamps.filter(t => now - t < 1000);
    const callsPerSecond = recentCalls.length;

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
      callsPerSecond,
      cacheSize: userCache.size,
      pendingRequests: pendingRequests.size,
      activeRequests,
      queuedRequests: requestQueue.length,
      maxParallelRequests: MAX_PARALLEL_REQUESTS,
      cacheKeys: Array.from(reactiveUserCache.keys()),
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
      
      if (duration > 1000) {
        const caller = new Error().stack?.split('\n').slice(2, 8).join('\n') || 'unknown';
        logSlowQuery(`getUsersBatch(${toFetch.length} users)`, duration, caller);
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
    const caller = new Error().stack?.split('\n').slice(2, 15).join('\n') || 'unknown';
    
    diagnostics.totalQueriesExecuted++;
    diagnostics.recentCallTimestamps.push(now);
    
    // Clean up old timestamps (older than 1 sec)
    if (diagnostics.recentCallTimestamps.length > 100) {
      diagnostics.recentCallTimestamps = diagnostics.recentCallTimestamps.filter(t => now - t < 1000);
    }

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
      logger.error(`[UserStore] Request timeout for userId=${userId}, clearing pending request`);
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
    
    // Check: are there other long-running requests?
    const longRunningRequests = Array.from(requestTimestamps.entries())
      .filter(([id, timestamp]) => id !== userId && (now - timestamp) > 5000)
      .map(([id, timestamp]) => `${id} (${now - timestamp}ms)`);
    
    if (longRunningRequests.length > 0) {
      logger.warn(`[UserStore] ${longRunningRequests.length} long-running requests detected: ${longRunningRequests.join(', ')}`);
    }
    
    // Wait for our turn if too many active requests
    if (activeRequests >= MAX_PARALLEL_REQUESTS) {
      logger.warn(`[UserStore] ⏸️ Throttling: waiting for slot (${activeRequests} active requests)`);
      
      // Timeout for throttling - don't wait forever
      await Promise.race([
        new Promise<void>(resolve => requestQueue.push(resolve)),
        new Promise<void>((resolve) => setTimeout(() => {
          logger.error(`[UserStore] 💥 Throttling timeout for ${userId}, forcing slot`);
          resolve();
        }, 5000))
      ]);
    }
    
    activeRequests++;
    
    // Timeout handler that can be cancelled
    let timeoutId: NodeJS.Timeout | number | undefined;
    
    const request = Promise.race([
      (async () => {
        try {
          const dbCallStart = performance.now();
          const result = await db.users.get(userId);
          const dbCallDuration = performance.now() - dbCallStart;
          const duration = performance.now() - startTime;
          
          if (dbCallDuration > 1000) {
            logger.error(`[UserStore] 🐌 IndexedDB call took ${dbCallDuration}ms for getUser(${userId})\n📞 Called from:\n${caller}`);
          }
          
          logSlowQuery(`getUser(${userId})`, duration, caller);

          // Cache result
          userCache.set(userId, { user: result, timestamp: Date.now() });

          // Clean up old cache (if >500 entries)
          if (userCache.size > 500) {
            const entries = Array.from(userCache.entries());
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
            // Remove 100 oldest entries
            for (let i = 0; i < 100; i++) {
              userCache.delete(entries[i][0]);
            }
          }

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
            const echoUser = await db.users.get(userId);
            userCache.set(userId, { user: echoUser, timestamp: Date.now() });
            return echoUser;
          }

          return undefined;
        } catch (err) {
          logger.error(`[UserStore] 💥 Exception in getUser(${userId}):`, err);
          throw err;
        } finally {
          // Cancel timeout
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
          
          activeRequests--;
          pendingRequests.delete(userId);
          requestTimestamps.delete(userId);
          
          // Release slot for next request in queue
          const nextResolve = requestQueue.shift();
          if (nextResolve) {
            nextResolve();
          }
        }
      })(),
      new Promise<RealtimeUser | undefined>((_, reject) => 
        timeoutId = setTimeout(() => {
          const elapsed = Date.now() - now;
          const allPending = Array.from(pendingRequests.keys());
          const allTimestamps = Array.from(requestTimestamps.entries())
            .map(([id, ts]) => `${id}:${Date.now() - ts}ms`);
          
          logger.error(
            `[UserStore] ⏱️ REQUEST TIMEOUT for getUser(${userId})\n` +
            `⏱️ Elapsed: ${elapsed}ms\n` +
            `📞 Called from:\n${caller}\n` +
            `🔄 Pending requests (${allPending.length}): ${allPending.join(', ')}\n` +
            `⏲️ Request ages: ${allTimestamps.join(', ')}\n` +
            `🎯 Active requests: ${activeRequests}/${MAX_PARALLEL_REQUESTS}\n` +
            `📋 Queue length: ${requestQueue.length}`
          );
          
          diagnostics.errorCount++;
          // DON'T do cleanup here - it will happen in finally block
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
      
      // Return cached subscription if exists
      if (!reactiveUserCache.has(currentId)) {
        diagnostics.totalSubscriptionsCreated++;
        const userRef = ref<RealtimeUser | undefined>(undefined);

        const subscription = liveQuery(() => db.users.get(currentId)).subscribe({
          next: (user) => {
            // Measure time for each liveQuery trigger separately
            const queryStart = performance.now();
            userRef.value = user;
            const duration = performance.now() - queryStart;
            
            // Log only if really slow
            if (duration > 100) {
              logSlowQuery(`liveQuery.getUserReactive(${currentId})`, duration);
            }
          },
          error: (err) => {
            diagnostics.errorCount++;
            logger.error(`[UserStore] Error in getUserReactive liveQuery for userId=${currentId}:`, err);
            userRef.value = undefined;
          }
        });

        reactiveUserCache.set(currentId, { subscription, ref: userRef, createdAt: Date.now() });
        logger.info(`[UserStore] Created subscription #${diagnostics.totalSubscriptionsCreated} for userId=${currentId}. Total active: ${reactiveUserCache.size}`);
      }
      
      return reactiveUserCache.get(currentId)!.ref.value ?? null;
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
    const updated = await db.users.update(userId, (user) => {
      user.status = status;
      if (status === UserStatus.Offline && user.activity) {
        user.activity = undefined;
      }
    });
    if (updated === 0) {
      logger.warn(`User ${userId} not found for status update`);
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
