import { logger } from "@/lib/logger";
import { defineStore } from "pinia";
import { Subject } from "rxjs";
import { useApi } from "./apiStore";
import { useBus } from "./busStore";
import { useMe } from "./meStore";
import { db } from "./db/dexie";
import { useUserStore } from "./userStore";
import { useChannelStore } from "./channelStore";
import { useArchetypeStore } from "./archetypeStore";
import { useRealtimeStore } from "./realtimeStore";
import {
  type ArgonMessage,
  type ChannelCreated,
  type ChannelModified,
  type ChannelRemoved,
  type JoinedToChannelUser,
  type JoinToServerUser,
  type LeavedFromChannelUser,
  type MessageSent,
  type OnUserPresenceActivityChanged,
  type OnUserPresenceActivityRemoved,
  type RecordEnded,
  type RecordStarted,
  type UserChangedStatus,
  type UserUpdated,
  type ArchetypeCreated,
} from "@/lib/glue/argonChat";

/**
 * Store для обработки realtime событий от сервера
 */
export const useEventStore = defineStore("events", () => {
  const bus = useBus();
  const api = useApi();
  const me = useMe();
  const userStore = useUserStore();
  const channelStore = useChannelStore();
  const archetypeStore = useArchetypeStore();
  const realtimeStore = useRealtimeStore();

  const onNewMessageReceived = new Subject<ArgonMessage>();

  /**
   * Подписка на все события от сервера
   */
  const subscribeToEvents = () => {
    // Каналы
    bus.onServerEvent<ChannelCreated>("ChannelCreated", async (x) => {
      logger.warn(x);
      const server = await db.servers.get(x.spaceId);
      if (server) {
        await channelStore.trackChannel(x.data);
        realtimeStore.initRealtimeChannel(x.data);
      } else {
        logger.error("recollect server required, maybe bug");
      }
    });

    bus.onServerEvent<ChannelRemoved>("ChannelRemoved", async (x) => {
      realtimeStore.removeRealtimeChannel(x.channelId);
      await channelStore.removeChannel(x.channelId);
    });

    bus.onServerEvent<ChannelModified>("ChannelModified", () => {
      // TODO: implement
    });

    // Пользователи в каналах
    bus.onServerEvent<JoinedToChannelUser>("JoinedToChannelUser", async (x) => {
      const channel = await db.channels.get(x.channelId);
      if (!channel) {
        logger.error("recollect channel required");
        return;
      }

      let user = await userStore.getUser(x.userId);
      if (!user) {
        await userStore.trackUser(
          await api.serverInteraction.PrefetchUser(x.spaceId, x.userId)
        );
        user = await userStore.getUser(x.userId);
        if (!user) {
          throw new Error("Failed to fetch user");
        }
      }

      realtimeStore.addUserToChannel(x.channelId, x.userId, user);
    });

    bus.onServerEvent<LeavedFromChannelUser>(
      "LeavedFromChannelUser",
      async (x) => {
        const channel = await db.channels.get(x.channelId);
        if (!channel) {
          logger.error("recollect channel required");
          return;
        }

        realtimeStore.removeUserFromChannel(x.channelId, x.userId);
      }
    );

    // Пользователи на сервере
    bus.onServerEvent<JoinToServerUser>("JoinToServerUser", async (x) => {
      const server = await db.servers.get(x.spaceId);
      if (!server) {
        logger.error("bug, JoinToServerUser cannot get server, missed cache?");
        return;
      }

      const existsUser = (await db.users.where("userId").equals(x.userId).count()) > 0;
      if (!existsUser) {
        const member = await api.serverInteraction.GetMember(x.spaceId, x.userId);
        await archetypeStore.trackMember(member.member);
        await db.servers.put(server);
        logger.info("Fetched member for server", x);
      }
    });

    // Обновления пользователей
    bus.onServerEvent<UserUpdated>("UserUpdated", (x) => {
      userStore.trackUser(x.dto);
      if (x.dto.userId === me.me?.userId) {
        me.me.avatarFileId = x.dto.avatarFileId;
        me.me.displayName = x.dto.displayName;
        me.me.username = x.dto.username;
      }
    });

    bus.onServerEvent<UserChangedStatus>("UserChangedStatus", async (x) => {
      const user = await userStore.getUser(x.userId);
      if (!user) {
        await userStore.trackUser(
          await api.serverInteraction.PrefetchUser(x.spaceId, x.userId),
          x.status
        );
        return;
      }

      await userStore.updateUserStatus(x.userId, x.status);
    });

    bus.onServerEvent<OnUserPresenceActivityChanged>(
      "OnUserPresenceActivityChanged",
      async (x) => {
        let user = await userStore.getUser(x.userId);
        if (!user) {
          await userStore.trackUser(
            await api.serverInteraction.PrefetchUser(x.spaceId, x.userId)
          );
          user = await userStore.getUser(x.userId);
          if (!user) {
            throw new Error("Failed to fetch user");
          }
        }

        await userStore.updateUserActivity(x.userId, x.presence);
      }
    );

    bus.onServerEvent<OnUserPresenceActivityRemoved>(
      "OnUserPresenceActivityRemoved",
      async (x) => {
        let user = await userStore.getUser(x.userId);
        if (!user) {
          await userStore.trackUser(
            await api.serverInteraction.PrefetchUser(x.spaceId, x.userId)
          );
          user = await userStore.getUser(x.userId);
          if (!user) {
            throw new Error("Failed to fetch user");
          }
        }

        await userStore.updateUserActivity(x.userId, undefined);
      }
    );

    // Сообщения
    bus.onServerEvent<MessageSent>("MessageSent", (x) => {
      onNewMessageReceived.next(x.message);
    });

    // Архетипы
    bus.onServerEvent<ArchetypeCreated>("ArchetypeCreated", (x) => {
      void archetypeStore.trackArchetype(x.data);
    });

    // Запись в каналах
    bus.onServerEvent<RecordStarted>("RecordStarted", (x) => {
      realtimeStore.startRecording(x.channelId, x.byUserId);
    });

    bus.onServerEvent<RecordEnded>("RecordEnded", (x) => {
      realtimeStore.stopRecording(x.channelId);
    });
  };

  return {
    onNewMessageReceived,
    subscribeToEvents,
  };
});
