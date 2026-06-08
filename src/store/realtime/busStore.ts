import { defineStore } from "pinia";
import { Subject, type Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { useApi } from "@/store/system/apiStore";
import { logger } from "@argon/core";
import { ref } from "vue";
import { IArgonEvent, UserStatus } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";
import RealtimeWorker from "@/workers/realtimeWorker?worker";

export type EventWithServerId<T> = { spaceId: string } & T;

export const useBus = defineStore("bus", () => {
  const argonEventBus = new Subject<IArgonEvent>();
  const userEventBus = new Subject<IArgonEvent>();
  // Fires whenever the realtime connection is re-established after having been
  // connected before (transient auto-reconnect OR hard close → manual reconnect).
  // Used to resync state that may have drifted while events were missed.
  const reconnected = new Subject<void>();
  let everConnected = false;
  // Fires when the server's replay buffer couldn't guarantee continuity on Resume
  // (cursor trimmed / too far behind) — the client must rebuild state from scratch.
  const needFullResync = new Subject<void>();
  const isSignalRReconnecting = ref(false);
  const nextReconnectAttempt = ref<number | null>(null);
  const reconnectAttemptCount = ref(0);

  const api = useApi();
  let worker: Worker | null = null;

  function createWorker() {
    if (worker) return worker;
    
    worker = new RealtimeWorker();

    worker.onmessage = async (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case "event":
          // Events arrive already decoded from worker
          logger.log("Received event from worker:", msg.event);
          argonEventBus.next(msg.event as IArgonEvent);
          break;

        case "tokenRequest":
          // Worker needs auth token — fetch from main thread API and respond
          try {
            const token = await api.eventBus.PickTicket();
            worker!.postMessage({ type: "tokenResponse", requestId: msg.requestId, token });
          } catch (err) {
            logger.error("Failed to get token for worker", err);
            // Always respond so worker doesn't hang
            worker!.postMessage({ type: "tokenResponse", requestId: msg.requestId, token: "", error: true });
          }
          break;

        case "heartbeatRequest":
          // Worker requests heartbeat — provide current user status
          try {
            const { useMe } = await import("../auth/meStore");
            const me = useMe();
            const status = me.me?.currentStatus ?? UserStatus.Online;
            worker!.postMessage({ type: "heartbeatInvoke", status });
          } catch (err) {
            logger.error("Failed to send heartbeat status to worker", err);
          }
          break;

        case "state":
          if (msg.state === "reconnecting") {
            isSignalRReconnecting.value = true;
          } else if (msg.state === "connected") {
            const isReconnection = everConnected;
            everConnected = true;
            isSignalRReconnecting.value = false;
            nextReconnectAttempt.value = null;
            reconnectAttemptCount.value = 0;
            // Re-establishment (not first connect): events may have been missed
            // during the gap — notify listeners to resync.
            if (isReconnection) reconnected.next();
            // (Re)assert the channel-delivery subscription for the currently-open channel. Covers
            // the race where the channel was selected before the worker existed (postMessage no-op),
            // and any reconnect where server-side group membership was lost.
            void (async () => {
              const { useChannelStore } = await import("@/store/data/channelStore");
              const ch = useChannelStore().selectedTextChannel;
              if (ch) subscribeToChannel(ch);
            })();
          } else if (msg.state === "disconnected") {
            // Will auto-reconnect inside worker
          }
          break;

        case "reconnectInfo":
          reconnectAttemptCount.value = msg.attemptCount;
          nextReconnectAttempt.value = msg.nextAttemptAt;
          break;

        case "needFullResync":
          needFullResync.next();
          break;

        case "log":
          if (msg.level === "error") logger.error(`[RealtimeWorker] ${msg.message}`, ...(msg.args ?? []));
          else if (msg.level === "warn") logger.warn(`[RealtimeWorker] ${msg.message}`, ...(msg.args ?? []));
          else logger.log(`[RealtimeWorker] ${msg.message}`, ...(msg.args ?? []));
          break;
      }
    };

    worker.onerror = (err) => {
      logger.error("[RealtimeWorker] Worker error:", err);
    };

    return worker;
  }

  async function doListenSignalR() {
    const w = createWorker();
    w.postMessage({ type: "connect", endpoint: api.apiEndpoint });
  }

  async function doListenMyEvents() {
    await doListenSignalR();
  }

  async function sendEventAsync<T extends IArgonEvent>(t: T) {
    worker?.postMessage({ type: "invoke", method: "SendEvent", args: [t] });
  }

  async function IAmTypingEvent(channelId: Guid) {
    worker?.postMessage({ type: "invoke", method: "IAmTyping", args: [channelId] });
  }

  async function IAmStopTypingEvent(channelId: Guid) {
    worker?.postMessage({ type: "invoke", method: "IAmStopTyping", args: [channelId] });
  }

  async function subscribeToSpace(spaceId: string) {
    worker?.postMessage({ type: "invoke", method: "SubscribeToSpace", args: [spaceId] });
    logger.log(`Subscribed to space ${spaceId}`);
  }

  async function unsubscribeFromSpace(spaceId: string) {
    worker?.postMessage({ type: "invoke", method: "UnSubscribeToSpace", args: [spaceId] });
    logger.log(`Unsubscribed from space ${spaceId}`);
  }

  // Channel-scoped delivery: the worker tracks these and re-joins them on every (re)connect, so
  // channel content (messages/typing/reactions) reaches only viewers of the open channel.
  async function subscribeToChannel(channelId: string) {
    worker?.postMessage({ type: "subscribeChannel", channelId });
  }

  async function unsubscribeFromChannel(channelId: string) {
    worker?.postMessage({ type: "unsubscribeChannel", channelId });
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
    if (isSignalRReconnecting.value) {
      worker?.postMessage({ type: "disconnect" });
      nextReconnectAttempt.value = null;
      reconnectAttemptCount.value = 0;
      isSignalRReconnecting.value = false;
      await doListenSignalR();
    }
  }

  function closeAllSubscribes(reason: string) {
    if (worker) {
      worker.postMessage({ type: "disconnect" });
      worker.terminate();
      worker = null;
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
    subscribeToChannel,
    unsubscribeFromChannel,
    IAmTypingEvent,
    IAmStopTypingEvent,
    isSignalRReconnecting,
    nextReconnectAttempt,
    reconnectAttemptCount,
    retryConnectionNow,
    reconnected,
    needFullResync
  };
});
