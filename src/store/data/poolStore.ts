import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { metrics, bucket, COUNT_EDGES } from "@/lib/telemetry/metrics";
import { ref, onScopeDispose } from "vue";
import { useApi } from "@/store/system/apiStore";
import { useBus } from "@/store/realtime/busStore";
import { useUserStore } from "@/store/data/userStore";
import { useChannelStore } from "@/store/data/channelStore";
import { useArchetypeStore } from "@/store/data/archetypeStore";
import { useRealtimeStore } from "@/store/realtime/realtimeStore";
import { useEventStore } from "@/store/realtime/eventStore";
import { useMessageStore } from "@/store/data/messageStore";
import { db } from "@/store/db/dexie";
import { onSessionReset } from "@/store/system/sessionLifecycle";
import { useGroupedServerUsers } from "@/composables/useGroupedServerUsers";
import { ChannelType, UserStatus, type ArgonSpaceBase, type ArgonUser, type MemberPresence, type RealtimeChannel, type SpaceMember, type SpaceSnapshot, type SpaceVersions } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import { liveQuery, type IndexableType, type Subscription, type Table } from "dexie";

/**
 * Refactored Pool Store - coordinator between specialized stores
 * Now it's a thin layer that delegates work to specialized stores
 */
export const usePoolStore = defineStore("data-pool", () => {
  const api = useApi();
  const bus = useBus();

  // Initialize specialized stores
  const userStore = useUserStore();
  const channelStore = useChannelStore();
  const archetypeStore = useArchetypeStore();
  const realtimeStore = useRealtimeStore();
  const eventStore = useEventStore();
  const messageStore = useMessageStore();

  // Selected server (can be extracted to separate store, but kept for backward compatibility)
  const selectedServer = ref<Guid | null>(null);

  /**
   * System initialization
   */
  const init = async () => {
    await userStore.resetAllUsersToOffline();
    eventStore.subscribeToEvents();
  };

  /**
   * Load all server details with parallel fetching and bulk DB operations
   */
  const loadServerDetails = async () => {
    const startTime = performance.now();
    const servers = await api.userInteraction.GetSpaces();
    metrics.distribution("space.membership.count", servers.length, "none");

    logger.log(`Loaded '${servers.length}' servers`);

    // Bulk save servers first
    await db.servers.bulkPut(servers);

    // Process servers in parallel batches
    const BATCH_SIZE = 5; // Limit concurrent server loads to avoid overwhelming API

    // `status` is a single global field per user (db.users is keyed by userId, not per-server),
    // so the "mark everyone not in the member list offline" reconciliation must run ONCE against
    // the union of every server's members. Doing it per-server marks users offline merely because
    // they belong to a *different* server — with >1 server that leaves almost everyone showing
    // offline. We collect every seen member id here and reconcile once, after all servers load.
    const seenUserIds = new Set<Guid>();

    for (let i = 0; i < servers.length; i += BATCH_SIZE) {
      const batch = servers.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(server => loadSingleServerDetails(server)));
      for (const ids of batchResults)
        for (const id of ids) seenUserIds.add(id);
    }

    // Single reconciliation pass: any cached user absent from every server we just loaded is
    // offline. init() already reset everyone to offline, so this only catches users who were
    // cached online from a previous run but no longer appear in any member snapshot.
    await db.users
      .filter(user => !seenUserIds.has(user.userId))
      .modify(user => {
        user.status = UserStatus.Offline;
        user.activity = undefined;
      });

    const duration = performance.now() - startTime;
    metrics.distribution("space.load.duration", duration, "millisecond", { spaces: bucket(servers.length, COUNT_EDGES) });
    logger.log(`[PoolStore] loadServerDetails completed in ${duration.toFixed(0)}ms for ${servers.length} servers`);
  };

  /**
   * What the server already knows we hold for a space, so it can answer with only what moved.
   *
   * `channels` is deliberately dropped on the way out and never sent back. The channel part of a
   * snapshot carries each voice channel's live occupancy, but its version covers only the channel
   * rows and the caller's roles — so a matching version answers "your channel list is current" by
   * sending no channels, and with them no occupancy, leaving voice channels looking empty until
   * somebody joins or leaves one. Members, roles and groups are the bulk of the answer and stay
   * versioned.
   */
  const knownVersions = async (spaceId: Guid): Promise<SpaceVersions | null> => {
    const stored = await db.spaceVersions.get(spaceId);
    return stored ? { ...stored.versions, channels: null } : null;
  };

  /** One line per space at startup: what the snapshot actually carried. */
  const describeSnapshot = (snapshot: SpaceSnapshot | null): string => {
    if (!snapshot) return "unavailable";

    const part = (name: string, value: { length: number } | null) =>
      `${name} ${value ? value.length : "unchanged"}`;

    return [
      part("members", snapshot.members),
      part("channels", snapshot.channels),
      part("groups", snapshot.groups),
      part("roles", snapshot.archetypes),
    ].join(", ");
  };

  /**
   * Replaces a space's slice of a table with the list the server just sent.
   *
   * A part that arrives is the whole part — an empty one means the space genuinely has none of that
   * thing — so whatever is left over locally is a member who left, a role that was deleted or a
   * group that was removed while we were away. Now that a cached part can be kept on its version
   * instead of being re-downloaded every start, nothing else would ever clear those rows.
   *
   * The surviving keys are read back off the `spaceId` index rather than filtered with `noneOf`, so
   * the work is one key-only scan instead of an exclusion set the size of the roster.
   */
  const replaceSpaceRows = async <T, K extends IndexableType>(
    table: Table<T, K>,
    spaceId: Guid,
    rows: T[],
    keyOf: (row: T) => K,
  ) => {
    if (rows.length > 0) await table.bulkPut(rows);

    const keep = new Set(rows.map(keyOf));
    const stale = (await table.where("spaceId").equals(spaceId).primaryKeys()).filter(key => !keep.has(key));

    if (stale.length > 0) {
      await table.bulkDelete(stale);
      logger.warn(`[PoolStore] Pruned ${stale.length} stale ${table.name} rows for ${spaceId}`);
    }
  };

  /**
   * userId -> identity for the roster of a space: from the snapshot when it sent one, from the cache
   * when it did not.
   */
  const rosterUsers = async (spaceId: Guid, members: SpaceMember[] | null): Promise<Map<Guid, ArgonUser>> => {
    const roster = members ?? await db.members.where("spaceId").equals(spaceId).toArray();
    return new Map(roster.filter(m => m.user).map(m => [m.userId, m.user] as const));
  };

  /**
   * Writes the user rows for a space. Identity comes from the roster when the server sent one;
   * status and activity always come from presence, which is its own call for the same reason it is
   * its own call on the server — presence moves every few seconds, so a version over it would never
   * match.
   *
   * Returns false when the roster did not come and the cached user rows it stands for are not all
   * there. That combination means the cache and its version token disagree, and the token is the one
   * that has to go: dropping it costs one full bootstrap and repairs the cache.
   */
  const writeUsers = async (members: SpaceMember[] | null, presence: MemberPresence[] | null): Promise<boolean> => {
    const byId = new Map((presence ?? []).map(p => [p.userId, p]));

    if (members) {
      const rows = members
        .filter(m => m.user)
        .map(m => ({
          ...m.user,
          status: byId.get(m.userId)?.status ?? UserStatus.Offline,
          activity: byId.get(m.userId)?.activity ?? undefined,
        }));

      if (rows.length > 0) await db.users.bulkPut(rows);
      return true;
    }

    if (!presence || presence.length === 0) return true;

    const updated = await db.users.bulkUpdate(presence.map(p => ({
      key: p.userId,
      changes: { status: p.status, activity: p.activity ?? undefined },
    })));

    return updated === presence.length;
  };

  /**
   * Load details for a single server: one versioned snapshot, plus presence alongside it.
   *
   * The snapshot is what used to be four independent calls (roles, members, channels, groups). Every
   * part of it is versioned, so a client that already holds a part is told so instead of being sent
   * the whole space again — which is what a client is on every sign-in after the first.
   */
  const loadSingleServerDetails = async (server: ArgonSpaceBase): Promise<Guid[]> => {
    const startTime = performance.now();
    const spaceId = server.spaceId;
    // Member ids seen for this server — returned to loadServerDetails so it can reconcile
    // offline users once across the union of all servers (status is a global per-user field).
    let memberUserIds: Guid[] = [];

    try {
      const [snapshotResult, presenceResult] = await Promise.allSettled([
        api.serverInteraction.GetSpaceSnapshot(spaceId, await knownVersions(spaceId)),
        api.serverInteraction.GetMemberPresence(spaceId),
      ]);

      if (snapshotResult.status === 'rejected')
        logger.error(snapshotResult.reason, "failed receive snapshot for server", spaceId);
      if (presenceResult.status === 'rejected')
        logger.error(presenceResult.reason, "failed receive member presence for server", spaceId);

      const snapshot = snapshotResult.status === 'fulfilled' ? snapshotResult.value : null;
      const presence = presenceResult.status === 'fulfilled' ? presenceResult.value : null;

      // A part is null when our version matched it, which is not the same as it being empty: an
      // empty array means the space genuinely has none of that thing, and the cached rows go.
      const archetypes = snapshot?.archetypes ?? null;
      const members = snapshot?.members ?? null;
      const groups = snapshot?.groups ?? null;
      const channels = snapshot?.channels ?? null;

      logger.log(`Snapshot for ${spaceId}: ${describeSnapshot(snapshot)}`);

      if (archetypes) await replaceSpaceRows(db.archetypes, spaceId, archetypes, a => a.id);
      if (members) await replaceSpaceRows(db.members, spaceId, members, m => m.memberId);
      if (groups) await replaceSpaceRows(db.channelGroups, spaceId, groups, g => g.groupId);

      // Unconditional: init() has just reset every cached user to offline, so the status half has to
      // be written even for a space whose roster did not move.
      const usersIntact = await writeUsers(members, presence);

      const roster = await rosterUsers(spaceId, members);

      if (channels) await processChannels(channels, roster, spaceId);

      // Hand these ids back so the caller can reconcile offline users once, across all servers.
      // Presence covers the whole roster and is the better source; the cache stands in when that
      // call failed, or nobody in this space would survive the reconciliation pass.
      memberUserIds = presence ? presence.map(p => p.userId) : [...roster.keys()];

      // Last, and only after every part of this same answer landed: a token that outlives the rows
      // it describes makes the server say "you already have it" about rows that are not there.
      if (usersIntact && snapshot)
        await db.spaceVersions.put({ spaceId, versions: snapshot.versions });
      else if (!usersIntact) {
        logger.warn(`[PoolStore] Cached users for ${spaceId} are incomplete, dropping its snapshot versions`);
        await db.spaceVersions.delete(spaceId);
      }

      // Start listening to server events
      bus.listenEvents(spaceId);

      const duration = performance.now() - startTime;
      logger.debug(`[PoolStore] Server ${spaceId} loaded in ${duration.toFixed(0)}ms`);
    } catch (e) {
      logger.error(e, `[PoolStore] Critical error loading server ${spaceId}`);
    }

    return memberUserIds;
  };

  /**
   * Process channels with bulk operations and parallel user prefetching
   */
  const processChannels = async (channels: RealtimeChannel[], roster: Map<Guid, ArgonUser>, spaceId: Guid) => {
    const trackedIds: Guid[] = [];
    const channelsToSave: RealtimeChannel['channel'][] = [];
    const usersToPrefetch: Array<{ spaceId: Guid; userId: Guid }> = [];
    
    // Map userId -> ArgonUser (for prefetched users)
    const prefetchedUsersMap = new Map<Guid, ArgonUser>();

    // First pass: collect channels and identify missing users
    for (const c of channels) {
      if (c.channel.type === ChannelType.Text && !channelStore.selectedTextChannel) {
        channelStore.selectedTextChannel = c.channel.channelId;
      }

      trackedIds.push(c.channel.channelId);
      channelsToSave.push(c.channel);

      // Collect users that need prefetching
      for (const uw of c.users) {
        if (isGuestUser(uw.userId)) continue;
        
        if (!roster.has(uw.userId)) {
          usersToPrefetch.push({ spaceId: c.channel.spaceId, userId: uw.userId });
        }
      }
    }

    // Bulk save channels
    if (channelsToSave.length > 0) {
      await db.channels.bulkPut(channelsToSave);
    }

    // Parallel prefetch missing users (with deduplication)
    const uniquePrefetches = Array.from(
      new Map(usersToPrefetch.map(p => [p.userId, p])).values()
    );

    if (uniquePrefetches.length > 0) {
      const PREFETCH_BATCH = 10;
      for (let i = 0; i < uniquePrefetches.length; i += PREFETCH_BATCH) {
        const batch = uniquePrefetches.slice(i, i + PREFETCH_BATCH);
        const prefetchedUsers = await Promise.allSettled(
          batch.map(p => api.serverInteraction.PrefetchUser(p.spaceId, p.userId))
        );

        // Add prefetched users to map
        prefetchedUsers.forEach((result, idx) => {
          if (result.status === 'fulfilled' && result.value) {
            const userId = batch[idx].userId;
            prefetchedUsersMap.set(userId, result.value);
            // Also track in store
            userStore.trackUser(result.value);
          }
        });
      }
    }

    // Second pass: initialize realtime channels
    for (const c of channels) {
      const realtimeUsers = new Map();

      for (const uw of c.users) {
        if (isGuestUser(uw.userId)) {
          logger.debug(`[PoolStore] Skipping guest user ${uw.userId} in channel init`);
          continue;
        }

        // The roster carries the identity; anyone missing from it was prefetched above.
        const user = roster.get(uw.userId) ?? prefetchedUsersMap.get(uw.userId);
        
        if (!user) {
          logger.fatal("Cannot find user data", uw.userId);
          continue;
        }

        realtimeUsers.set(uw.userId, {
          state: uw.state,
          userId: uw.userId,
          User: user,
          isSpeaking: false,
          isMuted: false,
          isScreenShare: false,
          volume: [100],
          isRecording: false,
        });
      }

      realtimeStore.initRealtimeChannel(c.channel, realtimeUsers);
    }

    // Remove stale channels
    await channelStore.pruneChannels(spaceId, trackedIds);
  };

  /**
   * Check if userId is a guest user by GUID prefix
   * Guest users have GUID starting with 0xFA, 0xFC, 0xCC, 0xCC (ccccfcfa in hex)
   */
  const isGuestUser = (userId: string): boolean => {
    return userId.toLowerCase().startsWith('ccccfcfa');
  };

  /**
   * Refresh data
   */
  const refershDatas = async () => {
    await loadServerDetails();
  };

  /**
   * SIP user joined channel
   */
  const sipUserJoinedToChannel = async (
    channelId: Guid,
    participantId: Guid,
    participantName: string
  ) => {
    const channel = await db.channels.get(channelId);
    if (!channel) {
      logger.error("recollect channel required");
      return;
    }

    realtimeStore.addUserToChannel(channelId, participantId, {
      displayName: participantName,
      username: "",
      userId: participantId,
      avatarFileId: null,
    } as any);
  };

  /**
   * SIP user left channel
   */
  const sipUserLeavedFromChannel = async (
    channelId: Guid,
    participantId: Guid
  ) => {
    const channel = await db.channels.get(channelId);
    if (!channel) {
      logger.error("recollect channel required");
      return;
    }

    realtimeStore.removeUserFromChannel(channelId, participantId);
  };

  // Initialize permissions watcher
  archetypeStore.initPermissionsWatcher(() => selectedServer.value);

  // Seamless account switch: drop the selected server so the new account starts at home.
  onSessionReset(() => {
    selectedServer.value = null;
  });

  // ===========================================
  // LEGACY API - for backward compatibility
  // ===========================================

  return {
    // Stores
    db,

    // Server selection
    selectedServer,
    getServer: async (serverId: Guid) => {
      return await db.servers.where("spaceId").equals(serverId).first();
    },
    getSelectedServer: async () => {
      if (!selectedServer.value) return null;
      return await db.servers.where("spaceId").equals(selectedServer.value).first() || null;
    },

    // Channels
    selectedChannel: channelStore.selectedChannel,
    selectedTextChannel: channelStore.selectedTextChannel,
    onChannelChanged: channelStore.onChannelChanged,
    getChannel: channelStore.getChannel,
    useActiveServerChannels: channelStore.useActiveServerChannels,
    trackChannel: channelStore.trackChannel,

    // Users
    getUser: userStore.getUser,
    getUsersBatch: userStore.getUsersBatch,
    getUserReactive: userStore.getUserReactive,
    searchMentions: userStore.searchMentions,
    searchUser: userStore.searchUser,
    trackUser: userStore.trackUser,
    getUsersByServerMemberIds: userStore.getUsersByServerMemberIds,
    debug_getAllUser: userStore.debug_getAllUser,

    // Archetypes & Permissions
    getMePermissions: archetypeStore.currentServerPermissions,
    has: archetypeStore.hasPermission,
    refreshAllArchetypesForServer: archetypeStore.refreshAllArchetypesForServer,
    getDetailedArchetypesAndRefreshDb: archetypeStore.getDetailedArchetypesAndRefreshDb,
    trackArchetype: archetypeStore.trackArchetype,
    untrackArchetype: archetypeStore.untrackArchetype,
    trackMember: archetypeStore.trackMember,
    getMemberIdsByUserIds: archetypeStore.getMemberIdsByUserIds,
    getMemberIdsByUserIdsQuery: archetypeStore.getMemberIdsByUserIdsQuery,
    generateBadgesByArchetypes: archetypeStore.generateBadgesByArchetypes,

    // Realtime
    realtimeChannelUsers: realtimeStore.realtimeChannels,
    indicateSpeaking: realtimeStore.setUserSpeaking,
    setProperty: realtimeStore.setUserProperty,

    // Events
    onNewMessageReceived: eventStore.onNewMessageReceived,
    onMessageUpdated: eventStore.onMessageUpdated,
    onReactionAdded: eventStore.onReactionAdded,
    onReactionRemoved: eventStore.onReactionRemoved,

    // Messages
    loadCachedMessages: messageStore.loadCachedMessages,
    loadOlderCachedMessages: messageStore.loadOlderCachedMessages,
    cacheMessages: messageStore.cacheMessages,
    cacheMessage: messageStore.cacheMessage,
    getMessageById: messageStore.getMessageById,
    clearChannelMessages: messageStore.clearChannelMessages,
    getChannelMessageCount: messageStore.getChannelMessageCount,
    updateMessageReactions: messageStore.updateMessageReactions,

    // Servers
    useAllServers: () => {
      const result = ref<ArgonSpaceBase[]>([]);
      
      const subscription = liveQuery(() => db.servers.toArray()).subscribe({
        next: (servers) => {
          result.value = servers;
        },
        error: (err) => {
          logger.error("[PoolStore] Error in useAllServers liveQuery:", err);
          result.value = [];
        }
      });

      // Cleanup subscription when component is unmounted
      onScopeDispose(() => {
        subscription.unsubscribe();
      });

      return result;
    },
    trackServer: async (server: any) => {
      await db.servers.put(server, server.spaceId);
    },

    // Grouped users composable
    useGroupedServerUsers,

    // Core functions
    init,
    loadServerDetails,
    refershDatas,
    sipUserJoinedToChannel,
    sipUserLeavedFromChannel,

    // Direct store access for migration
    _userStore: userStore,
    _channelStore: channelStore,
    _archetypeStore: archetypeStore,
    _realtimeStore: realtimeStore,
    _eventStore: eventStore,
    _messageStore: messageStore,
  };
});

// Export types for backward compatibility
export type {
  MentionUser,
} from "@/store/data/userStore";

export type {
  IRealtimeChannelUser as IRealtimeChannelUserWithData,
  IRealtimeChannel as IRealtimeChannelWithUser,
} from "@/store/realtime/realtimeStore";
