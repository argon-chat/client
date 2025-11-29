import { logger } from "@/lib/logger";
import {
  type ArgonEntitlementFlag,
  extractEntitlements,
} from "@/lib/rbac/ArgonEntitlement";
import { computedAsync } from "@vueuse/core";
import { useObservable } from "@vueuse/rxjs";
import { liveQuery, Subscription } from "dexie";
import { defineStore } from "pinia";
import {
  Subject,
  distinctUntilChanged,
  firstValueFrom,
  from,
  switchMap,
} from "rxjs";
import {
  ComputedRef,
  ModelRef,
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
  ArgonSpaceBase,
  ArgonUser,
  CallFinished,
  CallIncoming,
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
  RecordEnded,
  RecordStarted,
  SpaceMember,
  SpaceMemberArchetype,
  UserActivityPresence,
  UserChangedStatus,
  UserStatus,
  UserUpdated,
} from "@/lib/glue/argonChat";
import { Guid, IonMaybe } from "@argon-chat/ion.webcore";
import { createCustomEqual } from "fast-equals";
import { useCallStore } from "./callStore";

const deepEqual = createCustomEqual({ strict: true });

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
  isRecoding: Raw<Ref<boolean>>;
};
export type IRealtimeChannelWithUser = {
  Channel: ArgonChannel;
  Users: Reactive<Map<Guid, IRealtimeChannelUserWithData>>;
  isRecordingActive: Raw<Ref<boolean>>;
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
          logger.warn(
            "no found archetypes for self member for fetch self entitlement"
          );
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
          "Trying call setProperty, but in realtime channel user not found, maybe bug",
          channelId,
          userId
        );
      }
    } else {
      logger.warn(
        "Trying call, but in realtime channel not found, maybe bug",
        channelId,
        userId
      );
    }
  };

  const setPropertyQuery = async (
    channelId: Guid,
    predicate: (user: IRealtimeChannelUserWithData) => boolean,
    action: (user: IRealtimeChannelUserWithData) => void
  ) => {
    const channel = realtimeChannelUsers.get(channelId);

    if (!channel) {
      logger.warn("Realtime channel not found", channelId);
      return;
    }

    for (const user of channel.Users.values()) {
      try {
        if (predicate(user as any)) {
          action(user as any);
        }
      } catch (err) {
        logger.error("Error during predicate/action execution", err);
      }
    }
  };

  function useAllServers() {
    const obs = useObservable(from(liveQuery(() => db.servers.toArray())), {
      initialValue: [] as ArgonSpaceBase[],
    })!;

    return computed(() => obs.value ?? []);
  }

  const getSelectedServer = computedAsync(async () => {
    if (!selectedServer.value) return null;
    return (
      (await db.servers
        .where("spaceId")
        .equals(selectedServer.value)
        .first()) || null
    );
  });

  function useActiveServerChannels(spaceId: Ref<Guid | null>) {
    const result = ref<ArgonChannel[]>([]);

    let sub: Subscription | null = null;

    watch(
      spaceId,
      (id) => {
        sub?.unsubscribe();
        if (!id) {
          result.value = [];
          return;
        }

        sub = liveQuery(() =>
          db.channels.where("spaceId").equals(id).toArray()
        ).subscribe((channels) => {
          result.value = channels;
        });
      },
      { immediate: true }
    );

    onUnmounted(() => sub?.unsubscribe());

    return result;
  }

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

  function useGroupedServerUsers(
    serverId: Ref<Guid | null> | ModelRef<Guid | null | undefined>
  ) {
    const result = ref<{ archetype: Archetype; users: RealtimeUser[] }[]>([]);
    let sub: Subscription | null = null;

    async function buildGroups(id: Guid) {
      const server = await db.servers.where("spaceId").equals(id).first();
      if (!server) return [];

      const members = await db.members
        .where("spaceId")
        .equals(server.spaceId)
        .toArray();

      const users = (
        await db.users.bulkGet(members.map((m) => m.userId))
      ).filter((u): u is RealtimeUser => !!u);

      const allArchetypeIds = [
        ...new Set(
          members.flatMap((m) => m.archetypes.map((a) => a.archetypeId))
        ),
      ];

      const archetypes = (await db.archetypes.bulkGet(allArchetypeIds)).filter(
        (a): a is Archetype => !!a
      );

      const archetypesMap = new Map(archetypes.map((a) => [a.id, a]));
      const groupArchetypes = [...archetypesMap.values()]
        .filter((a) => a.isGroup)
        .sort((a, b) => a.name.localeCompare(b.name));

      const memberMap = new Map(members.map((m) => [m.userId, m]));
      const usersWithArchetypes = users.map((user) => {
        const member = memberMap.get(user.userId);
        if (member) {
          user.archetypes = member.archetypes
            .map((x) => archetypesMap.get(x.archetypeId))
            .filter((a): a is Archetype => !!a);
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
      usersWithArchetypes.sort(sortFn);

      const groupMap = new Map<Guid, RealtimeUser[]>();
      const ungroupedUsers: RealtimeUser[] = [];
      const offlineUsers: RealtimeUser[] = [];
      const seen = new Set<Guid>();

      for (const user of usersWithArchetypes) {
        if (seen.has(user.userId)) continue;

        if (user.status === UserStatus.Offline) {
          offlineUsers.push(user);
          seen.add(user.userId);
          continue;
        }

        const groupRoles = (user.archetypes ?? []).filter((a) => a.isGroup);
        const target = groupRoles.find((r) => archetypesMap.get(r.id)?.isGroup);
        if (target) {
          if (!groupMap.has(target.id)) groupMap.set(target.id, []);
          groupMap.get(target.id)!.push(user);
        } else {
          ungroupedUsers.push(user);
        }
        seen.add(user.userId);
      }

      const result: { archetype: Archetype; users: RealtimeUser[] }[] = [];

      for (const group of groupArchetypes) {
        const groupUsers = groupMap.get(group.id) ?? [];
        if (groupUsers.length > 0) {
          result.push({ archetype: group, users: groupUsers });
        }
      }

      if (ungroupedUsers.length > 0) {
        result.push({
          archetype: {
            id: "00000000-0000-0000-0000-000000000000",
            spaceId: id,
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
          users: ungroupedUsers,
        });
      }

      if (offlineUsers.length > 0) {
        result.push({
          archetype: {
            id: "00000000-0000-0000-0000-000000000001",
            spaceId: id,
            name: "Offline",
            description: "All offline users",
            isMentionable: false,
            colour: 0xffaaaaaa,
            isHidden: false,
            isLocked: false,
            isGroup: true,
            entitlement: ArgonEntitlement.None,
            isDefault: false,
            iconFileId: null,
          },
          users: offlineUsers,
        });
      }

      return result;
    }

    watch(
      serverId,
      (id) => {
        sub?.unsubscribe();
        if (!id) {
          result.value = [];
          return;
        }

        sub = liveQuery(() => buildGroups(id as any)).subscribe({
          next: (groups) => {
            result.value = groups;
          },
          error: (err) => console.error("[GroupedUsers] liveQuery error:", err),
        });
      },
      { immediate: true }
    );

    onUnmounted(() => sub?.unsubscribe());

    return result;
  }

  const trackServer = async (server: ArgonSpaceBase) => {
    await db.servers.put(server, server.spaceId);
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

  const sipUserJoinedToChannel = async (
    channelId: Guid,
    particantId: Guid,
    particantName: string
  ) => {
    const c = db.channels.get(channelId);

    if (!c) {
      logger.error("recollect channel required");
      return;
    }
    if (realtimeChannelUsers.has(channelId)) {
      const e = realtimeChannelUsers.get(channelId);

      if (!e)
        throw new Error(" realtimeChannelUsers.get(x.channelId) return null");

      e.Users.set(particantId, {
        state: 0,
        userId: particantId,
        User: {
          displayName: particantName,
          username: "",
          userId: particantId,
          avatarFileId: null,
        },
        isSpeaking: ref(false) as any,
        isMuted: ref(false) as any,
        isScreenShare: ref(false) as any,
        volume: ref([100]) as any,
        isRecoding: ref(false) as any,
      });
    } else
      logger.error(
        "realtime channel not contains received from JoinedToChannelUser channel, maybe bug"
      );
  };

  const sipUserLeavedFromChannel = async (
    channelId: Guid,
    particantId: Guid
  ) => {
    const c = db.channels.get(channelId);

    if (!c) {
      logger.error("recollect channel required");
      return;
    }

    if (realtimeChannelUsers.has(channelId)) {
      const e = realtimeChannelUsers.get(channelId);

      if (!e)
        throw new Error("sip realtimeChannelUsers.get(channelId) return null");

      if (e.Users.has(particantId)) {
        e.Users.delete(particantId);
      }
    }
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
      }) as any
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
      logger.warn(x);
      const c = await db.servers.get(x.spaceId);
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
          await api.serverInteraction.PrefetchUser(x.spaceId, x.userId)
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
          isRecoding: ref(false) as any,
        });
      } else
        logger.error(
          "realtime channel not contains received from JoinedToChannelUser channel, maybe bug"
        );
    });

    bus.onServerEvent<JoinToServerUser>("JoinToServerUser", async (x) => {
      const s = await db.servers.get(x.spaceId);

      if (!s) {
        logger.error(
          "bug, JoinToServerUser request cannot get server assigned, missed cache?"
        );

        await loadServerDetails();
        return;
      }

      const existsUser =
        (await db.users.where("userId").equals(x.userId).count()) > 0;
      if (!existsUser) {
        const user = await api.serverInteraction.GetMember(x.spaceId, x.userId);
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
            await api.serverInteraction.PrefetchUser(x.spaceId, x.userId)
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
            await api.serverInteraction.PrefetchUser(x.spaceId, x.userId)
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
          await api.serverInteraction.PrefetchUser(x.spaceId, x.userId),
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

    bus.onServerEvent<RecordStarted>("RecordStarted", (x) => {
      if (realtimeChannelUsers.has(x.channelId)) {
        const e = realtimeChannelUsers.get(x.channelId);

        if (!e)
          throw new Error("realtimeChannelUsers.get(x.channelId) return null");

        e.isRecordingActive = true;

        const us = e.Users.get(x.byUserId);

        if (us) {
          setProperty(x.channelId, x.byUserId, (x) => {
            x.isRecoding.value = true;
          });
        }

        logger.warn(`User '${x.byUserId}' has initiated recording`);
      }
    });

    bus.onServerEvent<RecordEnded>("RecordEnded", (x) => {
      if (realtimeChannelUsers.has(x.channelId)) {
        const e = realtimeChannelUsers.get(x.channelId);

        if (!e)
          throw new Error("realtimeChannelUsers.get(x.channelId) return null");

        setPropertyQuery(
          x.channelId,
          (user) => user.isRecoding as any,
          (user) => {
            (user.isRecoding as any) = false;
          }
        );
      }
    });

    /*bus.onServerEvent<ArchetypeChanged>("ArchetypeChanged", (x) => {
      void trackArchetype(x.dto);
    });*/
  };


  bus.onServerEvent<CallIncoming>("CallIncoming", (x) => {
      useCallStore().incomingCall(x.callId, x.fromId);
  });
  bus.onServerEvent<CallFinished>("CallFinished", (x) => {
      useCallStore().incomingCallClosed(x.callId);
  });

  const refershDatas = async () => {
    await loadServerDetails();
  };

  const init = async () => {
    await db.transaction("rw", db.users, async () => {
      await db.users
        .where("status")
        .notEqual(UserStatus.Offline)
        .modify((user) => {
          user.status = UserStatus.Offline;
        });
    });

    subscribeToEvents();
  };

  const loadServerDetails = async () => {
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
        if (u.member.user) await trackUser(u.member.user, u.status, u.presence);
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
            isRecoding: ref(false),
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

      bus.listenEvents(s.spaceId);
    }
  };

  return {
    useAllServers,

    trackUser,
    trackServer,
    trackChannel,

    useActiveServerChannels,
    useGroupedServerUsers,

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
    init,
    sipUserJoinedToChannel,
    sipUserLeavedFromChannel
  };
});
