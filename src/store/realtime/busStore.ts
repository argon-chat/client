import { defineStore } from "pinia";
import { Subject, type Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { useApi } from "@/store/system/apiStore";
import { logger } from "@argon/core";
import { ref } from "vue";
import { IArgonEvent, UserStatus } from "@argon/glue";
import { CborReader, IonFormatterStorage, type Guid } from "@argon-chat/ion.webcore";
import RealtimeWorker from "@/workers/realtimeWorker?worker";
import { metrics, errorKind } from "@/lib/telemetry/metrics";

export type EventWithServerId<T> = { spaceId: string } & T;

/**
 * Turns the payload the worker forwarded back into an event.
 *
 * This runs here rather than in the worker because postMessage copies with the structured clone
 * algorithm: own properties survive, prototypes do not. An event decoded on the far side arrived
 * holding the right numbers and none of the methods, which is why a datetime off an event answered
 * `toDate is not a function` at the first call site. Decoded on this side it is the same live shape
 * every API call returns.
 */
function decodeEvent(data: string): IArgonEvent {
  const binary = atob(data);
  const reader = new CborReader(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  return IonFormatterStorage.get<IArgonEvent>("IArgonEvent").read(reader);
}

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
  // When the current outage began, so a reconnect can report how long the app was cut off. Null
  // while connected, and while the very first connection is still being made.
  let outageStartedAt: number | null = null;

  function noteOutage(intentional: boolean) {
    if (outageStartedAt !== null) return;
    outageStartedAt = performance.now();
    metrics.count("realtime.disconnected", { intentional, ever_connected: everConnected });
  }

  function createWorker() {
    if (worker) return worker;
    
    worker = new RealtimeWorker();

    worker.onmessage = async (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case "event":
          try {
            const event = decodeEvent(msg.data);
            logger.log("Received event from worker:", event);
            argonEventBus.next(event);
          } catch (err) {
            // One unreadable payload is not worth tearing the connection down for — the rest of
            // the stream is still good, and history reload covers whatever this one carried.
            logger.error("Failed to decode realtime event", err);
            metrics.count("realtime.event.decode_failed", { error: errorKind(err) });
          }
          break;

        case "tokenRequest":
          // Worker needs auth token — fetch from main thread API and respond
          try {
            const token = await api.eventBus.PickTicket();
            worker!.postMessage({ type: "tokenResponse", requestId: msg.requestId, token });
          } catch (err) {
            logger.error("Failed to get token for worker", err);
            metrics.count("realtime.ticket.failed", { error: errorKind(err) });
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
            noteOutage(false);
          } else if (msg.state === "connected") {
            const isReconnection = everConnected;
            metrics.count("realtime.connected", { reconnect: isReconnection });
            if (isReconnection) {
              metrics.distribution("realtime.reconnect.attempts", reconnectAttemptCount.value, "none");
              if (outageStartedAt !== null) {
                metrics.distribution("realtime.outage.duration", performance.now() - outageStartedAt, "millisecond");
              }
            }
            outageStartedAt = null;
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
            // The worker reconnects on its own, with a growing delay between attempts. That wait is
            // the part worth showing: without this the app looked connected while it was in fact
            // sitting out a backoff, and the reconnect overlay — which counts down to the next
            // attempt — never appeared on the path that needs it most. A close we asked for is not
            // a reconnect and says so.
            if (!msg.intentional) isSignalRReconnecting.value = true;
            noteOutage(!!msg.intentional);
          }
          break;

        case "reconnectInfo":
          reconnectAttemptCount.value = msg.attemptCount;
          nextReconnectAttempt.value = msg.nextAttemptAt;
          break;

        case "needFullResync":
          metrics.count("realtime.resync.full");
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
      metrics.count("realtime.worker.error");
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

  // Tell the server this client is going offline intentionally (logout / quit / account switch) so
  // others see it immediately instead of waiting out the disconnect grace window. Best-effort: if the
  // connection is already gone the server-side grace covers it anyway.
  async function goOffline() {
    worker?.postMessage({ type: "invoke", method: "GoOffline", args: [] });
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

  /**
   * Nudge the realtime connection after the tab has been asleep.
   *
   * Distinct from `retryConnectionNow`, which is the user pressing "try again" on a visible
   * reconnect banner: this one runs when nothing looked wrong, because after a freeze nothing
   * would. The worker decides what the situation actually is.
   */
  function wakeConnection() {
    worker?.postMessage({ type: "wake" });
  }

  async function retryConnectionNow() {
    if (isSignalRReconnecting.value) {
      metrics.count("realtime.reconnect.manual", { attempts: reconnectAttemptCount.value });
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
    goOffline,
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
    wakeConnection,
    reconnected,
    needFullResync
  };
});
