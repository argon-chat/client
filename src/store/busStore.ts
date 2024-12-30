import { defineStore } from "pinia";
import { Subject, Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { useApi } from "./apiStore";

export type EventWithServerId<T> = {serverId: string} & T;

export const useBus = defineStore("bus", () => {
  const argonEventBus = new Subject<{serverId: string} & IArgonEvent>();

  const controller = new AbortController();
  const { signal } = controller;

  const api = useApi();

  async function doListenServer(id: string) {
    const handle = await api.eventBus.SubscribeToServerEvents(id);
    for await(const e of handle) {
      argonEventBus.next({ serverId: id, ...e });
      if (signal.aborted)
        break;
    }
  }

  function on<T extends IArgonEvent>(key: T["EventKey"], callback: (event: EventWithServerId<T> ) => void): Subscription {
    return argonEventBus
      .pipe(filter((event): event is EventWithServerId<T> => event.EventKey === key))
      .subscribe(callback);
  }

  function closeAllSubscribes(reason: string) {
    controller.abort(reason);
  }
 
  return { argonEventBus, doListenServer, closeAllSubscribes, on };
});
