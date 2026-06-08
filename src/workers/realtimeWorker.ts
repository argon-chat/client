/**
 * Realtime Worker — handles SignalR connection + CBOR deserialization off the main thread.
 *
 * Protocol (main ↔ worker):
 *   Main → Worker:
 *     { type: 'connect', endpoint: string }
 *     { type: 'disconnect' }
 *     { type: 'tokenResponse', requestId: string, token: string }
 *     { type: 'invoke', method: string, args: any[] }
 *
 *   Worker → Main:
 *     { type: 'event', channel: 'forSelf' | 'broadcastSpace', event: object }
 *     { type: 'tokenRequest', requestId: string }
 *     { type: 'state', state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' }
 *     { type: 'reconnectInfo', attemptCount: number, nextAttemptAt: number }
 *     { type: 'error', message: string }
 *     { type: 'log', level: 'info' | 'warn' | 'error', message: string, args?: any[] }
 */

import * as signalR from "@microsoft/signalr";
import { CborReader, IonFormatterStorage } from "@argon-chat/ion.webcore";
import "@argon-chat/ion.webcore";
import { EventBus_Executor } from "@argon/glue";
import type { IArgonEvent } from "@argon/glue";

// --- Token request management ---
let tokenRequestId = 0;
const pendingTokenRequests = new Map<string, (token: string, error?: boolean) => void>();
var qwe = EventBus_Executor;
console.log(qwe);
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
function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function postLog(level: "info" | "warn" | "error", message: string, ...args: any[]) {
  self.postMessage({ type: "log", level, message, args });
}

function decodeEvent(data: string): IArgonEvent {
  const u8 = base64ToU8(data);
  const reader = new CborReader(u8);
  return IonFormatterStorage.get<IArgonEvent>("IArgonEvent").read(reader);
}

// --- SignalR connection ---
let hubConnection: signalR.HubConnection | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let shouldReconnect = true;
// Backoff attempt counter for the hard-close / start-failure manual reconnect path
// (SignalR's own auto-reconnect is already exhausted by then). Reset to 0 on a successful
// start(). Drives capped exponential backoff + jitter so clients don't reconnect in lockstep.
let hardReconnectAttempts = 0;

// --- Replay cursors ---
// Last stream entry id we processed per delivery channel. On reconnect we hand these to
// the server (Resume) so it can re-send anything we missed during the gap. They live for
// the worker's lifetime — a transient drop or a hard close→reconnect keeps the same worker,
// so the cursors survive; a full teardown (terminate) intentionally resets them.
let userCursor: string | null = null;
const spaceCursors = new Map<string, string>();
// Channel delivery groups this client wants to be in. SignalR groups are per-connection, so the
// server-side membership is lost on every reconnect — we re-join all of these on (re)connect.
// Updated by the subscribeChannel/unsubscribeChannel messages from the main thread.
const subscribedChannels = new Set<string>();
let hasConnectedBefore = false;

// Compare Redis stream ids of the form "<unixMs>-<seq>". Returns <0, 0, >0.
function compareStreamIds(a: string, b: string): number {
  const ai = a.indexOf("-");
  const bi = b.indexOf("-");
  const aMs = Number(a.slice(0, ai));
  const bMs = Number(b.slice(0, bi));
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  const aSeq = Number(a.slice(ai + 1));
  const bSeq = Number(b.slice(bi + 1));
  if (aSeq !== bSeq) return aSeq < bSeq ? -1 : 1;
  return 0;
}

// Returns false if the entry id is not newer than what we've already applied (duplicate,
// e.g. a replayed event that also arrived live). Advances the cursor when it is newer.
function advanceCursor(get: () => string | null, set: (id: string) => void, entryId: string): boolean {
  const cur = get();
  if (cur && compareStreamIds(entryId, cur) <= 0) return false;
  set(entryId);
  return true;
}

async function resumeSession() {
  if (!hubConnection) return;
  try {
    const spaceCursorsObj: Record<string, string> = {};
    for (const [k, v] of spaceCursors) spaceCursorsObj[k] = v;

    const ack: any = await hubConnection.invoke("Resume", userCursor, spaceCursorsObj);
    const needFull = ack?.needFullResync ?? ack?.NeedFullResync ?? false;
    if (needFull) {
      postLog("warn", "Resume reported a gap — full resync required");
      self.postMessage({ type: "needFullResync" });
    } else {
      postLog("info", "Resume completed, missed events replayed");
    }
  } catch (e: any) {
    // Couldn't resume — safest is to rebuild state from scratch.
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
        // Skip duplicates (a replayed event that also arrived live); advance the cursor.
        if (entryId && !advanceCursor(() => userCursor, (id) => (userCursor = id), entryId))
          return;
        const event = decodeEvent(data);
        self.postMessage({ type: "event", channel: "forSelf", event });
      } catch (e: any) {
        postLog("error", "Error processing forSelf event", e?.message);
      }
    });

    hubConnection.on("broadcastSpace", (data: string, spaceId?: string, entryId?: string) => {
      try {
        if (typeof data !== "string") throw new Error("expected base64 string");
        if (spaceId && entryId &&
            !advanceCursor(() => spaceCursors.get(spaceId) ?? null, (id) => spaceCursors.set(spaceId, id), entryId))
          return;
        const event = decodeEvent(data);
        self.postMessage({ type: "event", channel: "broadcastSpace", event });
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
        const event = decodeEvent(data);
        self.postMessage({ type: "event", channel: "broadcastChannel", event });
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
    });

    hubConnection.onclose((error) => {
      postLog("error", "SignalR connection closed", error?.message);
      self.postMessage({ type: "state", state: "disconnected" });
      stopHeartbeat();
      scheduleReconnect(endpoint);
    });

    self.postMessage({ type: "state", state: "connecting" });
    await hubConnection.start();
    hardReconnectAttempts = 0; // healthy connection — reset hard-reconnect backoff
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
  stopHeartbeat();
  if (hubConnection) {
    hubConnection.stop();
    hubConnection = null;
  }
}

// --- Heartbeat ---
function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (hubConnection?.state === signalR.HubConnectionState.Connected) {
      // Request main thread to provide current status and invoke heartbeat
      self.postMessage({ type: "heartbeatRequest" });
    }
  }, 15000);
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
