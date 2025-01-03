import { defineStore } from "pinia";
import { Subject, Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { useApi } from "./apiStore";
import { logger } from "@/lib/logger";

export type EventWithServerId<T> = {serverId: string} & T;

export const useBus = defineStore("bus", () => {
  const argonEventBus = new Subject<{serverId: string} & IArgonEvent>();
  const userEventBus = new Subject<IArgonEvent>();

  const controller = new AbortController();
  const { signal } = controller;

  const api = useApi();

  async function doListenServer(id: string) {
    const handle = await api.eventBus.SubscribeToServerEvents(id);
    for await(const e of handle) {
      logger.log(`Received event, ${e.EventKey}`, e);
      argonEventBus.next({ serverId: id, ...e });
      if (signal.aborted)
        break;
    }
  }

  async function doListenMyEvents() {
    const handle = await api.eventBus.SubscribeToMeEvents();
    for await(const e of handle) {
      logger.log(`Received event, ${e.EventKey}`, e);
      userEventBus.next(e);
      if (signal.aborted)
        break;
    }
  }

  function listenEvents(id: string) {
    doListenServer(id);
  }

  function onServerEvent<T extends IArgonEvent>(key: T["EventKey"], callback: (event: EventWithServerId<T> ) => void): Subscription {
    return argonEventBus
      .pipe(filter((event): event is EventWithServerId<T> => event.EventKey === key))
      .subscribe(callback);
  }

  function onUserEvent<T extends IArgonEvent>(key: T["EventKey"], callback: (event: T ) => void): Subscription {
    return userEventBus
      .pipe(filter((event): event is T => event.EventKey === key))
      .subscribe(callback);
  }

  function closeAllSubscribes(reason: string) {
    controller.abort(reason);
  }
 
  return { argonEventBus, listenEvents, closeAllSubscribes, onServerEvent, onUserEvent, doListenMyEvents };
});
