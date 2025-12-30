import { logger } from "@/lib/logger";
import { defineStore } from "pinia";
import { ref } from "vue";
import { useApi } from "./apiStore";
import { useBus } from "./busStore";
import { useUserStore } from "./userStore";
import { useChannelStore } from "./channelStore";
import { useArchetypeStore } from "./archetypeStore";
import { useRealtimeStore } from "./realtimeStore";
import { useEventStore } from "./eventStore";
import { db } from "./db/dexie";
import { useGroupedServerUsers } from "@/composables/useGroupedServerUsers";
import { ChannelType, UserStatus } from "@/lib/glue/argonChat";
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
   * Load all server details
   */
  const loadServerDetails = async () => {
    const servers = await api.userInteraction.GetSpaces();

    logger.log(`Loaded '${servers.length}' servers`);
    
    for (const server of servers) {
      await db.servers.put(server, server.spaceId);

      // Load archetypes
      try {
        const serverArchetypes =
          await api.serverInteraction.GetServerArchetypes(server.spaceId);

        logger.log(
          `Loaded '${serverArchetypes.length}' archetypes`,
          serverArchetypes
        );

        for (const arch of serverArchetypes) {
          await archetypeStore.trackArchetype(arch);
        }
      } catch (e) {
        logger.error(e, "failed receive archetypes for server", server.spaceId);
      }

      // Load users and members
      const users = await api.serverInteraction.GetMembers(server.spaceId);
      logger.log(`Loaded '${users.length}' users`, users);

      for (const u of users) {
        await archetypeStore.trackMember(u.member);
        if (u.member.user) {
          await userStore.trackUser(u.member.user, u.status, u.presence);
        }
      }

      // Set offline status for users not in the list
      const excludeSet = new Set(
        users.filter((x) => x.member).map((x) => x.member.userId)
      );

      await db.users
        .filter((user) => !excludeSet.has(user.userId))
        .modify((user) => {
          user.status = UserStatus.Offline;
          user.activity = undefined;
        });

      // Load channels
      const channels = await api.serverInteraction.GetChannels(server.spaceId);
      logger.log(`Loaded '${channels.length}' channels`, channels);

      const groups = await api.serverInteraction.GetChannelGroups(server.spaceId);
      logger.log(`Loaded '${groups.length}' channel groups`, groups);
      
      // Save channel groups to DB
      for (const group of groups) {
        await db.channelGroups.put(group, group.groupId);
      }
      
      const trackedIds: Guid[] = [];

      for (const c of channels) {
        if (c.channel.type === ChannelType.Text && !channelStore.selectedTextChannel) {
          channelStore.selectedTextChannel = c.channel.channelId;
        }
        
        trackedIds.push(c.channel.channelId);

        // Prepare users for realtime channel
        const realtimeUsers = new Map();
        for (const uw of c.users) {
          const selectedUser = users
            .filter((z) => z.member.userId === uw.userId)
            .at(0);
          
          if (!selectedUser) {
            await userStore.trackUser(
              await api.serverInteraction.PrefetchUser(server.spaceId, uw.userId)
            );
          }

          let member = selectedUser?.member.user;
          if (!member) {
            member = await api.serverInteraction.PrefetchUser(
              c.channel.spaceId,
              selectedUser?.member.userId || ""
            );
          }

          if (!selectedUser) {
            logger.fatal(
              "Cannot filter user from store, maybe bug",
              uw,
              users
            );
            continue;
          }

          realtimeUsers.set(uw.userId, {
            state: uw.state,
            userId: uw.userId,
            User: member,
            isSpeaking: false,
            isMuted: false,
            isScreenShare: false,
            volume: [100],
            isRecording: false,
          });
        }

        await channelStore.trackChannel(c.channel);
        realtimeStore.initRealtimeChannel(c.channel, realtimeUsers);
      }

      // Remove stale channels
      await channelStore.pruneChannels(server.spaceId, trackedIds);

      // Start listening to server events
      bus.listenEvents(server.spaceId);
    }
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

    // Events
    onNewMessageReceived: eventStore.onNewMessageReceived,

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
