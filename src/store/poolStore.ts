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

export interface MentionUser {
  id: string;
  displayName: string;
  username: string;
}

export type IRealtimeChannelUserWithData = IRealtimeChannelUser & {
  User: IUserDto;
  isSpeaking: Ref<boolean>;
  isMuted: Ref<boolean>;
  isScreenShare: Ref<boolean>;
  volume: Ref<number[]>;
};
export type IRealtimeChannelWithUser = {
  Channel: IChannel;
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

  const allServers = computed(() => {
    return useObservable(
      from(liveQuery(async () => await db.servers.toArray()))
    );
  });

  const getChannel = async (channelId: Guid) =>
    await db.channels.where("Id").equals(channelId).first();

  const getServer = async (serverId: Guid) =>
    await db.servers.where("Id").equals(serverId).first();

  const getUser = async (userId: Guid) =>
    await db.users.where("UserId").equals(userId).first();

  const getUsersByServerMemberIds = (serverId: Guid, memberIds: Guid[]) => {
    return liveQuery(async () => {
      const members = await db.members
        .where("[MemberId+ServerId]")
        .anyOf(memberIds.map((id) => [id, serverId] as [Guid, Guid]))
        .toArray();
      const userIds = members.map((m) => m.UserId);
      const users = await db.users.where("UserId").anyOf(userIds).toArray();
      return users;
    });
  };

  const getMemberIdsByUserIdsQuery = (serverId: Guid, userIds: Guid[]) => {
    return liveQuery(async () => {
      const members = await db.members
        .where("[UserId+ServerId]")
        .anyOf(userIds.map((id) => [id, serverId] as [Guid, Guid]))
        .toArray();
      return members.map((m) => m.MemberId);
    });
  };

  const getMemberIdsByUserIds = async (serverId: Guid, userIds: Guid[]) => {
    const members = await db.members
      .where("[UserId+ServerId]")
      .anyOf(userIds.map((id) => [id, serverId] as [Guid, Guid]))
      .toArray();
    return members.map((m) => m.MemberId);
  };

  const getUserReactive = (userId: Guid) => {
    const observable = liveQuery(
      async () => await db.users.where("UserId").equals(userId).first()
    );
    return useObservable(from(observable));
  };

  async function searchMentions(query: string): Promise<MentionUser[]> {
    const normalized = query.toLowerCase();
    return await db.users
      .filter((user: RealtimeUser) => {
        return (
          user.Username.toLowerCase().includes(normalized) ||
          user.DisplayName.toLowerCase().includes(normalized)
        );
      })
      .limit(10)
      .toArray()
      .then((users) =>
        users.map((u) => ({
          id: u.UserId,
          displayName: u.DisplayName,
          username: u.Username,
        }))
      );
  }

  async function searchUser(query: string): Promise<RealtimeUser[]> {
    const normalized = query.toLowerCase();
    return await db.users
      .filter((user: RealtimeUser) => {
        return (
          user.Username.toLowerCase().includes(normalized) ||
          user.DisplayName.toLowerCase().includes(normalized)
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
      trackArchetype(arch.Archetype);
    }

    return serverArchetypes;
  };

  const getMePermissions = ref<Set<ArgonEntitlementFlag>>(new Set());

  let currentSubscription: { unsubscribe(): void } | null = null;

  watch(
    [() => selectedServer.value, () => me.me?.Id],
    ([serverId, userId]) => {
      // убить старую подписку
      currentSubscription?.unsubscribe();

      if (!serverId || !userId) {
        getMePermissions.value = new Set();
        return;
      }

      currentSubscription = liveQuery(async () => {
        const member = await db.members
          .where("[UserId+ServerId]")
          .equals([userId, serverId])
          .first();

        if (!member?.Archetypes?.length) return new Set<ArgonEntitlementFlag>();

        const archetypeIds = member.Archetypes.map((a) => a.ArchetypeId);
        const archetypes = await db.archetypes
          .where("Id")
          .anyOf(archetypeIds)
          .toArray();

        const flags = archetypes.flatMap((x) =>
          extractEntitlements(BigInt(x.Entitlement))
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
    firstValueFrom<IServerDto[]>(
      from(liveQuery(async () => await db.servers.toArray()))
    )
  );

  const getSelectedServer = computedAsync(async () => {
    if (!selectedServer.value) return null;
    return (
      (await db.servers.where("Id").equals(selectedServer.value).first()) ||
      null
    );
  });

  const activeServerChannels = computed(() => {
    return useObservable<IChannel[]>(
      from(
        liveQuery<IChannel[]>(() => {
          if (!selectedServer.value) return [];
          return db.channels
            .where("ServerId")
            .equals(selectedServer.value)
            .toArray();
        })
      )
    );
  });

  const generateBadgesByArchetypes = async (
    archetypes: IServerMemberArchetypeDto[]
  ): Promise<string[]> => {
    if (!archetypes || archetypes.length === 0) return [];

    const ids = archetypes.map((x) => x.ArchetypeId);

    const results = await db.archetypes
      .where("Id")
      .anyOf(ids)
      .filter((q) => q.IsHidden && q.IsLocked && q.Name === "owner")
      .toArray();

    return results.map((x) => x.Name);
  };

  const activeServerUsers = computed(() => {
    return useObservable(
      from(
        liveQuery(async () => {
          if (!selectedServer.value) return [];
          const server = await db.servers
            .filter((s) => s.Id === selectedServer.value)
            .first();
          if (!server) return [];
          const users = await db.users.bulkGet(
            server.Users.map((x) => x.UserId)
          );
          const members = await db.members.bulkGet(
            server.Users.map((x) => x.MemberId)
          );
          const archetypes = await db.archetypes.bulkGet(
            members
              .filter((x) => !!x)
              .flatMap((x) => x?.Archetypes)
              .map((x) => x?.ArchetypeId)
          );

          return users
            .filter((user): user is RealtimeUser => !!user)
            .sort((a, b) => {
              const statusOrder = (status: string) => {
                if (status === "Online") return 0;
                if (status === "Offline") return 2;
                return 1;
              };

              const statusDiff = statusOrder(a.status) - statusOrder(b.status);
              if (statusDiff !== 0) return statusDiff;
              return a.DisplayName.localeCompare(b.DisplayName);
            })
            .map((q) => {
              const meb = members.find((w) => w?.UserId === q.UserId);

              if (meb)
                q.archetypes = archetypes.filter((we) =>
                  new Set(meb.Archetypes.map((x) => x.ArchetypeId)).has(
                    we?.Id as string
                  )
                ) as IArchetypeDto[];

              return q;
            });
        })
      )
    );
  });

const groupedServerUsers = computed(() => {
  return useObservable(
    from(
      liveQuery(async () => {
        if (!selectedServer.value) return [];

        const server = await db.servers
          .filter((s) => s.Id === selectedServer.value)
          .first();
        if (!server) return [];

        const users = await db.users.bulkGet(
          server.Users.map((x) => x.UserId)
        );
        const members = await db.members.bulkGet(
          server.Users.map((x) => x.MemberId)
        );

        // Уникальные ArchetypeId
        const allArchetypeIds = [
          ...new Set(
            members
              .filter((m): m is NonNullable<typeof m> => !!m)
              .flatMap((m) => m.Archetypes.map((a) => a.ArchetypeId))
          ),
        ];

        const archetypes = await db.archetypes.bulkGet(allArchetypeIds);

        // Удаление дубликатов group-архетипов по Id
        const groupArchetypes = [
          ...new Map(
            archetypes
              .filter((a): a is IArchetypeDto => !!a && a.IsGroup)
              .map((a) => [a.Id, a])
          ).values(),
        ].sort((a, b) => a.Name.localeCompare(b.Name)); // сортировка по имени

        const usersWithArchetypes = users
          .filter((u): u is RealtimeUser => !!u)
          .map((user) => {
            const member = members.find((m) => m?.UserId === user.UserId);
            if (member) {
              const userArchetypes = archetypes.filter((a) =>
                member.Archetypes.some((x) => x.ArchetypeId === a?.Id)
              ) as IArchetypeDto[];
              user.archetypes = userArchetypes;
            }
            return user;
          });

        const sortFn = (a: RealtimeUser, b: RealtimeUser) => {
          const statusOrder = (status: string) => {
            if (status === "Online") return 0;
            if (status === "Offline") return 2;
            return 1;
          };
          const statusDiff = statusOrder(a.status) - statusOrder(b.status);
          if (statusDiff !== 0) return statusDiff;
          return a.DisplayName.localeCompare(b.DisplayName);
        };

        const groupMap = new Map<Guid, RealtimeUser[]>();
        const ungroupedUsers: RealtimeUser[] = [];

        for (const user of usersWithArchetypes) {
          const groupRoles = (user.archetypes ?? []).filter((a) => a.IsGroup);

          if (groupRoles.length > 0) {
            // Берём первую подходящую группу по приоритету из groupArchetypes
            const targetGroup = groupArchetypes.find((g) =>
              groupRoles.some((r) => r.Id === g.Id)
            );

            if (targetGroup) {
              if (!groupMap.has(targetGroup.Id)) {
                groupMap.set(targetGroup.Id, []);
              }
              groupMap.get(targetGroup.Id)!.push(user);
            } else {
              ungroupedUsers.push(user);
            }
          } else {
            ungroupedUsers.push(user);
          }
        }

        const result: {
          archetype: IArchetypeDto;
          users: RealtimeUser[];
        }[] = [];

        for (const group of groupArchetypes) {
          const groupUsers = (groupMap.get(group.Id) ?? []).sort(sortFn);
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
              Id: "00000000-0000-0000-0000-000000000000",
              ServerId: selectedServer.value,
              Name: "Users",
              Description: "",
              IsMentionable: false,
              Colour: 0xffffffff,
              IsHidden: false,
              IsLocked: false,
              IsGroup: true,
              Entitlement: "",
              IsDefault: false,
            },
            users: ungroupedUsers.sort(sortFn),
          });
        }

        return result;
      })
    )
  );
});

  const trackServer = async (server: IServerDto) => {
    await db.servers.put(server, server.Id);
  };

  const trackArchetype = async (archetype: IArchetypeDto) => {
    await db.archetypes.put(archetype, archetype.Id);
  };

  const trackMember = async (member: IServerMemberDto) => {
    await db.members.put(member, member.MemberId);
  };

  const trackUser = async (
    user: IUserDto,
    extendedStatus?: UserStatus,
    extendedActivity?: IUserActivityPresence
  ) => {
    const exist = await db.users.get(user.UserId);
    if (exist) {
      await db.users.update(exist.UserId, {
        ...user,
        status: extendedStatus ? extendedStatus : exist.status,
        activity:
          extendedActivity ??
          ((extendedStatus ? extendedStatus : exist.status === "Offline")
            ? undefined
            : exist.activity),
      });
      return;
    }
    await db.users.put(
      {
        ...user,
        status: extendedStatus ?? "Offline",
        activity: extendedActivity ?? undefined,
      },
      user.UserId
    );
  };

  const trackChannel = async (
    channel: IChannel,
    users?: Map<Guid, IRealtimeChannelUserWithData>
  ) => {
    realtimeChannelUsers.set(
      channel.Id,
      reactive({
        Channel: channel,
        Users: users ?? new Map<Guid, IRealtimeChannelUserWithData>(),
      })
    );
    const exist = await db.channels.get(channel.Id);

    if (exist) {
      await db.channels.update(exist.Id, (x) => {
        Object.assign(x, channel);
      });
      return;
    }
    await db.channels.put(channel, channel.Id);
  };

  const onNewMessageReceived: Subject<IArgonMessageDto> =
    new Subject<IArgonMessageDto>();

  const subscribeToEvents = () => {
    bus.onServerEvent<ChannelCreated>("ChannelCreated", async (x) => {
      const c = await db.servers.get(x.serverId);

      if (c) {
        c.Channels.push(x.channel);
        await db.servers.put(c);
      } else {
        logger.error("recollect server required, maybe bug");
      }

      await trackChannel(x.channel);
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

      const server = await db.servers.get(x.serverId);
      if (server) {
        server.Channels = server.Channels.filter(
          (channel) => channel.Id !== channelId
        );
        await db.servers.put(server);
      }
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
          State: 0,
          UserId: x.userId,
          User: user,
          // @ts-expect-error Пошел нахуй
          isSpeaking: ref(false),
          // @ts-expect-error Пошел нахуй
          isMuted: ref(false),
          // @ts-expect-error Пошел нахуй
          isScreenShare: ref(false),
          // @ts-expect-error Пошел нахуй
          volume: ref([100]),
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
        (await db.users.where("UserId").equals(x.userId).count()) > 0;
      if (!existsUser) {
        const user = await api.serverInteraction.GetMember(
          x.serverId,
          x.userId
        );
        s.Users.push(user.Member);
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
      if (x.dto.UserId === me.me?.Id) {
        me.me.AvatarFileId = x.dto.AvatarFileId;
        me.me.DisplayName = x.dto.DisplayName;
        me.me.Username = x.dto.Username;
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

      if (x.status === "Offline" && user.activity) {
        user.activity = undefined;
      }

      db.users.put(user);
    });

    bus.onServerEvent<MessageSent>("MessageSent", (x) => {
      onNewMessageReceived.next(x.message);
    });

    bus.onServerEvent<ArchetypeCreated>("ArchetypeCreated", (x) => {
      void trackArchetype(x.dto);
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

    const servers = await api.userInteraction.GetServers();

    logger.log(`Loaded '${servers.length}' servers`);
    for (const s of servers) {
      await trackServer(s);

      try {
        const serverArchetypes =
          await api.serverInteraction.GetServerArchetypes(s.Id);

        logger.log(
          `Loaded '${serverArchetypes.length}' archetypes`,
          serverArchetypes
        );

        for (const arch of serverArchetypes) {
          trackArchetype(arch);
        }
      } catch (e) {
        logger.error(e, "failed receive archetypes for server", s.Id);
      }

      const users = await api.serverInteraction.GetMembers(s.Id);
      logger.log(`Loaded '${users.length}' users`, users);

      for (const u of users) {
        await trackMember(u.Member);
        if (u.Member.User) await trackUser(u.Member.User, u.Status, u.Presence);
      }

      const excludeSet = new Set(
        users.filter((x) => x.Member).map((x) => x.Member.UserId)
      );

      await db.users
        .filter((user) => !excludeSet.has(user.UserId))
        .modify((user) => {
          user.status = "Offline";
          user.activity = undefined;
        });

      const channels = await api.serverInteraction.GetChannels(s.Id);

      logger.log(`Loaded '${channels.length}' channels`, channels);
      const trackedIds: Array<Guid> = [];

      for (const c of channels) {
        if (c.Channel.ChannelType === "Text" && !selectedTextChannel.value) {
          selectedTextChannel.value = c.Channel.Id;
        }
        trackedIds.push(c.Channel.Id);
        const we = new Map<Guid, IRealtimeChannelUserWithData>();
        for (const uw of c.Users) {
          const selectedUser = users
            .filter((z) => z.Member.UserId === uw.UserId)
            .at(0);
          if (!selectedUser) {
            trackUser(
              await api.serverInteraction.PrefetchUser(s.Id, uw.UserId)
            );
          }

          let member = selectedUser?.Member.User;

          if (!member) {
            member = await api.serverInteraction.PrefetchUser(
              c.Channel.ServerId,
              selectedUser?.Member.UserId || ""
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
          we.set(uw.UserId, {
            State: uw.State,
            UserId: uw.UserId,
            User: member,
            isSpeaking: ref(false),
            isMuted: ref(false),
            isScreenShare: ref(false),
            volume: ref([100]),
          });
        }
        await trackChannel(c.Channel, we);
      }

      const prunedChannels = await db.channels
        .where("Id")
        .noneOf([...trackedIds])
        .and((q) => q.ServerId === s.Id)
        .delete();

      if (prunedChannels !== 0)
        logger.warn(`Pruned ${prunedChannels} channels`);

      if (listenEvents) bus.listenEvents(s.Id);
    }
  };

  return {
    allServers,
    allServerAsync,

    trackUser,
    trackServer,
    trackChannel,

    activeServerChannels,
    activeServerUsers,
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
    getMemberIdsByUserIds
  };
});
