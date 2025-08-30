import { logger } from "@/lib/logger";
import {
  type ArgonEntitlementFlag,
  extractEntitlements,
} from "@/lib/rbac/ArgonEntitlement";
import { computedAsync } from "@vueuse/core";
import { useObservable } from "@vueuse/rxjs";
import { liveQuery } from "dexie";
import { defineStore } from "pinia";
import { Subject, firstValueFrom, from } from "rxjs";
import {
  Raw,
  type Reactive,
  type Ref,
  computed,
  onUnmounted,
  reactive,
  ref,
} from "vue";
import { watch } from "vue";
import { useApi } from "./apiStore";
import { useBus } from "./busStore";
import { type RealtimeUser, db } from "./db/dexie";
import { useMe } from "./meStore";
import {
  Archetype,
  ArchetypeCreated,
  ArgonChannel,
  ArgonEntitlement,
  ArgonMessage,
  ArgonSpace,
  ArgonSpaceBase,
  ArgonUser,
  ChannelCreated,
  ChannelModified,
  ChannelRemoved,
  ChannelType,
  JoinedToChannelUser,
  JoinToServerUser,
  LeavedFromChannelUser,
  MessageSent,
  OnUserPresenceActivityChanged,
  OnUserPresenceActivityRemoved,
  RealtimeChannelUser,
  SpaceMember,
  SpaceMemberArchetype,
  UserActivityPresence,
  UserChangedStatus,
  UserStatus,
  UserUpdated,
} from "@/lib/glue/argonChat";
import { Guid, IonMaybe } from "@argon-chat/ion.webcore";

export interface MentionUser {
  id: string;
  displayName: string;
  username: string;
}

export type IRealtimeChannelUserWithData = RealtimeChannelUser & {
  User: ArgonUser;
  isSpeaking: Raw<Ref<boolean>>;
  isMuted: Raw<Ref<boolean>>;
  isScreenShare: Raw<Ref<boolean>>;
  volume: Raw<Ref<number[]>>;
};
export type IRealtimeChannelWithUser = {
  Channel: ArgonChannel;
  Users: Reactive<Map<Guid, IRealtimeChannelUserWithData>>;
};

