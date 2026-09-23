import { defineStore } from "pinia";
import { Subject, type Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { useApi } from "@/store/system/apiStore";
import { logger } from "@argon/core";
import { ref } from "vue";
import { IArgonEvent, UserStatus } from "@argon/glue";
import { CborReader, IonFormatterStorage, IonRequestException, type Guid } from "@argon-chat/ion.webcore";
import RealtimeWorker from "@/workers/realtimeWorker?worker";
import { metrics, errorKind } from "@/lib/telemetry/metrics";
import { isSessionRejected } from "@/lib/net/authFailure";
import { forceSignOut, handleSessionRejected } from "@/lib/net/sessionRecovery";

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
function decodeEvent(data: ArrayBuffer): IArgonEvent {
  return IonFormatterStorage.get<IArgonEvent>("IArgonEvent").read(new CborReader(new Uint8Array(data)));
}

/** What the worker needs to know about a failed ticket exchange: see its `ticketError`. */
function describeTicketFailure(err: unknown): { status?: number; code?: string; message: string } {
  if (err instanceof IonRequestException)
    return { status: err.status, code: err.error?.code, message: err.error?.message ?? err.message };
  return { message: err instanceof Error ? err.message : String(err) };
}

export const useBus = defineStore("bus", () => {
  const argonEventBus = new Subject<IArgonEvent>();
  const userEventBus = new Subject<IArgonEvent>();
  // Fires whenever the realtime connection is re-established after having been
  // connected before (transient auto-reconnect OR hard close → manual reconnect).
  // Used to resync state that may have drifted while events were missed.
  const reconnected = new Subject<void>();
  let everConnected = false;
  // Fires when the connection came back on the same server-side session (the stream was resumed):
  // nothing was missed, so there is nothing to resync — only the "reconnecting" state to clear.
  const resumed = new Subject<void>();
  // Fires when the server's replay buffer couldn't guarantee continuity on Resume
  // (cursor trimmed / too far behind) — the client must rebuild state from scratch.
  const needFullResync = new Subject<void>();
  const isReconnecting = ref(false);
  const nextReconnectAttempt = ref<number | null>(null);
  const reconnectAttemptCount = ref(0);

  const api = useApi();
  let worker: Worker | null = null;
  // When the current outage began, so a reconnect can report how long the app was cut off. Null
  // while connected, and while the very first connection is still being made.
  let outageStartedAt: number | null = null;
  // Set while "try again" re-dials: the intentional close it causes is a step in recovering from the
  // outage, not the end of it, so the outage clock must survive it.
  let manualRetryInFlight = false;

  function noteOutage() {
    if (outageStartedAt !== null) return;
    outageStartedAt = performance.now();
    metrics.count("realtime.disconnected", { intentional: false, ever_connected: everConnected });
  }

  function createWorker() {
    if (worker) return worker;

    // Held locally: an answer that arrives after `closeAllSubscribes` replaced the worker must not
    // be posted to its successor.
    const w: Worker = new RealtimeWorker();
    worker = w;

    w.onmessage = async (e: MessageEvent) => {
      const msg = e.data;
      switch (msg.type) {
        case "event":
          try {
            const event = decodeEvent(msg.data);
            // debug, not log: every realtime event went to the console (and, via the console
            // integration, into a Sentry breadcrumb) with the whole decoded payload attached.
            logger.debug("Received event from worker:", event);
            argonEventBus.next(event);
          } catch (err) {
            // One unreadable payload is not worth tearing the connection down for — the rest of
            // the stream is still good, and history reload covers whatever this one carried.
            logger.error("Failed to decode realtime event", err);
            metrics.count("realtime.event.decode_failed", { error: errorKind(err) });
          }
          break;

        case "ticketRequest":
          // The stream in the worker is about to connect and needs a ticket. The exchange runs here,
          // through the API client's interceptors (credentials, device proof, locale, client
          // descriptor, machine id), which reach stores the worker does not have.
          try {
            const payload = await api.exchangeStreamTicket("IEventBus", "Realtime");
            const buffer = payload.slice().buffer;
            w.postMessage({ type: "ticketResponse", requestId: msg.requestId, payload: buffer }, [buffer]);
          } catch (err) {
            logger.error("Failed to get a realtime ticket for the worker", err);
            metrics.count("realtime.ticket.failed", { error: errorKind(err) });

            // A refused ticket is the way a signed-out device finds out: the server ended this session
            // from another device, or the access token has simply run out. Only a refresh can tell the
            // two apart, so ask, and let the answer decide whether the worker keeps trying — a renewed
            // token makes its next attempt succeed, a refused one means the page is already reloading
            // into sign-in and the worker must stop rather than ask the server the same thing forever.
            let fatal = false;
            if (isSessionRejected(err)) {
              fatal = (await handleSessionRejected("realtime ticket")) === "signed_out";
            }

            // Always respond so the worker doesn't wait out its timeout.
            w.postMessage({
              type: "ticketResponse",
              requestId: msg.requestId,
              error: describeTicketFailure(err),
              fatal,
            });
          }
          break;

        case "sessionRevoked":
          // The server said so on the socket itself, right before closing it. There is nothing to
          // ask: the session is over on this device. The reason is a code the sign-in screen
          // translates once the page has reloaded into it.
          logger.warn("[RealtimeWorker] the server ended this session:", msg.reason);
          forceSignOut(msg.reason, "server signal");
          break;

        case "heartbeatRequest":
          // The worker asks what to report; this is the only channel by which the server learns
          // this user's status at all. It starts a session statusless and waits out a short
          // deadline for the first heartbeat, so the answer below IS the status everyone sees —
          // and the fallback matters, because the worker heartbeats the moment it connects and
          // the profile is not always in by then (a reconnect that beats a re-run of the boot
          // sequence, a resync). A hard-coded Online there announced exactly the status a Do Not
          // Disturb user did not choose; the persisted preference is what they last picked, and it
          // is read per call so a status chosen or switched to since the store was built counts.
          try {
            const { useMe } = await import("../auth/meStore");
            const me = useMe();
            const status = me.me?.currentStatus ?? me.preferredStatus ?? UserStatus.Online;
            w.postMessage({ type: "heartbeatInvoke", status });
          } catch (err) {
            logger.error("Failed to send heartbeat status to worker", err);
          }
          break;

        case "state":
          if (msg.state === "reconnecting") {
            isReconnecting.value = true;
            noteOutage();
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
            manualRetryInFlight = false;
            everConnected = true;
            isReconnecting.value = false;
            nextReconnectAttempt.value = null;
            reconnectAttemptCount.value = 0;
            // Re-establishment (not first connect): on a fresh server-side session events may have
            // been missed during the gap — notify listeners to resync. A resumed one missed nothing.
            if (isReconnection) (msg.resumed ? resumed : reconnected).next();
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
            if (msg.intentional) {
              // A close we asked for (logout, account switch) is counted, but it is not downtime:
              // drop the clock, or the next connection would report the switch as an outage.
              metrics.count("realtime.disconnected", { intentional: true, ever_connected: everConnected });
              if (!manualRetryInFlight) outageStartedAt = null;
            } else {
              isReconnecting.value = true;
              noteOutage();
            }
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

    w.onerror = (err) => {
      logger.error("[RealtimeWorker] Worker error:", err);
      metrics.count("realtime.worker.error");
    };

    return w;
  }

  async function connectRealtime() {
    const w = createWorker();
    w.postMessage({
      type: "connect",
      endpoint: api.apiEndpoint,
      sessionId: api.ionSessionId,
      webTransport: api.webTransportEndpoint,
    });
  }

  async function doListenMyEvents() {
    await connectRealtime();
  }

  async function IAmTypingEvent(spaceId: Guid, channelId: Guid) {
    worker?.postMessage({ type: "invoke", method: "Typing", args: [spaceId, channelId] });
  }

  async function IAmStopTypingEvent(spaceId: Guid, channelId: Guid) {
    worker?.postMessage({ type: "invoke", method: "StopTyping", args: [spaceId, channelId] });
  }

  /**
   * Put a status on the wire now instead of at the next heartbeat tick.
   *
   * The heartbeat samples `me.currentStatus` every 15 s, which is the right cadence for keeping a
   * session alive but the wrong one for a decision the user just made: someone who picks Do Not
   * Disturb before a meeting kept being shown to everyone else as whatever they were, for up to a
   * full interval, with nothing on their own screen saying so. This sends the same `Heartbeat` the
   * tick sends — the server treats a repeat of the current status as a no-op and rate-limits real
   * changes with its own token bucket — so an early one costs nothing and the tick stays as it is.
   *
   * Best-effort by design: with no worker (not connected yet) it is a no-op, and while the stream is
   * down the worker keeps only the latest status for when it is back.
   *
   * Defect C2, pinned by `test/store/busHeartbeatStatus.test.ts` "choosing a status pushes it
   * instead of waiting for the next tick".
   */
  function pushStatusNow(status: UserStatus) {
    worker?.postMessage({ type: "invoke", method: "Heartbeat", args: [status] });
  }

  // Tell the server this client is going offline intentionally (logout / quit / account switch) so
  // others see it immediately instead of waiting out the disconnect grace window. Best-effort: if the
  // connection is already gone the server-side grace covers it anyway.
  async function goOffline() {
    worker?.postMessage({ type: "invoke", method: "GoOffline", args: [] });
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
    if (isReconnecting.value) {
      metrics.count("realtime.reconnect.manual", { attempts: reconnectAttemptCount.value });
      manualRetryInFlight = true;
      worker?.postMessage({ type: "disconnect" });
      nextReconnectAttempt.value = null;
      reconnectAttemptCount.value = 0;
      isReconnecting.value = false;
      await connectRealtime();
    }
  }

  function closeAllSubscribes(reason: string) {
    // The worker is terminated outright, so no "disconnected" message will follow to do this.
    outageStartedAt = null;
    manualRetryInFlight = false;
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
    goOffline,
    pushStatusNow,
    subscribeToChannel,
    unsubscribeFromChannel,
    IAmTypingEvent,
    IAmStopTypingEvent,
    isReconnecting,
    nextReconnectAttempt,
    reconnectAttemptCount,
    retryConnectionNow,
    wakeConnection,
    reconnected,
    resumed,
    needFullResync
  };
});
