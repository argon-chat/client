import { logger } from "@argon/core";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { useBus } from "./busStore";
import { useUserStore } from "./userStore";
import { useChannelStore } from "./channelStore";
import { useArchetypeStore } from "./archetypeStore";
import { useRealtimeStore } from "./realtimeStore";
import { useEventStore } from "./eventStore";
import { useMessageStore } from "./messageStore";
import { db } from "./db/dexie";
import { useGroupedServerUsers } from "@/composables/useGroupedServerUsers";
import { ChannelType, UserStatus, type ArgonSpaceBase, type ArgonUser, type RealtimeChannel, type RealtimeServerMember } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

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

    logger.log(`Loaded '${servers.length}' servers`);

    // Bulk save servers first
    await db.servers.bulkPut(servers);

    // Process servers in parallel batches
    const BATCH_SIZE = 5; // Limit concurrent server loads to avoid overwhelming API
    
    for (let i = 0; i < servers.length; i += BATCH_SIZE) {
      const batch = servers.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(server => loadSingleServerDetails(server)));
    }

    const duration = performance.now() - startTime;
    logger.log(`[PoolStore] loadServerDetails completed in ${duration.toFixed(0)}ms for ${servers.length} servers`);
  };

  /**
   * Load details for a single server with parallel API calls
   */
  const loadSingleServerDetails = async (server: ArgonSpaceBase) => {
    const startTime = performance.now();
    const spaceId = server.spaceId;

    try {
      // Parallel fetch all server data
      const [archetypesResult, membersResult, channelsResult, groupsResult] = await Promise.allSettled([
        api.serverInteraction.GetServerArchetypes(spaceId),
        api.serverInteraction.GetMembers(spaceId),
        api.serverInteraction.GetChannels(spaceId),
        api.serverInteraction.GetChannelGroups(spaceId),
      ]);

      // Process archetypes
      const serverArchetypes = archetypesResult.status === 'fulfilled' ? archetypesResult.value : [];
      if (archetypesResult.status === 'rejected') {
        logger.error(archetypesResult.reason, "failed receive archetypes for server", spaceId);
      } else {
        logger.log(`Loaded '${serverArchetypes.length}' archetypes for ${spaceId}`);
        // Bulk save archetypes
        if (serverArchetypes.length > 0) {
          await db.archetypes.bulkPut(serverArchetypes);
        }
      }

      // Process members/users
      const users = membersResult.status === 'fulfilled' ? membersResult.value : [];
      if (membersResult.status === 'rejected') {
        logger.error(membersResult.reason, "failed receive members for server", spaceId);
      } else {
        logger.log(`Loaded '${users.length}' users for ${spaceId}`);
        
        // Bulk save members
        const members = users.map(u => u.member).filter(Boolean);
        if (members.length > 0) {
          await db.members.bulkPut(members);
        }

        // Bulk save/update users
        const usersToTrack = users
          .filter(u => u.member.user)
          .map(u => ({
            ...u.member.user,
            status: u.status,
            activity: u.presence ?? undefined,
          }));
        
        if (usersToTrack.length > 0) {
          await db.users.bulkPut(usersToTrack);
        }

        // Set offline status for users not in the list
        const excludeSet = new Set(users.filter(x => x.member).map(x => x.member.userId));
        await db.users
          .filter(user => !excludeSet.has(user.userId))
          .modify(user => {
            user.status = UserStatus.Offline;
            user.activity = undefined;
          });
      }

      // Process channel groups
      const groups = groupsResult.status === 'fulfilled' ? groupsResult.value : [];
      if (groupsResult.status === 'rejected') {
        logger.error(groupsResult.reason, "failed receive channel groups for server", spaceId);
      } else {
        logger.log(`Loaded '${groups.length}' channel groups for ${spaceId}`);
        if (groups.length > 0) {
          await db.channelGroups.bulkPut(groups);
        }
      }

      // Process channels
      const channels = channelsResult.status === 'fulfilled' ? channelsResult.value : [];
      if (channelsResult.status === 'rejected') {
        logger.error(channelsResult.reason, "failed receive channels for server", spaceId);
      } else {
        logger.log(`Loaded '${channels.length}' channels for ${spaceId}`);
        await processChannels(channels, users, spaceId);
      }

      // Start listening to server events
      bus.listenEvents(spaceId);

      const duration = performance.now() - startTime;
      logger.debug(`[PoolStore] Server ${spaceId} loaded in ${duration.toFixed(0)}ms`);
    } catch (e) {
      logger.error(e, `[PoolStore] Critical error loading server ${spaceId}`);
    }
  };

  /**
   * Process channels with bulk operations and parallel user prefetching
   */
  const processChannels = async (channels: RealtimeChannel[], users: RealtimeServerMember[], spaceId: Guid) => {
    const trackedIds: Guid[] = [];
    const channelsToSave: RealtimeChannel['channel'][] = [];
    const usersToPrefetch: Array<{ spaceId: Guid; userId: Guid }> = [];
    
    // Map userId -> member data from server response
    const membersMap = new Map(users.map(u => [u.member.userId, u]));
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
        
        const existingUser = membersMap.get(uw.userId);
        if (!existingUser || !existingUser.member.user) {
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

        // Try to get user from members map first, then from prefetched
        const memberData = membersMap.get(uw.userId);
        const user = memberData?.member.user ?? prefetchedUsersMap.get(uw.userId);
        
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

      // Set meeting info if exists
      if (c.meetInfo) {
        realtimeStore.setMeetingInfo(c.channel.channelId, c.meetInfo);
      }
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
    trackMember: archetypeStore.trackMember,
    getMemberIdsByUserIds: archetypeStore.getMemberIdsByUserIds,
    getMemberIdsByUserIdsQuery: archetypeStore.getMemberIdsByUserIdsQuery,
    generateBadgesByArchetypes: archetypeStore.generateBadgesByArchetypes,

    // Realtime
    realtimeChannelUsers: realtimeStore.realtimeChannels,
    indicateSpeaking: realtimeStore.setUserSpeaking,
    setProperty: realtimeStore.setUserProperty,
    setMeetingInfo: realtimeStore.setMeetingInfo,

    // Events
    onNewMessageReceived: eventStore.onNewMessageReceived,

    // Messages
    loadCachedMessages: messageStore.loadCachedMessages,
    loadOlderCachedMessages: messageStore.loadOlderCachedMessages,
    cacheMessages: messageStore.cacheMessages,
    cacheMessage: messageStore.cacheMessage,
    getMessageById: messageStore.getMessageById,
    clearChannelMessages: messageStore.clearChannelMessages,
    getChannelMessageCount: messageStore.getChannelMessageCount,

    // Servers
    useAllServers: () => {
      const obs = ref<any[]>([]);
      db.servers.toArray().then(servers => obs.value = servers);
      return obs;
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
} from "./userStore";

export type {
  IRealtimeChannelUser as IRealtimeChannelUserWithData,
  IRealtimeChannel as IRealtimeChannelWithUser,
} from "./realtimeStore";
