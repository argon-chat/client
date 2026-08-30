/**
 * Realtime Worker — owns the SignalR connection and the replay cursors, off the main thread.
 *
 * Events are handed over as the base64 payload they arrived in and decoded on the main thread.
 * Decoding here and posting the object does not survive the trip: postMessage copies with the
 * structured clone algorithm, which keeps own properties and drops prototypes, so every value with
 * methods — `IonDateTime` above all — arrived as inert data.
 *
 * Protocol (main ↔ worker):
 *   Main → Worker:
 *     { type: 'connect', endpoint: string }
 *     { type: 'disconnect' }
 *     { type: 'tokenResponse', requestId: string, token: string }
 *     { type: 'invoke', method: string, args: any[] }
 *
 *   Worker → Main:
 *     { type: 'event', channel: 'forSelf' | 'broadcastSpace', data: string }
 *     { type: 'tokenRequest', requestId: string }
 *     { type: 'state', state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected',
 *       intentional?: boolean }
 *     { type: 'reconnectInfo', attemptCount: number, nextAttemptAt: number }
 *     { type: 'error', message: string }
 *     { type: 'log', level: 'info' | 'warn' | 'error', message: string, args?: any[] }
 */

import * as signalR from "@microsoft/signalr";
import { DeliveryFilter } from "./streamDelivery";

// --- Token request management ---
let tokenRequestId = 0;
const pendingTokenRequests = new Map<string, (token: string, error?: boolean) => void>();
function requestToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = String(++tokenRequestId);
    const timeout = setTimeout(() => {
      pendingTokenRequests.delete(id);
      reject(new Error("Token request timed out"));
    }, 10000);
    pendingTokenRequests.set(id, (token: string, error?: boolean) => {
      clearTimeout(timeout);
      if (error || !token) {
        reject(new Error("Token request failed"));
      } else {
        resolve(token);
      }
    });
    self.postMessage({ type: "tokenRequest", requestId: id });
  });
}

// --- Helpers ---
function postLog(level: "info" | "warn" | "error", message: string, ...args: any[]) {
  self.postMessage({ type: "log", level, message, args });
}

// --- SignalR connection ---
let hubConnection: signalR.HubConnection | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let shouldReconnect = true;
// Backoff attempt counter for the hard-close / start-failure manual reconnect path
// (SignalR's own auto-reconnect is already exhausted by then). Drives capped exponential backoff
// + jitter so clients don't reconnect in lockstep.
let hardReconnectAttempts = 0;

/**
 * How long a connection has to stand up before it counts as healthy.
 *
 * The counter used to be cleared the moment `start()` resolved, which only says the handshake
 * completed. A server that accepts the connection and then drops it — a session grain landing on a
 * silo that no longer hosts it, say — therefore reset the backoff on every attempt, and the client
 * sat in a one-second connect/close loop, asking for a full state resync on every lap. Backing off
 * is exactly the right response to that: the silo needs a moment, and so do we.
 */
const STABLE_CONNECTION_MS = 30_000;

/** When the current connection came up, or 0 while there isn't one. */
let connectedAt = 0;

// --- Replay state ---
// One DeliveryFilter per delivery channel: it decides what to hand the main thread, and holds the
// cursor we give the server on reconnect (Resume) so it can re-send anything we missed during the
// gap. They live for the worker's lifetime — a transient drop or a hard close→reconnect keeps the
// same worker, so they survive; a full teardown (terminate) intentionally resets them.
const userDelivery = new DeliveryFilter();
const spaceDelivery = new Map<string, DeliveryFilter>();

function deliveryFor(spaceId: string): DeliveryFilter {
  let filter = spaceDelivery.get(spaceId);
  if (!filter) spaceDelivery.set(spaceId, (filter = new DeliveryFilter()));
  return filter;
}

// Channel delivery groups this client wants to be in. SignalR groups are per-connection, so the
// server-side membership is lost on every reconnect — we re-join all of these on (re)connect.
// Updated by the subscribeChannel/unsubscribeChannel messages from the main thread.
const subscribedChannels = new Set<string>();
let hasConnectedBefore = false;