export const usePoolStore = defineStore("data-pool", () => {
  const bus = useBus();
  const api = useApi();
  const me = useMe();

  const selectedServer = ref(null as Guid | null);
  const selectedChannel = ref(null as Guid | null);
  const selectedTextChannel = ref(null as Guid | null);

  const onChannelChanged = new Subject<Guid | null>();

  watch(selectedTextChannel, (newChannelId, oldChannelId) => {
    if (newChannelId !== oldChannelId) onChannelChanged.next(newChannelId);
  });

  const realtimeChannelUsers = reactive(
    new Map<Guid, Reactive<IRealtimeChannelWithUser>>()
  );

  const getChannel = async (channelId: Guid) =>
    await db.channels.where("channelId").equals(channelId).first();

  const getServer = async (serverId: Guid) =>
    await db.servers.where("spaceId").equals(serverId).first();

  const getUser = async (userId: Guid) =>
    await db.users.where("userId").equals(userId).first();

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

  const getMemberIdsByUserIdsQuery = (serverId: Guid, userIds: Guid[]) => {
    return liveQuery(async () => {
      const members = await db.members
        .where("[userId+spaceId]")
        .anyOf(userIds.map((id) => [id, serverId] as [Guid, Guid]))
        .toArray();
      return members.map((m) => m.memberId);
    });
  };

  const getMemberIdsByUserIds = async (serverId: Guid, userIds: Guid[]) => {
    const members = await db.members
      .where("[userId+spaceId]")
      .anyOf(userIds.map((id) => [id, serverId] as [Guid, Guid]))
      .toArray();
    return members.map((m) => m.memberId);
  };

  const getUserReactive = (userId: Guid) => {
    const observable = liveQuery(
      async () => await db.users.where("userId").equals(userId).first()
    );
    return useObservable(from(observable));
  };

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

  const refreshAllArchetypesForServer = async (serverId: Guid) => {
    const serverArchetypes =
      await api.serverInteraction.GetServerArchetypes(serverId);

    logger.log(
      `Loaded '${serverArchetypes.length}' archetypes`,
      serverArchetypes
    );

    for (const arch of serverArchetypes) {
      trackArchetype(arch);
    }
  };

  const getDetailedArchetypesAndRefreshDb = async (serverId: Guid) => {
    const serverArchetypes =
      await api.serverInteraction.GetDetailedServerArchetypes(serverId);

    logger.log(
      `Loaded '${serverArchetypes.length}' archetypes`,
      serverArchetypes
    );

    for (const arch of serverArchetypes) {
      trackArchetype(arch.archetype);
    }

    return serverArchetypes;
  };

  const getMePermissions = ref<Set<ArgonEntitlementFlag>>(new Set());

  let currentSubscription: { unsubscribe(): void } | null = null;

  watch(
    [() => selectedServer.value, () => me.me?.userId],
    ([serverId, userId]) => {
      currentSubscription?.unsubscribe();

      if (!serverId || !userId) {
        getMePermissions.value = new Set();
        return;
      }

      currentSubscription = liveQuery(async () => {
        const member = await db.members
          .where("[userId+spaceId]")
          .equals([userId, serverId])
          .first();


        if (!member) {
          logger.warn("no found member for fetch self entitlement");
          return new Set<ArgonEntitlementFlag>();
        }

        if (!member.archetypes) {
          logger.warn("no found archetypes for self member for fetch self entitlement");
          return new Set<ArgonEntitlementFlag>();
        }

        if (member.archetypes.length == 0) {
          logger.warn("empty archetypes, failed fetch self entitlement");
          return new Set<ArgonEntitlementFlag>();
        }

        const archetypeIds = member.archetypes.map((a) => a.archetypeId);
        const archetypes = await db.archetypes
          .where("id")
          .anyOf(archetypeIds)
          .toArray();

        const flags = archetypes.flatMap((x) =>
          extractEntitlements(BigInt(x.entitlement))
        );

        return new Set(flags);
      }).subscribe({
        next(value) {
          getMePermissions.value = value;
        },
        error(err) {
          console.error("LiveQuery error", err);
        },
      });
    },
    { immediate: true }
  );

  onUnmounted(() => {
    currentSubscription?.unsubscribe();
  });

  const has = computed(() => {
    return (flag: ArgonEntitlementFlag): boolean =>
      getMePermissions.value.has(flag);
  });

  const indicateSpeaking = async (
    channelId: Guid,
    userId: Guid,
    isSpeaking: boolean
  ) => {
    if (realtimeChannelUsers.has(channelId)) {
      if (realtimeChannelUsers.get(channelId)?.Users.has(userId)) {
        const user = realtimeChannelUsers.get(channelId)?.Users.get(userId);
        if (user) {
          user.isSpeaking = isSpeaking;
        }
      } else {
        logger.warn(
          "Detected speaking user, but in realtime channel user not found, maybe bug",
          channelId,
          userId
        );
      }
    } else {
      logger.warn(
        "Detected speaking user, but in realtime channel not found, maybe bug",
        channelId,
        userId
      );
    }
  };

  const setProperty = async (
    channelId: Guid,
    userId: Guid,
    action: (user: IRealtimeChannelUserWithData) => void
  ) => {
    if (realtimeChannelUsers.has(channelId)) {
      if (realtimeChannelUsers.get(channelId)?.Users.has(userId)) {
        const user = realtimeChannelUsers.get(channelId)?.Users.get(userId);
        if (user) {
          action(user as any);
        }
      } else {
        logger.warn(
          "Detected speaking user, but in realtime channel user not found, maybe bug",
          channelId,
          userId
        );
      }
    } else {
      logger.warn(
        "Detected speaking user, but in realtime channel not found, maybe bug",
        channelId,
        userId
      );
    }
  };

  const allServerAsync = computed(() =>
    firstValueFrom<ArgonSpaceBase[]>(
      from(liveQuery(async () => await db.servers.toArray()))
    )
  );

  const getSelectedServer = computedAsync(async () => {
    if (!selectedServer.value) return null;
    return (
      (await db.servers
        .where("spaceId")
        .equals(selectedServer.value)
        .first()) || null
    );
  });

  const activeServerChannels = computed(() => {
    return useObservable<ArgonChannel[]>(
      from(
        liveQuery<ArgonChannel[]>(() => {
          if (!selectedServer.value) return [];
          return db.channels
            .where("spaceId")
            .equals(selectedServer.value)
            .toArray();
        })
      )
    );
  });

  const generateBadgesByArchetypes = async (
    archetypes: SpaceMemberArchetype[]
  ): Promise<string[]> => {
    if (!archetypes || archetypes.length === 0) return [];

    const ids = archetypes.map((x) => x.archetypeId);

    const results = await db.archetypes
      .where("id")
      .anyOf(ids)
      .filter((q) => q.isHidden && q.isLocked && q.name === "owner")
      .toArray();

    return results.map((x) => x.name);
  };

  const groupedServerUsers = computed(() => {
    return useObservable(
      from(
        liveQuery(async () => {
          if (!selectedServer.value) return [];
          const server = await db.servers
            .filter((s) => s.spaceId === selectedServer.value)
            .first();
          if (!server) return [];

          const members = await db.members
            .filter((x) => x.spaceId == server.spaceId)
            .toArray();
          const users = await db.users.bulkGet(members.map((x) => x.userId));

          const allArchetypeIds = [
            ...new Set(
              members
                .filter((m): m is NonNullable<typeof m> => !!m)
                .flatMap((m) => m.archetypes.map((a) => a.archetypeId))
            ),
          ];

          const archetypes = await db.archetypes.bulkGet(allArchetypeIds);

          const groupArchetypes = [
            ...new Map(
              archetypes
                .filter((a): a is Archetype => !!a && a.isGroup)
                .map((a) => [a.id, a])
            ).values(),
          ].sort((a, b) => a.name.localeCompare(b.name));

          const usersWithArchetypes = users
            .filter((u): u is RealtimeUser => !!u)
            .map((user) => {
              const member = members.find((m) => m?.userId === user.userId);
              if (member) {
                const userArchetypes = archetypes.filter((a) =>
                  member.archetypes.some((x) => x.archetypeId === a?.id)
                ) as Archetype[];
                user.archetypes = userArchetypes;
              }
              return user;
            });

          const sortFn = (a: RealtimeUser, b: RealtimeUser) => {
            const statusOrder = (status: UserStatus) => {
              if (status === UserStatus.Online) return 0;
              if (status === UserStatus.Offline) return 2;
              return 1;
            };
            const statusDiff = statusOrder(a.status) - statusOrder(b.status);
            if (statusDiff !== 0) return statusDiff;
            return a.displayName.localeCompare(b.displayName);
          };

          const groupMap = new Map<Guid, RealtimeUser[]>();
          const ungroupedUsers: RealtimeUser[] = [];

          for (const user of usersWithArchetypes) {
            const groupRoles = (user.archetypes ?? []).filter((a) => a.isGroup);

            if (groupRoles.length > 0) {
              const targetGroup = groupArchetypes.find((g) =>
                groupRoles.some((r) => r.id === g.id)
              );

              if (targetGroup) {
                if (!groupMap.has(targetGroup.id)) {
                  groupMap.set(targetGroup.id, []);
                }
                groupMap.get(targetGroup.id)!.push(user);
              } else {
                ungroupedUsers.push(user);
              }
            } else {
              ungroupedUsers.push(user);
            }
          }

          const result: {
            archetype: Archetype;
            users: RealtimeUser[];
          }[] = [];

          for (const group of groupArchetypes) {
            const groupUsers = (groupMap.get(group.id) ?? []).sort(sortFn);
            if (groupUsers.length > 0) {
              result.push({
                archetype: group,
                users: groupUsers,
              });
            }
          }

          if (ungroupedUsers.length > 0) {
            result.push({
              archetype: {
                id: "00000000-0000-0000-0000-000000000000",
                spaceId: selectedServer.value,
                name: "Users",
                description: "",
                isMentionable: false,
                colour: 0xffffffff,
                isHidden: false,
                isLocked: false,
                isGroup: true,
                entitlement: ArgonEntitlement.None,
                isDefault: false,
                iconFileId: null,
              },
              users: ungroupedUsers.sort(sortFn),
            });
          }
          return result;
        })
      )
    );
  });

  const trackServer = async (server: ArgonSpaceBase) => {
    await db.servers.put(
      server,
      server.spaceId
    );
  };

  const trackArchetype = async (archetype: Archetype) => {
    await db.archetypes.put(archetype, archetype.id);
  };

  const trackMember = async (member: SpaceMember) => {
    await db.members.put(member, member.memberId);
  };

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
          ((
            extendedStatus
              ? extendedStatus
              : exist.status === UserStatus.Offline
          )
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

  const trackChannel = async (
    channel: ArgonChannel,
    users?: Map<Guid, IRealtimeChannelUserWithData>
  ) => {
    realtimeChannelUsers.set(
      channel.channelId,
      reactive({
        Channel: channel,
        Users: users ?? new Map<Guid, IRealtimeChannelUserWithData>(),
      })
    );
    const exist = await db.channels.get(channel.channelId);

    if (exist) {
      await db.channels.update(exist.channelId, (x) => {
        Object.assign(x, channel);
      });
      return;
    }
    await db.channels.put(channel, channel.channelId);
  };

  const onNewMessageReceived: Subject<ArgonMessage> =
    new Subject<ArgonMessage>();

  const subscribeToEvents = () => {
    bus.onServerEvent<ChannelCreated>("ChannelCreated", async (x) => {
      const c = await db.servers.get(x.serverId);
      if (c) {
        await db.channels.put(x.data);
      } else {
        logger.error("recollect server required, maybe bug");
      }

      await trackChannel(x.data);
    });
    bus.onServerEvent<ChannelRemoved>("ChannelRemoved", async (x) => {
      if (realtimeChannelUsers.has(x.channelId)) {
        realtimeChannelUsers.delete(x.channelId);
      }

      const channelId = x.channelId;
      const channel = await db.channels.get(channelId);
      if (!channel) {
        console.error(`Channel with ID ${channelId} not found.`);
        return;
      }

      await db.channels.delete(channelId);
    });

    bus.onServerEvent<LeavedFromChannelUser>(
      "LeavedFromChannelUser",
      async (x) => {
        const c = db.channels.get(x.channelId);

        if (!c) {
          logger.error("recollect channel required");
          return;
        }

        if (realtimeChannelUsers.has(x.channelId)) {
          const e = realtimeChannelUsers.get(x.channelId);

          if (!e)
            throw new Error(
              " realtimeChannelUsers.get(x.channelId) return null"
            );

          if (e.Users.has(x.userId)) {
            e.Users.delete(x.userId);
          }
        }
      }
    );

    bus.onServerEvent<JoinedToChannelUser>("JoinedToChannelUser", async (x) => {
      const c = db.channels.get(x.channelId);

      if (!c) {
        logger.error("recollect channel required");
        return;
      }
      let user = await db.users.get(x.userId);
      if (!user) {
        trackUser(
          await api.serverInteraction.PrefetchUser(x.serverId, x.userId)
        );
        user = await db.users.get(x.userId);
        if (!user) throw new Error("await db.users.get(x.userId) return null");
      }

      if (realtimeChannelUsers.has(x.channelId)) {
        const e = realtimeChannelUsers.get(x.channelId);

        if (!e)
          throw new Error(" realtimeChannelUsers.get(x.channelId) return null");

        e.Users.set(x.userId, {
          state: 0,
          userId: x.userId,
          User: user,
          isSpeaking: ref(false) as any,
          isMuted: ref(false) as any,
          isScreenShare: ref(false) as any,
          volume: ref([100]) as any,
        });
      } else
        logger.error(
          "realtime channel not contains received from JoinedToChannelUser channel, maybe bug"
        );
    });

    bus.onServerEvent<JoinToServerUser>("JoinToServerUser", async (x) => {
      const s = await db.servers.get(x.serverId);

      if (!s) {
        logger.error(
          "bug, JoinToServerUser request cannot get server assigned, missed cache?"
        );
        return;
      }

      const existsUser =
        (await db.users.where("userId").equals(x.userId).count()) > 0;
      if (!existsUser) {
        const user = await api.serverInteraction.GetMember(
          x.serverId,
          x.userId
        );
        db.members.put(user.member);
        await db.servers.put(s);
        logger.info("Fetchet member for server", x);
      }
    });

    bus.onServerEvent<ChannelModified>("ChannelModified", () => {
      // TODO
      //trackChannel({ Channel: x., Users: [] });
    });

    bus.onServerEvent<UserUpdated>("UserUpdated", (x) => {
      trackUser(x.dto);
      if (x.dto.userId === me.me?.userId) {
        me.me.avatarFileId = x.dto.avatarFileId;
        me.me.displayName = x.dto.displayName;
        me.me.username = x.dto.username;
      }
    });

    bus.onServerEvent<OnUserPresenceActivityChanged>(
      "OnUserPresenceActivityChanged",
      async (x) => {
        let user = await db.users.get(x.userId);
        if (!user) {
          trackUser(
            await api.serverInteraction.PrefetchUser(x.serverId, x.userId)
          );
          user = await db.users.get(x.userId);
          if (!user)
            throw new Error("await db.users.get(x.userId) return null");
        }
        user.activity = x.presence;
        await db.users.put(user);
      }
    );

    bus.onServerEvent<OnUserPresenceActivityRemoved>(
      "OnUserPresenceActivityRemoved",
      async (x) => {
        let user = await db.users.get(x.userId);
        if (!user) {
          trackUser(
            await api.serverInteraction.PrefetchUser(x.serverId, x.userId)
          );
          user = await db.users.get(x.userId);
          if (!user)
            throw new Error("await db.users.get(x.userId) return null");
        }
        user.activity = undefined;
        await db.users.put(user);
      }
    );

    bus.onServerEvent<UserChangedStatus>("UserChangedStatus", async (x) => {
      const user = await db.users.get(x.userId);
      if (!user) {
        trackUser(
          await api.serverInteraction.PrefetchUser(x.serverId, x.userId),
          x.status
        );
        return;
      }
      user.status = x.status;

      if (x.status === UserStatus.Offline && user.activity) {
        user.activity = undefined;
      }

      db.users.put(user);
    });

    bus.onServerEvent<MessageSent>("MessageSent", (x) => {
      onNewMessageReceived.next(x.message);
    });

    bus.onServerEvent<ArchetypeCreated>("ArchetypeCreated", (x) => {
      void trackArchetype(x.data);
    });
    /*bus.onServerEvent<ArchetypeChanged>("ArchetypeChanged", (x) => {
      void trackArchetype(x.dto);
    });*/
  };

  const refershDatas = async () => {
    await loadServerDetails(false);
  };

  const loadServerDetails = async (listenEvents = true) => {
    if (listenEvents) subscribeToEvents();

    const servers = await api.userInteraction.GetSpaces();

    logger.log(`Loaded '${servers.length}' servers`);
    for (const s of servers) {
      await trackServer(s);

      try {
        const serverArchetypes =
          await api.serverInteraction.GetServerArchetypes(s.spaceId);

        logger.log(
          `Loaded '${serverArchetypes.length}' archetypes`,
          serverArchetypes
        );

        for (const arch of serverArchetypes) {
          trackArchetype(arch);
        }
      } catch (e) {
        logger.error(e, "failed receive archetypes for server", s.spaceId);
      }

      const users = await api.serverInteraction.GetMembers(s.spaceId);
      logger.log(`Loaded '${users.length}' users`, users);

      for (const u of users) {
        await trackMember(u.member);
        if (u.member.user)
          await trackUser(
            u.member.user,
            u.status,
            u.presence
          );
      }

      const excludeSet = new Set(
        users.filter((x) => x.member).map((x) => x.member.userId)
      );

      await db.users
        .filter((user) => !excludeSet.has(user.userId))
        .modify((user) => {
          user.status = UserStatus.Offline;
          user.activity = undefined;
        });

      const channels = await api.serverInteraction.GetChannels(s.spaceId);

      logger.log(`Loaded '${channels.length}' channels`, channels);
      const trackedIds: Array<Guid> = [];

      for (const c of channels) {
        if (c.channel.type === ChannelType.Text && !selectedTextChannel.value) {
          selectedTextChannel.value = c.channel.channelId;
        }
        trackedIds.push(c.channel.channelId);
        const we = new Map<Guid, IRealtimeChannelUserWithData>();
        for (const uw of c.users) {
          const selectedUser = users
            .filter((z) => z.member.userId === uw.userId)
            .at(0);
          if (!selectedUser) {
            trackUser(
              await api.serverInteraction.PrefetchUser(s.spaceId, uw.userId)
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
              "Cannot fileter user from store, and cannot prefetch user from user, its bug or maybe trying use member id, memberId != userId",
              uw,
              users
            );
            continue;
          }
          we.set(uw.userId, {
            state: uw.state,
            userId: uw.userId,
            User: member,
            isSpeaking: ref(false),
            isMuted: ref(false),
            isScreenShare: ref(false),
            volume: ref([100]),
          });
        }
        await trackChannel(c.channel, we);
      }

      const prunedChannels = await db.channels
        .where("channelId")
        .noneOf([...trackedIds])
        .and((q) => q.spaceId === s.spaceId)
        .delete();

      if (prunedChannels !== 0)
        logger.warn(`Pruned ${prunedChannels} channels`);

      if (listenEvents) bus.listenEvents(s.spaceId);
    }
  };

  return {
    allServerAsync,

    trackUser,
    trackServer,
    trackChannel,

    activeServerChannels,
    groupedServerUsers,
    subscribeToEvents,

    selectedServer,
    selectedChannel,
    selectedTextChannel,
    onChannelChanged,
    onNewMessageReceived,

    loadServerDetails,
    getSelectedServer,
    refershDatas,

    realtimeChannelUsers,
    indicateSpeaking,
    setProperty,

    getUser,
    getChannel,
    getServer,
    getUserReactive,

    searchMentions,
    searchUser,
    generateBadgesByArchetypes,
    getMePermissions,
    db,
    has,
    refreshAllArchetypesForServer,
    getDetailedArchetypesAndRefreshDb,
    getUsersByServerMemberIds,
    getMemberIdsByUserIdsQuery,
    getMemberIdsByUserIds,
  };
});
