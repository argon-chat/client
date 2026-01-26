import { defineStore } from "pinia";
import { defer, from, of, Subject, timer, type Subscription } from "rxjs";
import { catchError, filter, repeat, switchMap } from "rxjs/operators";
import { useApi } from "./apiStore";
import { logger } from "@argon/core";
import { ref } from "vue";
import { useLocalStorage } from "@vueuse/core";
import { IArgonEvent, UserStatus } from "@argon/glue";
import * as signalR from "@microsoft/signalr";
import { CborReader, Guid, IonFormatterStorage } from "@argon-chat/ion.webcore";
import { MessagePackHubProtocol } from "@microsoft/signalr-protocol-msgpack";
export type EventWithServerId<T> = { spaceId: string } & T;

export const useBus = defineStore("bus", () => {
  const argonEventBus = new Subject<IArgonEvent>();
  const userEventBus = new Subject<IArgonEvent>();
  const intervalSubject = ref(null as Subscription | null);
  const isSignalRReconnecting = ref(false);
  const nextReconnectAttempt = ref<number | null>(null);
  const reconnectAttemptCount = ref(0);
  const preferredStatus = useLocalStorage<UserStatus>(
    "preferredStatus",
    UserStatus.Online,
    { initOnMounted: true, listenToStorageChanges: true, writeDefaults: true },
  );

  const controller = new AbortController();
  const { signal } = controller;

  const api = useApi();
  let hubConnection: signalR.HubConnection | null = null;

  async function doListenSignalR() {
    try {
      api.freindsInteraction;
      hubConnection = new signalR.HubConnectionBuilder()
        .withUrl(`${api.apiEndpoint}/w`, {
          accessTokenFactory: async () => await api.eventBus.PickTicket(),
          transport:
            signalR.HttpTransportType.WebSockets |
            signalR.HttpTransportType.ServerSentEvents |
            signalR.HttpTransportType.LongPolling,
          skipNegotiation: false,
        })
        //.withHubProtocol(new MessagePackHubProtocol())
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (retryContext) => {
            const delayMs = Math.min(
              1000 * Math.pow(2, retryContext.previousRetryCount),
              30000,
            );
            reconnectAttemptCount.value = retryContext.previousRetryCount;
            nextReconnectAttempt.value = Date.now() + delayMs;
            return delayMs;
          },
        })
        .configureLogging(signalR.LogLevel.Information)
        .build();

      hubConnection.on("forSelf", (data: string) => {
        try {
          if (typeof data !== "string")
            throw new Error("expected base64 string");
          const u8 = base64ToU8(data);
          const reader = new CborReader(u8);
          const event =
            IonFormatterStorage.get<IArgonEvent>("IArgonEvent").read(reader);
          if (event.UnionKey !== "UserChangedStatus")
            logger.log(`Received forSelf event, ${event.UnionKey}`, event);
          requestAnimationFrame(() => {
            argonEventBus.next(event);
          });
        } catch (e) {
          logger.error("Error processing forSelf event", e);
        }
      });

      hubConnection.on("broadcastSpace", (data: string) => {
        if (typeof data !== "string") throw new Error("expected base64 string");
        const u8 = base64ToU8(data);
        const reader = new CborReader(u8);
        const event =
          IonFormatterStorage.get<IArgonEvent>("IArgonEvent").read(reader);
        if (event.UnionKey !== "UserChangedStatus")
          logger.log(`Received broadcastSpace event, ${event.UnionKey}`, event);
        requestAnimationFrame(() => {
          argonEventBus.next(event);
        });
      });

      function base64ToU8(b64: string): Uint8Array {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
      }

      hubConnection.onreconnecting((error) => {
        logger.warn("SignalR reconnecting...", error);
        isSignalRReconnecting.value = true;
      });

      hubConnection.onreconnected((connectionId) => {
        logger.log("SignalR reconnected", connectionId);
        isSignalRReconnecting.value = false;
        nextReconnectAttempt.value = null;
        reconnectAttemptCount.value = 0;
      });

      hubConnection.onclose((error) => {
        logger.error("SignalR connection closed", error);
        if (!signal.aborted) {
          setTimeout(() => doListenSignalR(), 5000);
        }
      });

      if (!intervalSubject.value) {
        intervalSubject.value = defer(() =>
          timer(0, 2000).pipe(
            switchMap(() =>
              from(sendHeartbeat()).pipe(
                catchError((err) => {
                  console.error("heartbeat error", err);
                  return of(null);
                }),
              ),
            ),
          ),
        )
          .pipe(repeat())
          .subscribe();
      }

      await hubConnection.start();
      logger.log("SignalR connected successfully", hubConnection.connectionId);

      await new Promise<void>((resolve) => {
        const checkAbort = () => {
          if (signal.aborted) {
            resolve();
          } else {
            setTimeout(checkAbort, 100);
          }
        };
        checkAbort();
      });

      await hubConnection.stop();
    } catch (error) {
      logger.error("SignalR connection error", error);
      if (!signal.aborted) {
        setTimeout(() => doListenSignalR(), 5000);
      }
    }
  }

  async function doListenMyEvents() {
    await doListenSignalR();
  }

  async function sendEventAsync<T extends IArgonEvent>(t: T) {
    if (hubConnection?.state === signalR.HubConnectionState.Connected) {
      await hubConnection.invoke("SendEvent", t);
    }
  }

  async function sendHeartbeat() {
    if (hubConnection?.state === signalR.HubConnectionState.Connected) {
      await hubConnection.invoke("Heartbeat", preferredStatus.value);
    }
  }

  async function IAmTypingEvent(channelId: Guid) {
    if (hubConnection?.state === signalR.HubConnectionState.Connected) {
      await hubConnection.invoke("IAmTyping", channelId);
    }
  }
  async function IAmStopTypingEvent(channelId: Guid) {
    if (hubConnection?.state === signalR.HubConnectionState.Connected) {
      await hubConnection.invoke("IAmStopTyping", channelId);
    }
  }

  async function subscribeToSpace(spaceId: string) {
    if (hubConnection?.state === signalR.HubConnectionState.Connected) {
      await hubConnection.invoke("SubscribeToSpace", spaceId);
      logger.log(`Subscribed to space ${spaceId}`);
    }
  }

  async function unsubscribeFromSpace(spaceId: string) {
    if (hubConnection?.state === signalR.HubConnectionState.Connected) {
      await hubConnection.invoke("UnSubscribeToSpace", spaceId);
      logger.log(`Unsubscribed from space ${spaceId}`);
    }
  }

  function listenEvents(id: string) {}

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

  async function retryConnectionNow() {
    if (hubConnection && isSignalRReconnecting.value) {
      try {
        await hubConnection.stop();
        nextReconnectAttempt.value = null;
        reconnectAttemptCount.value = 0;
        isSignalRReconnecting.value = false;
        await doListenSignalR();
      } catch (error) {
        logger.error("Manual reconnect failed", error);
      }
    }
  }

  function closeAllSubscribes(reason: string) {
    controller.abort(reason);
    if (hubConnection) {
      hubConnection.stop();
      hubConnection = null;
    }
    if (intervalSubject.value) {
      intervalSubject.value.unsubscribe();
      intervalSubject.value = null;
    }
  }

  return {
    argonEventBus,
    listenEvents,
    closeAllSubscribes,
    onServerEvent,
    onUserEvent,
    doListenMyEvents,
    sendEventAsync,
    subscribeToSpace,
    unsubscribeFromSpace,
    IAmTypingEvent,
    IAmStopTypingEvent,
    isSignalRReconnecting,
    nextReconnectAttempt,
    reconnectAttemptCount,
    retryConnectionNow
  };
});