async function resumeSession() {
  if (hubConnection?.state !== signalR.HubConnectionState.Connected) return;
  try {
    const spaceCursorsObj: Record<string, string> = {};
    for (const [spaceId, filter] of spaceDelivery)
      if (filter.cursor) spaceCursorsObj[spaceId] = filter.cursor;

    const ack: any = await hubConnection.invoke("Resume", userDelivery.cursor, spaceCursorsObj);
    const needFull = ack?.needFullResync ?? ack?.NeedFullResync ?? false;
    if (needFull) {
      postLog("warn", "Resume reported a gap — full resync required");
      self.postMessage({ type: "needFullResync" });
    } else {
      postLog("info", "Resume completed, missed events replayed");
    }
  } catch (e: any) {
    // A resume that failed because the connection went away says nothing about the replay buffer:
    // the next connect resumes from the same cursor. Only treat it as a lost buffer while the
    // connection is actually up — otherwise a flapping server would order a full client rebuild
    // once per flap, which is the most expensive possible response to a server that is struggling.
    if (hubConnection?.state !== signalR.HubConnectionState.Connected) {
      postLog("warn", "Resume abandoned, connection went away", e?.message);
      return;
    }
    postLog("error", "Resume failed, requesting full resync", e?.message);
    self.postMessage({ type: "needFullResync" });
  }
}

// Schedule a manual reconnect with capped exponential backoff + equal jitter. The hard-close
// and start()-failure paths previously retried at a fixed 5s with no jitter: a silo blip
// dropped many clients that then reconnected in synchronized 5s waves forever, amplifying the
// outage. Equal jitter spreads them out and the backoff relieves a struggling silo.
function scheduleReconnect(endpoint: string) {
  if (!shouldReconnect) return;
  const base = Math.min(1000 * Math.pow(2, hardReconnectAttempts), 30000);
  const delayMs = Math.round(base * 0.5 + Math.random() * base * 0.5);
  hardReconnectAttempts++;
  self.postMessage({
    type: "reconnectInfo",
    attemptCount: hardReconnectAttempts,
    nextAttemptAt: Date.now() + delayMs,
  });
  setTimeout(() => connect(endpoint), delayMs);
}

async function connect(endpoint: string) {
  shouldReconnect = true;

  try {
    hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(`${endpoint}/w`, {
        accessTokenFactory: async () => {
          // Retry token request up to 3 times on failure
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              return await requestToken();
            } catch (e) {
              postLog("warn", `Token request attempt ${attempt + 1} failed, retrying...`);
              if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
          }
          throw new Error("Failed to obtain token after 3 attempts");
        },
        transport:
          signalR.HttpTransportType.WebSockets |
          signalR.HttpTransportType.ServerSentEvents |
          signalR.HttpTransportType.LongPolling,
        skipNegotiation: false,
      })
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          // Equal jitter (half fixed backoff + half random), capped at 30s. Without jitter
          // every client dropped by the same silo blip recomputes the identical delay and
          // reconnects in lockstep waves, hammering the single silo exactly when it's weakest.
          const base = Math.min(
            1000 * Math.pow(2, retryContext.previousRetryCount),
            30000
          );
          const delayMs = Math.round(base * 0.5 + Math.random() * base * 0.5);
          self.postMessage({
            type: "reconnectInfo",
            attemptCount: retryContext.previousRetryCount,
            nextAttemptAt: Date.now() + delayMs,
          });
          return delayMs;
        },
      })
      .configureLogging(signalR.LogLevel.Information)
      .build();

    hubConnection.on("forSelf", (data: string, entryId?: string) => {
      try {
        if (typeof data !== "string") throw new Error("expected base64 string");
        // Skip duplicates (a replayed event that also arrived live), but nothing else — an event
        // that simply arrives late still has to be shown.
        if (entryId && !userDelivery.accept(entryId)) return;
        self.postMessage({ type: "event", channel: "forSelf", data });
      } catch (e: any) {
        postLog("error", "Error processing forSelf event", e?.message);
      }
    });

    hubConnection.on("broadcastSpace", (data: string, spaceId?: string, entryId?: string) => {
      try {
        if (typeof data !== "string") throw new Error("expected base64 string");
        if (spaceId && entryId && !deliveryFor(spaceId).accept(entryId)) return;
        self.postMessage({ type: "event", channel: "broadcastSpace", data });
      } catch (e: any) {
        postLog("error", "Error processing broadcastSpace event", e?.message);
      }
    });

    // Channel-scoped content (messages/typing/reactions) for the channel(s) we've joined.
    // No replay cursor: missed messages on a brief drop are recovered by the chat's own history
    // load; typing is ephemeral and reactions load with their message.
    hubConnection.on("broadcastChannel", (data: string, _channelId?: string) => {
      try {
        if (typeof data !== "string") throw new Error("expected base64 string");
        self.postMessage({ type: "event", channel: "broadcastChannel", data });
      } catch (e: any) {
        postLog("error", "Error processing broadcastChannel event", e?.message);
      }
    });

    hubConnection.onreconnecting((error) => {
      postLog("warn", "SignalR reconnecting...", error?.message);
      self.postMessage({ type: "state", state: "reconnecting" });
    });

    hubConnection.onreconnected((connectionId) => {
      postLog("info", "SignalR reconnected", connectionId);
      self.postMessage({ type: "state", state: "connected" });
      // Space re-subscription happens server-side in OnConnectedAsync; channel groups are this
      // client's responsibility — re-join them — then pull whatever we missed.
      resubscribeChannels();
      void resumeSession();
      // The reconnect re-ran OnConnectedAsync server-side, which reset the session to Online —
      // re-assert our real status right away instead of waiting for the next heartbeat tick.
      sendHeartbeatNow();
    });

    hubConnection.onclose((error) => {
      const uptimeMs = connectedAt === 0 ? 0 : Date.now() - connectedAt;
      connectedAt = 0;

      // A close we asked for (logout, account switch, an explicit retry) is not a fault and must
      // not raise the reconnect UI on the way out.
      if (!shouldReconnect) {
        postLog("info", "SignalR connection closed on request");
        self.postMessage({ type: "state", state: "disconnected", intentional: true });
        stopHeartbeat();
        return;
      }

      postLog("error", "SignalR connection closed", error?.message);
      self.postMessage({ type: "state", state: "disconnected" });
      stopHeartbeat();

      // Only a connection that stood up clears the backoff. One that died on arrival is another
      // failed attempt, and the next wait is longer than the last.
      if (uptimeMs >= STABLE_CONNECTION_MS) hardReconnectAttempts = 0;
      else if (uptimeMs > 0)
        postLog("warn", `Connection lasted ${Math.round(uptimeMs / 1000)}s — backing off further`);

      scheduleReconnect(endpoint);
    });

    self.postMessage({ type: "state", state: "connecting" });
    await hubConnection.start();
    connectedAt = Date.now();
    postLog("info", "SignalR connected successfully", hubConnection.connectionId);
    self.postMessage({ type: "state", state: "connected" });

    // A fresh start() after a hard close is also a reconnection (SignalR's own
    // auto-reconnect was exhausted). Pull missed events; skip on the very first connect.
    if (hasConnectedBefore) void resumeSession();
    hasConnectedBefore = true;

    // (Re)join channel delivery groups for whatever the client currently has open. Also covers the
    // race where the main thread requested a channel subscription before the hub was connected.
    resubscribeChannels();

    startHeartbeat();
  } catch (error: any) {
    postLog("error", "SignalR connection error", error?.message);
    self.postMessage({ type: "state", state: "disconnected" });
    scheduleReconnect(endpoint);
  }
}

