import { defineStore } from "pinia";
import { computed, Reactive, reactive, Ref, ref } from "vue";
import { useBus } from "./busStore";
import { logger } from "@/lib/logger";
import { useApi } from "./apiStore";
import { UserStatus } from "@/lib/glue/UserStatus";
import { firstValueFrom, from } from "rxjs";
import { liveQuery } from "dexie";
import { useObservable } from "@vueuse/rxjs";
import { db, RealtimeUser } from "./db/dexie";
import { computedAsync } from "@vueuse/core";
import { useMe } from "./meStore";

export type IRealtimeChannelUserWithData = IRealtimeChannelUser & { 
  User: IUser, isSpeaking: Ref<boolean>, isMuted: Ref<boolean>, isScreenShare: Ref<boolean>, volume: Ref<number[]>
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

  const realtimeChannelUsers = reactive(
    new Map<Guid, Reactive<IRealtimeChannelWithUser>>()
  );

  const allServers = computed(() => {
    return useObservable(from(liveQuery(async () => await db.servers.toArray())));
  });


  const getChannel = async function (channelId: Guid) {
    return await db.channels.where("Id").equals(channelId).first();
  }

  const getServer = async function (serverId: Guid) {
    return await db.servers.where("Id").equals(serverId).first();
  }

  const getUser = async function (userId: Guid) {
    return await db.users.where("Id").equals(userId).first();
  }

  const getBatchUser = async function (userIds: Guid[]) {
    return await db.users.bulkGet(userIds);
  }


  const indicateSpeaking = async function (channelId: Guid, userId: Guid, isSpeaking: boolean) {
    if (realtimeChannelUsers.has(channelId)) {
      if (realtimeChannelUsers.get(channelId)!.Users.has(userId)) {
        realtimeChannelUsers.get(channelId)!.Users.get(userId)!.isSpeaking = isSpeaking;
      } else {
        logger.warn("Detected speaking user, but in realtime channel user not found, maybe bug", channelId, userId);
      }
    } else {
      logger.warn("Detected speaking user, but in realtime channel not found, maybe bug", channelId, userId);
    }
  }


  const setProperty = async function (channelId: Guid, userId: Guid, action: (user: IRealtimeChannelUserWithData) => void) {
    if (realtimeChannelUsers.has(channelId)) {
      if (realtimeChannelUsers.get(channelId)!.Users.has(userId)) {
        action(realtimeChannelUsers.get(channelId)!.Users.get(userId) as any);
      } else {
        logger.warn("Detected speaking user, but in realtime channel user not found, maybe bug", channelId, userId);
      }
    } else {
      logger.warn("Detected speaking user, but in realtime channel not found, maybe bug", channelId, userId);
    }
  }


  const allServerAsync = computed(() => firstValueFrom<IServer[]>(from(liveQuery(async () => await db.servers.toArray()))));

  const getSelectedServer = computedAsync(
    async () => {
      if (!selectedServer.value)
        return null;
      return await db.servers.where("Id").equals(selectedServer.value!).first()!;
    }
  );

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
              const statusDiff =
                (a.status === "Online" ? 0 : 1) -
                (b.status === "Online" ? 0 : 1);
              if (statusDiff !== 0) return statusDiff;

              return a.DisplayName.localeCompare(b.DisplayName);
            });
        })
      )
    );
  });

  const trackServer = async function (server: IServer) {
    await db.servers.put(server, server.Id);
  };

  const trackUser = async function (user: IUser, extendedStatus?: UserStatus) {
    const exist = await db.users.get(user.Id);
    if (exist) {
      // @ts-ignore
      await db.users.update(exist.Id, {
        ...user,
        status: extendedStatus ?? "Offline",
      });
      return;
    }
    await db.users.put(
      {
        ...user,
        status: extendedStatus ?? "Offline",
      },
      user.Id
    );
  };

  const trackChannel = async function (channel: IChannel, users?: Map<Guid, IRealtimeChannelUserWithData>) {
    realtimeChannelUsers.set(
      channel.Id,
      reactive({
        Channel: channel,
        Users: users ?? new Map<Guid, IRealtimeChannelUserWithData>()
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

    bus.onServerEvent<LeavedFromChannelUser>("LeavedFromChannelUser", async (x) => {
      const c = db.channels.get(x.channelId);

      if (!c) {
        logger.error("recollect channel required");
        return;
      }

      if (realtimeChannelUsers.has(x.channelId)) {
        const e = realtimeChannelUsers.get(x.channelId);

        if (!e) throw new Error(" realtimeChannelUsers.get(x.channelId) return null");

        if (e.Users.has(x.userId)) {
          e.Users.delete(x.userId);
        }
      }
    })

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

        if (!e) throw new Error(" realtimeChannelUsers.get(x.channelId) return null");


        e.Users.set(x.userId, {
          State: 0,
          UserId: x.userId,
          User: user!,
          isSpeaking: false,
          isMuted: false,
          isScreenShare: false,
          volume: [100]
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

      let user = await db.users.get(x.userId);
      if (!user) {
        trackUser(
          await api.serverInteraction.PrefetchUser(x.serverId, x.userId)
        );
        user = await db.users.get(x.userId);
      }

      s.Users.push({
        UserId: x.userId,
        Id: x.userId,
        ServerId: x.serverId,
      } as IServerMember);
    });

    bus.onServerEvent<ChannelModified>("ChannelModified", (x) => {
      // TODO
      //trackChannel({ Channel: x., Users: [] });
    });

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
        await trackUser(u.Member.User, u.Status);
      }

      const channels = await api.serverInteraction.GetChannels(s.Id);

      logger.log(`Loaded '${channels.length}' channels`, channels);
      const trackedIds: Array<Guid> = [];

      for (const c of channels) {
        trackedIds.push(c.Channel.Id);
        const we = new Map<Guid, IRealtimeChannelUserWithData>();
        for (const uw of c.Users) {
          let selectedUser = users.filter(z => z.Member.UserId == uw.UserId).at(0);
          if (!selectedUser) {
            trackUser(
              await api.serverInteraction.PrefetchUser(s.Id, uw.UserId)
            );
          }

          selectedUser = users.filter(z => z.Member.Id == uw.UserId).at(0);

          if (!selectedUser) {
            logger.fatal("Cannot fileter user from store, and cannot prefetch user from user, its bug or maybe trying use member id, memberId != userId", uw, users);
            continue;
          }
          we.set(uw.UserId, { State: uw.State, UserId: uw.UserId, User: selectedUser.Member.User, isSpeaking: ref(false), isMuted: ref(false), isScreenShare: ref(false), volume: ref([100])});
        }
        await trackChannel(c.Channel, we);
      }

      const prunedChannels = await db.channels.where('Id').noneOf([...trackedIds]).and(q => q.ServerId === s.Id).delete();

      if (prunedChannels != 0)
        logger.warn(`Pruned ${prunedChannels} channels`);

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

    loadServerDetails,
    getSelectedServer,

    realtimeChannelUsers,
    indicateSpeaking,
    setProperty,


    getUser,
    getChannel,
    getServer
  };
});
