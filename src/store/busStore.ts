import { defineStore } from "pinia";
import {
  defer,
  from,
  interval,
  of,
  Subject,
  timer,
  type Subscription,
} from "rxjs";
import { catchError, filter, repeat, switchMap } from "rxjs/operators";
import { useApi } from "./apiStore";
import { logger } from "@/lib/logger";
import { ref } from "vue";
import { useLocalStorage } from "@vueuse/core";
import {
  HeartBeatEvent,
  IArgonClientEvent,
  IArgonEvent,
  UserStatus,
} from "@/lib/glue/argonChat";

export type EventWithServerId<T> = { spaceId: string } & T;

export const useBus = defineStore("bus", () => {
  const argonEventBus = new Subject<IArgonEvent>();
  const userEventBus = new Subject<IArgonEvent>();
  const dispatcherEvents = new Subject<IArgonClientEvent>();
  const intervalSubject = ref(null as Subscription | null);
  const preferredStatus = useLocalStorage<UserStatus>(
    "preferredStatus",
    UserStatus.Online,
    { initOnMounted: true, listenToStorageChanges: true, writeDefaults: true }
  );

  const controller = new AbortController();
  const { signal } = controller;

  const api = useApi();

  async function doListenMasterPipe() {
    if (!intervalSubject.value) {
      intervalSubject.value = defer(() =>
        timer(0, 2000).pipe(
          switchMap(() =>
            from(sendHeartbeat()).pipe(
              catchError((err) => {
                console.error("heartbeat error", err);
                return of(null);
              })
            )
          )
        )
      )
        .pipe(repeat())
        .subscribe();
    }

    const handle = await api.eventBus.Pipe(toAsyncIterable(dispatcherEvents));
    for await (const e of handle) {
      if (e.UnionKey !== "UserChangedStatus")
        logger.log(`Received event, ${e.UnionKey}`, e);
      requestAnimationFrame(() => {
        argonEventBus.next(e);
      });
      if (signal.aborted) break;
    }
  }

  async function doListenMyEvents() {
    await doListenMasterPipe();
  }

  async function sendEventAsync<T extends IArgonClientEvent>(t: T) {
    dispatcherEvents.next(t);
  }

  async function sendHeartbeat() {
    dispatcherEvents.next(new HeartBeatEvent(preferredStatus.value))
  }

  function listenEvents(id: string) {
  }

  function onServerEvent<T extends IArgonEvent>(
    key: T["UnionKey"],
    callback: (event: EventWithServerId<T>) => void
  ): Subscription {
    return argonEventBus
      .pipe(
        filter((event): event is EventWithServerId<T> => event.UnionKey === key)
      )
      .subscribe(callback);
  }

  function onUserEvent<T extends IArgonEvent>(
    key: T["UnionKey"],
    callback: (event: T) => void
  ): Subscription {
    return userEventBus
      .pipe(filter((event): event is T => event.UnionKey === key))
      .subscribe(callback);
  }

  function closeAllSubscribes(reason: string) {
    controller.abort(reason);
  }

  function toAsyncIterable<T>(subject: Subject<T>): AsyncIterable<T> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        const queue: T[] = [];
        const pending: ((value: IteratorResult<T>) => void)[] = [];
        let done = false;

        const sub: Subscription = subject.subscribe({
          next(value) {
            if (pending.length > 0) {
              const resolve = pending.shift()!;
              resolve({ value, done: false });
            } else {
              queue.push(value);
            }
          },
          error(err) {
            pending.forEach((r) => r(Promise.reject(err) as any));
            done = true;
          },
          complete() {
            done = true;
            pending.forEach((r) => r({ value: undefined, done: true }));
          },
        });

        return {
          next(): Promise<IteratorResult<T>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => pending.push(resolve));
          },
          return(): Promise<IteratorResult<T>> {
            sub.unsubscribe();
            done = true;
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
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