function disconnect() {
  shouldReconnect = false;
  connectedAt = 0;
  hardReconnectAttempts = 0;
  stopHeartbeat();
  if (hubConnection) {
    hubConnection.stop();
    hubConnection = null;
  }
}

// --- Heartbeat ---
// Ask the main thread for the current status and push it to the server now. The server starts a
// (re)connected session as Online by default and only learns the real status from a heartbeat, so
// firing one immediately — instead of waiting up to a full interval — collapses the window where a
// DnD/Away user briefly looks Online to everyone after connecting.
function sendHeartbeatNow() {
  if (hubConnection?.state === signalR.HubConnectionState.Connected)
    self.postMessage({ type: "heartbeatRequest" });
}

function startHeartbeat() {
  stopHeartbeat();
  sendHeartbeatNow();
  heartbeatInterval = setInterval(sendHeartbeatNow, 15000);
}

function stopHeartbeat() {
  if (heartbeatInterval !== null) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// --- Invoke commands ---
async function invokeOnHub(method: string, args: any[]) {
  if (hubConnection?.state === signalR.HubConnectionState.Connected) {
    try {
      await hubConnection.invoke(method, ...args);
    } catch (e: any) {
      postLog("error", `Failed to invoke ${method}`, e?.message);
    }
  }
}

function resubscribeChannels() {
  for (const channelId of subscribedChannels)
    void invokeOnHub("SubscribeToChannel", [channelId]);
}

// --- Message handler ---
self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  switch (msg.type) {
    case "connect":
      connect(msg.endpoint);
      break;
    case "disconnect":
      disconnect();
      break;
    case "subscribeChannel":
      subscribedChannels.add(msg.channelId);
      void invokeOnHub("SubscribeToChannel", [msg.channelId]);
      break;
    case "unsubscribeChannel":
      subscribedChannels.delete(msg.channelId);
      void invokeOnHub("UnSubscribeToChannel", [msg.channelId]);
      break;
    case "tokenResponse": {
      const resolve = pendingTokenRequests.get(msg.requestId);
      if (resolve) {
        pendingTokenRequests.delete(msg.requestId);
        resolve(msg.token, msg.error);
      }
      break;
    }
    case "invoke":
      invokeOnHub(msg.method, msg.args ?? []);
      break;
    case "heartbeatInvoke":
      // Main thread responds with status to use for heartbeat
      invokeOnHub("Heartbeat", [msg.status]);
      break;
  }
};
