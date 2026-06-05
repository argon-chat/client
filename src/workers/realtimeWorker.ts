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

// --- Replay cursors ---
// Last stream entry id we processed per delivery channel. On reconnect we hand these to
// the server (Resume) so it can re-send anything we missed during the gap. They live for
// the worker's lifetime — a transient drop or a hard close→reconnect keeps the same worker,
// so the cursors survive; a full teardown (terminate) intentionally resets them.
let userCursor: string | null = null;
const spaceCursors = new Map<string, string>();
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
          const delayMs = Math.min(
            1000 * Math.pow(2, retryContext.previousRetryCount),
            30000
          );
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

    hubConnection.onreconnecting((error) => {
      postLog("warn", "SignalR reconnecting...", error?.message);
      self.postMessage({ type: "state", state: "reconnecting" });
    });

    hubConnection.onreconnected((connectionId) => {
      postLog("info", "SignalR reconnected", connectionId);
      self.postMessage({ type: "state", state: "connected" });
      // Re-subscription happened server-side in OnConnectedAsync; now pull whatever we missed.
      void resumeSession();
    });

    hubConnection.onclose((error) => {
      postLog("error", "SignalR connection closed", error?.message);
      self.postMessage({ type: "state", state: "disconnected" });
      stopHeartbeat();
      if (shouldReconnect) {
        setTimeout(() => connect(endpoint), 5000);
      }
    });

    self.postMessage({ type: "state", state: "connecting" });
    await hubConnection.start();
    postLog("info", "SignalR connected successfully", hubConnection.connectionId);
    self.postMessage({ type: "state", state: "connected" });

    // A fresh start() after a hard close is also a reconnection (SignalR's own
    // auto-reconnect was exhausted). Pull missed events; skip on the very first connect.
    if (hasConnectedBefore) void resumeSession();
    hasConnectedBefore = true;

    startHeartbeat();
  } catch (error: any) {
    postLog("error", "SignalR connection error", error?.message);
    self.postMessage({ type: "state", state: "disconnected" });
    if (shouldReconnect) {
      setTimeout(() => connect(endpoint), 5000);
    }
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
