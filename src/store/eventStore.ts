import { logger } from "@/lib/logger";
import { defineStore } from "pinia";
import { Subject } from "rxjs";
import { nextTick } from "vue";
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
  type ChannelGroup,
  ChannelGroupCreated,
  ChannelGroupModified,
  ChannelGroupRemoved,
  ChannelGroupReordered,
  ChannelReordered,
} from "@/lib/glue/argonChat";
import type { Guid } from "@argon-chat/ion.webcore";

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
    bus.onServerEvent<ChannelCreated>("ChannelCreated", (x) => {
      void (async () => {
        try {
          const server = await db.servers.get(x.spaceId);
          if (server) {
            await channelStore.trackChannel(x.data);
            // Откладываем обновление реактивного состояния в следующий event loop
            setTimeout(() => {
              realtimeStore.initRealtimeChannel(x.data);
            }, 0);
          } else {
            logger.error("recollect server required, maybe bug");
          }
        } catch (error) {
          logger.error("Error handling ChannelCreated", error);
        }
      })();
    });

    bus.onServerEvent<ChannelRemoved>("ChannelRemoved", (x) => {
      void (async () => {
        try {
          realtimeStore.removeRealtimeChannel(x.channelId);
          await channelStore.removeChannel(x.channelId);
        } catch (error) {
          logger.error("Error handling ChannelRemoved", error);
        }
      })();
    });

    bus.onServerEvent<ChannelModified>("ChannelModified", () => {
      // TODO: implement
    });

    // Пользователи в каналах
    bus.onServerEvent<JoinedToChannelUser>("JoinedToChannelUser", (x) => {
      void (async () => {
        try {
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
        } catch (error) {
          logger.error("Error handling JoinedToChannelUser", error);
        }
      })();
    });

    bus.onServerEvent<LeavedFromChannelUser>(
      "LeavedFromChannelUser",
      (x) => {
        void (async () => {
          try {
            const channel = await db.channels.get(x.channelId);
            if (!channel) {
              logger.error("recollect channel required");
              return;
            }

            realtimeStore.removeUserFromChannel(x.channelId, x.userId);
          } catch (error) {
            logger.error("Error handling LeavedFromChannelUser", error);
          }
        })();
      }
    );

    // Пользователи на сервере
    bus.onServerEvent<JoinToServerUser>("JoinToServerUser", (x) => {
      void (async () => {
        try {
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
        } catch (error) {
          logger.error("Error handling JoinToServerUser", error);
        }
      })();
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

    bus.onServerEvent<UserChangedStatus>("UserChangedStatus", (x) => {
      void (async () => {
        try {
          const user = await userStore.getUser(x.userId);
          if (!user) {
            await userStore.trackUser(
              await api.serverInteraction.PrefetchUser(x.spaceId, x.userId),
              x.status
            );
            return;
          }

          await userStore.updateUserStatus(x.userId, x.status);
        } catch (error) {
          logger.error("Error handling UserChangedStatus", error);
        }
      })();
    });

    bus.onServerEvent<OnUserPresenceActivityChanged>(
      "OnUserPresenceActivityChanged",
      (x) => {
        void (async () => {
          try {
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
          } catch (error) {
            logger.error("Error handling OnUserPresenceActivityChanged", error);
          }
        })();
      }
    );

    bus.onServerEvent<OnUserPresenceActivityRemoved>(
      "OnUserPresenceActivityRemoved",
      (x) => {
        void (async () => {
          try {
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
          } catch (error) {
            logger.error("Error handling OnUserPresenceActivityRemoved", error);
          }
        })();
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

    // Channel groups events
    bus.onServerEvent<ChannelGroupCreated>("ChannelGroupCreated", (x: ChannelGroupCreated) => {
      logger.info("ChannelGroupCreated", x);
      void (async () => {
        try {
          await db.channelGroups.put(x.data, x.data.groupId);
        } catch (error) {
          logger.error("Error handling ChannelGroupCreated", error);
        }
      })();
    });

    bus.onServerEvent<ChannelGroupModified>("ChannelGroupModified", (x: ChannelGroupModified) => {
      logger.info("ChannelGroupModified", x);
      void (async () => {
        try {
          const group = await db.channelGroups.get(x.groupId);
          if (group) {
            await db.channelGroups.update(x.groupId, x.data);
          }
        } catch (error) {
          logger.error("Error handling ChannelGroupModified", error);
        }
      })();
    });

    bus.onServerEvent<ChannelGroupRemoved>("ChannelGroupRemoved", (x: ChannelGroupRemoved) => {
      logger.info("ChannelGroupRemoved", x);
      void (async () => {
        try {
          await db.channelGroups.delete(x.groupId);
        } catch (error) {
          logger.error("Error handling ChannelGroupRemoved", error);
        }
      })();
    });

    bus.onServerEvent<ChannelGroupReordered>("ChannelGroupReordered", (x: ChannelGroupReordered) => {
      logger.info("ChannelGroupReordered", x);
      void (async () => {
        try {
          await db.channelGroups.update(x.groupId, { fractionalIndex: x.fractionalIndex });
        } catch (error) {
          logger.error("Error handling ChannelGroupReordered", error);
        }
      })();
    });

    bus.onServerEvent<ChannelReordered>("ChannelReordered", (x: ChannelReordered) => {
      logger.info("ChannelReordered", x);
      void (async () => {
        try {
          await db.channels.update(x.channelId, {
            fractionalIndex: x.fractionalIndex,
            groupId: x.targetGroupId,
          });
        } catch (error) {
          logger.error("Error handling ChannelReordered", error);
        }
      })();
    });
  };

  return {
    onNewMessageReceived,
    subscribeToEvents,
  };
});
