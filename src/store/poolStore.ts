import { defineStore } from "pinia";
import { computed, Reactive, reactive, Ref, ref } from "vue";
import { useBus } from "./busStore";
import { logger } from "@/lib/logger";
import { useApi } from "./apiStore";
import { UserStatus } from "@/lib/glue/UserStatus";
import { firstValueFrom, from, Subject } from "rxjs";
import { liveQuery } from "dexie";
import { useObservable } from "@vueuse/rxjs";
import { db, RealtimeUser } from "./db/dexie";
import { computedAsync } from "@vueuse/core";
import { useMe } from "./meStore";
import { watch } from "vue";

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
    if (newChannelId != oldChannelId) onChannelChanged.next(newChannelId);
  });

  const realtimeChannelUsers = reactive(
    new Map<Guid, Reactive<IRealtimeChannelWithUser>>()
  );

  const allServers = computed(() => {
    return useObservable(
      from(liveQuery(async () => await db.servers.toArray()))
    );
  });

  const getChannel = async function (channelId: Guid) {
    return await db.channels.where("Id").equals(channelId).first();
  };

  const getServer = async function (serverId: Guid) {
    return await db.servers.where("Id").equals(serverId).first();
  };

  const getUser = async function (userId: Guid) {
    return await db.users.where("UserId").equals(userId).first();
  };

  const getUserReactive = (userId: Guid) => {
    const observable = liveQuery(
      async () => await db.users.where("UserId").equals(userId).first()
    );
    return useObservable(from(observable));
  };

  const getBatchUser = async function (userIds: Guid[]) {
    return await db.users.bulkGet(userIds);
  };
  const getBatchUsersExcept = async function (excludedUserIds: Guid[]) {
    return await db.users
      .filter((user) => !excludedUserIds.includes(user.UserId))
      .toArray();
  };

  const indicateSpeaking = async function (
    channelId: Guid,
    userId: Guid,
    isSpeaking: boolean
  ) {
    if (realtimeChannelUsers.has(channelId)) {
      if (realtimeChannelUsers.get(channelId)!.Users.has(userId)) {
        realtimeChannelUsers.get(channelId)!.Users.get(userId)!.isSpeaking =
          isSpeaking;
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

  const setProperty = async function (
    channelId: Guid,
    userId: Guid,
    action: (user: IRealtimeChannelUserWithData) => void
  ) {
    if (realtimeChannelUsers.has(channelId)) {
      if (realtimeChannelUsers.get(channelId)!.Users.has(userId)) {
        action(realtimeChannelUsers.get(channelId)!.Users.get(userId) as any);
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
    return await db.servers.where("Id").equals(selectedServer.value!).first()!;
  });

  const activeServerChannels = computed(() => {
    return useObservable<IChannel[]>(
      from(
        liveQuery<IChannel[]>(() => {
          if (!selectedServer.value) return [];
          return db.channels
            .where("ServerId")
            .equals(selectedServer.value!)
            .toArray();
        })
      )
    );
  });

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
            });
        })
      )
    );
  });

  const trackServer = async function (server: IServerDto) {
    await db.servers.put(server, server.Id);
  };

  const trackUser = async function (
    user: IUserDto,
    extendedStatus?: UserStatus,
    extendedActivity?: IUserActivityPresence
  ) {
    const exist = await db.users.get(user.UserId);
    if (exist) {
      await db.users.update(exist.UserId, {
        ...user,
        status: !!extendedStatus ? extendedStatus : exist.status,
        activity: extendedActivity ?? exist.activity ?? undefined,
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

  const trackChannel = async function (
    channel: IChannel,
    users?: Map<Guid, IRealtimeChannelUserWithData>
  ) {
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

  const subscribeToEvents = function () {
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
        user = await db.users.get(x.userId)!;
        if (!user) throw new Error("await db.users.get(x.userId)! return null");
      }

      if (realtimeChannelUsers.has(x.channelId)) {
        const e = realtimeChannelUsers.get(x.channelId);

        if (!e)
          throw new Error(" realtimeChannelUsers.get(x.channelId) return null");

        e.Users.set(x.userId, {
          State: 0,
          UserId: x.userId,
          User: user!,
          isSpeaking: false,
          isMuted: false,
          isScreenShare: false,
          volume: [100],
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

    bus.onServerEvent<ChannelModified>("ChannelModified", (x) => {
      // TODO
      //trackChannel({ Channel: x., Users: [] });
    });

    bus.onServerEvent<UserUpdated>("UserUpdated", (x) => {
      trackUser(x.dto);
      if (x.dto.UserId == me.me?.Id) {
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
          user = await db.users.get(x.userId)!;
          if (!user)
            throw new Error("await db.users.get(x.userId)! return null");
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
          user = await db.users.get(x.userId)!;
          if (!user)
            throw new Error("await db.users.get(x.userId)! return null");
        }
        user.activity = undefined;
        await db.users.put(user);
      }
    );

    bus.onServerEvent<UserChangedStatus>("UserChangedStatus", async (x) => {
      let user = await db.users.get(x.userId);
      if (!user) {
        trackUser(
          await api.serverInteraction.PrefetchUser(x.serverId, x.userId),
          x.status
        );
        return;
      }
      user.status = x.status;

      db.users.put(user);
    });

    bus.onServerEvent<MessageSent>("MessageSent", (x) => {
      onNewMessageReceived.next(x.message);
    });
  };

  const loadServerDetails = async function () {
    subscribeToEvents();

    const servers = await api.userInteraction.GetServers();

    logger.log(`Loaded '${servers.length}' servers`);
    for (const s of servers) {
      await trackServer(s);

      const users = await api.serverInteraction.GetMembers(s.Id);
      logger.log(`Loaded '${users.length}' users`, users);

      for (const u of users) {
        if (u.Member.User) await trackUser(u.Member.User, u.Status, u.Presence);
      }

      const excludeSet = new Set(users.filter(x => x.Member).map(x => x.Member.UserId));

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
          let selectedUser = users
            .filter((z) => z.Member.UserId == uw.UserId)
            .at(0);
          if (!selectedUser) {
            trackUser(
              await api.serverInteraction.PrefetchUser(s.Id, uw.UserId)
            );
          }

          let member = selectedUser!.Member.User;

          if (!member) {
            member = await api.serverInteraction.PrefetchUser(
              c.Channel.ServerId,
              selectedUser?.Member.UserId!
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

      if (prunedChannels != 0) logger.warn(`Pruned ${prunedChannels} channels`);

      bus.listenEvents(s.Id);
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
    subscribeToEvents,

    selectedServer,
    selectedChannel,
    selectedTextChannel,
    onChannelChanged,
    onNewMessageReceived,

    loadServerDetails,
    getSelectedServer,

    realtimeChannelUsers,
    indicateSpeaking,
    setProperty,

    getUser,
    getChannel,
    getServer,
    getUserReactive,
  };
});
