import { defineStore } from "pinia";
import { interval, Subject, type Subscription } from "rxjs";
import { filter, switchMap } from "rxjs/operators";
import { useApi } from "./apiStore";
import { logger } from "@/lib/logger";
import { ref } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { HeartBeatEvent, IArgonClientEvent, IArgonEvent, UserStatus } from "@/lib/glue/argonChat";

export type EventWithServerId<T> = { serverId: string } & T;

export const useBus = defineStore("bus", () => {
  const argonEventBus = new Subject<IArgonEvent>();
  const userEventBus = new Subject<IArgonEvent>();
  const intervalSubject = ref(null as Subscription | null);
  const preferredStatus = useLocalStorage<UserStatus>(
    "preferredStatus",
    UserStatus.Online,
    { initOnMounted: true, listenToStorageChanges: true, writeDefaults: true },
  );

  const controller = new AbortController();
  const { signal } = controller;

  const api = useApi();

  async function doListenServer(id: string) {
    if (!intervalSubject.value) {
      intervalSubject.value = interval(2000)
        .pipe(
          switchMap(() => {
            return sendHeartbeat();
          }),
        )
        .subscribe();
    }

    const handle = await api.eventBus.ForServer(id);
    for await (const e of handle) {
      if (e.UnionKey !== "UserChangedStatus")
        logger.log(`Received event, ${e.UnionKey}`, e);
      argonEventBus.next(e);
      if (signal.aborted) break;
    }
  }

  async function doListenMyEvents() {
    const handle = await api.eventBus.ForSelf();
    for await (const e of handle) {
      if (e.UnionKey !== "UserChangedStatus")
        logger.log(`Received event, ${e.UnionKey}`, e);
      userEventBus.next(e);
      if (signal.aborted) break;
    }
  }

  async function sendEventAsync<T extends IArgonClientEvent>(t: T) {
    await api.eventBus.Dispatch(t);
  }

  async function sendHeartbeat() {
    await api.eventBus.Dispatch(new HeartBeatEvent(preferredStatus.value));
  }

  function listenEvents(id: string) {
    doListenServer(id);
  }

  function onServerEvent<T extends IArgonEvent>(
    key: T["UnionKey"],
    callback: (event: EventWithServerId<T>) => void,
  ): Subscription {
    return argonEventBus
      .pipe(
        filter(
          (event): event is EventWithServerId<T> => event.UnionKey === key,
        ),
      )
      .subscribe(callback);
  }

  function onUserEvent<T extends IArgonEvent>(
    key: T["UnionKey"],
    callback: (event: T) => void,
  ): Subscription {
    return userEventBus
      .pipe(filter((event): event is T => event.UnionKey === key))
      .subscribe(callback);
  }

  function closeAllSubscribes(reason: string) {
    controller.abort(reason);
  }

  return {
    argonEventBus,
    listenEvents,
    closeAllSubscribes,
    onServerEvent,
    onUserEvent,
    doListenMyEvents,
    sendEventAsync,
  };
});
