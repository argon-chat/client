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
const pendingTokenRequests = new Map<string, (token: string) => void>();
var qwe = EventBus_Executor;
console.log(qwe);
function requestToken(): Promise<string> {
  return new Promise((resolve) => {
    const id = String(++tokenRequestId);
    pendingTokenRequests.set(id, resolve);
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

async function connect(endpoint: string) {
  shouldReconnect = true;

  try {
    hubConnection = new signalR.HubConnectionBuilder()
      .withUrl(`${endpoint}/w`, {
        accessTokenFactory: () => requestToken(),
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

    hubConnection.on("forSelf", (data: string) => {
      try {
        if (typeof data !== "string") throw new Error("expected base64 string");
        const event = decodeEvent(data);
        self.postMessage({ type: "event", channel: "forSelf", event });
      } catch (e: any) {
        postLog("error", "Error processing forSelf event", e?.message);
      }
    });

    hubConnection.on("broadcastSpace", (data: string) => {
      try {
        if (typeof data !== "string") throw new Error("expected base64 string");
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
        resolve(msg.token);
        pendingTokenRequests.delete(msg.requestId);
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
