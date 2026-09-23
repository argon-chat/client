/**
 * Realtime Worker — owns the realtime stream and the replay cursors, off the main thread.
 *
 * The stream is `EventBus.Realtime`, an Ion full-duplex call: frames in (`RealtimeFrame`), commands
 * out (`RealtimeCommand`, through a {@link CommandQueue}). Ion reconnects a dropped connection on
 * its own and, inside the server's resume window, resumes the session without losing a frame either
 * way. The worker steps in only when the call itself ends, with a backoff of its own.
 *
 * Events are handed over as the raw CBOR payload they arrived in (its buffer transferred, not
 * copied) and decoded on the main thread. Decoding here and posting the object does not survive the
 * trip: postMessage copies with the structured clone algorithm, which keeps own properties and drops
 * prototypes, so every value with methods — `IonDateTime` above all — arrived as inert data.
 *
 * Protocol (main ↔ worker):
 *   Main → Worker:
 *     { type: 'connect', endpoint: string, sessionId?: string, webTransport?: string | null }
 *     { type: 'disconnect' }
 *     { type: 'wake' }
 *     { type: 'subscribeChannel' | 'unsubscribeChannel', channelId: string }
 *     { type: 'ticketResponse', requestId: string, payload?: ArrayBuffer,
 *       error?: { status?: number, code?: string, message: string }, fatal?: boolean }
 *     { type: 'invoke', method: 'Heartbeat' | 'GoOffline' | 'Typing' | 'StopTyping', args: any[] }
 *     { type: 'heartbeatInvoke', status: UserStatus }
 *
 *   Worker → Main:
 *     { type: 'event', channel: 'forSelf' | 'forSpace' | 'forChannel', data: ArrayBuffer }
 *     { type: 'ticketRequest', requestId: string }
 *     { type: 'state', state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected',
 *       intentional?: boolean, resumed?: boolean }
 *     { type: 'reconnectInfo', attemptCount: number, nextAttemptAt: number }
 *     { type: 'needFullResync' }
 *     { type: 'sessionRevoked', reason: string }
 *     { type: 'heartbeatRequest' }
 *     { type: 'log', level: 'info' | 'warn' | 'error', message: string, args?: any[] }
 */

import {
  IonRequestException,
  IonStreamClosedError,
  IonWsClient,
  type IonInterceptor,
} from "@argon-chat/ion.webcore";
import {
  createClient,
  GoOffline,
  Heartbeat,
  Resume,
  StopTyping,
  SubscribeToChannel,
  Typing,
  UnsubscribeFromChannel,
  type IRealtimeCommand,
  type IRealtimeFrame,
  type RealtimeCursor,
  type UserStatus,
} from "@argon/glue";
import { CommandQueue } from "./commandQueue";
import { DeliveryFilter } from "./streamDelivery";
import { realtimeStreamOptions } from "./realtimeTransport";

const HEARTBEAT_INTERVAL_MS = 15_000;
const TICKET_TIMEOUT_MS = 10_000;

/** The reason code the server uses for a signed-out session; see `sessionRecovery`. */
const SIGNED_OUT_REASON = "session_signed_out";

// --- Helpers ---
function postLog(level: "info" | "warn" | "error", message: string, ...args: any[]) {
  self.postMessage({ type: "log", level, message, args });
}

// --- Ticket exchange ---
// A stream call exchanges credentials for a ticket (`POST /ion.att`) before every connection
// attempt. The credentials, and the interceptors that attach them, live on the main thread, so the
// exchange is made there and its response handed back; the interceptor below stands in for the
// request and never calls `next`.

type TicketAnswer = {
  payload?: ArrayBuffer;
  error?: { status?: number; code?: string; message: string };
  fatal?: boolean;
};

let ticketRequestId = 0;
const pendingTickets = new Map<string, (answer: TicketAnswer) => void>();

/**
 * The main thread found out the session is over while fetching a ticket. Not a failure to retry:
 * every further attempt would ask the server the same question and get the same answer, which is
 * the 400-per-second loop a signed-out device used to sit in.
 */
class SessionEndedError extends Error {
  constructor() {
    super("The session has been signed out");
  }
}

function requestTicket(signal?: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const id = String(++ticketRequestId);
    const done = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      pendingTickets.delete(id);
    };
    const onAbort = () => {
      done();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      done();
      reject(new TypeError("Ticket request timed out"));
    }, TICKET_TIMEOUT_MS);

    signal?.addEventListener("abort", onAbort, { once: true });
    pendingTickets.set(id, (answer) => {
      done();
      if (answer.payload) resolve(new Uint8Array(answer.payload));
      else reject(ticketError(answer));
    });
    self.postMessage({ type: "ticketRequest", requestId: id });
  });
}

/**
 * The failure in the shape Ion's retry policy reads: a refusal (4xx) ends the call, 5xx/408/429 and
 * a network failure (a `TypeError`) are retried with its backoff, and a signed-out session is
 * neither — it ends the call and nothing reconnects.
 */
function ticketError(answer: TicketAnswer): Error {
  if (answer.fatal) return new SessionEndedError();
  const e = answer.error;
  if (e?.status !== undefined)
    return new IonRequestException({ code: e.code ?? String(e.status), message: e.message }, e.status);
  return new TypeError(e?.message ?? "Ticket request failed");
}

const ticketInterceptor: IonInterceptor = {
  async invokeAsync(ctx, _next, signal) {
    ctx.responsePayload = await requestTicket(signal);
  },
};

// --- The stream ---

interface ConnectOptions {
  endpoint: string;
  sessionId?: string;
  webTransport?: string | null;
}

interface Call {
  readonly controller: AbortController;
  readonly commands: CommandQueue<IRealtimeCommand>;
}

/**
 * The current stream call, or null while there is none (backing off, stopped).
 *
 * Whatever an earlier call does after it was replaced or ended on purpose is dropped: an aborted
 * call reports its ending asynchronously, and everything that handler touches is shared — it would
 * report the app as disconnected and schedule a second reconnect on top of a call that is working.
 * So every handler first checks that its call is still this one.
 */
let call: Call | null = null;

/** Between a Welcome (or a lossless resume) and the next drop. */
let connected = false;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let shouldReconnect = true;
// Backoff attempt counter for the path where the call itself ended (Ion's own reconnect does not
// apply there). Drives capped exponential backoff + jitter so clients don't reconnect in lockstep.
let hardReconnectAttempts = 0;

/**
 * How long a connection has to stand up before it counts as healthy.
 *
 * A server that accepts the connection and then ends it — a session grain landing on a silo that no
 * longer hosts it, say — would otherwise reset the backoff on every attempt and keep the client in a
 * one-second connect/close loop, asking for a full state resync on every lap. Backing off is exactly
 * the right response to that: the silo needs a moment, and so do we.
 */
const STABLE_CONNECTION_MS = 30_000;

/** When the current connection came up, or 0 while there isn't one. */
let connectedAt = 0;

/** The last `connect` we were asked for, so a wake or a backoff can re-dial without being told. */
let currentConnect: ConnectOptions | null = null;

/** The pending backoff timer, held so a wake can cancel the wait instead of racing it. */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// --- Replay state ---
// One DeliveryFilter per delivery channel: it decides what to hand the main thread, and holds the
// cursor we give the server in Resume so it can re-send anything we missed. They live for the
// worker's lifetime — a dropped connection or a new call keeps the same worker, so they survive; a
// full teardown (terminate) intentionally resets them.
const userDelivery = new DeliveryFilter();
const spaceDelivery = new Map<string, DeliveryFilter>();

function deliveryFor(spaceId: string): DeliveryFilter {
  let filter = spaceDelivery.get(spaceId);
  if (!filter) spaceDelivery.set(spaceId, (filter = new DeliveryFilter()));
  return filter;
}

function spaceCursors(): RealtimeCursor[] {
  const cursors: RealtimeCursor[] = [];
  for (const [spaceId, filter] of spaceDelivery)
    if (filter.cursor) cursors.push({ spaceId, entryId: filter.cursor });
  return cursors;
}

// Channel delivery groups this client wants to be in. A fresh server-side session knows none of
// them, so all of these are re-joined on every Welcome. Updated by subscribeChannel/unsubscribeChannel.
const subscribedChannels = new Set<string>();

function connect(options: ConnectOptions) {
  shouldReconnect = true;
  currentConnect = options;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  markDisconnected();
  endCall();

  // Held until the Welcome: nothing is sent to a session that has not said it is fresh.
  const current: Call = { controller: new AbortController(), commands: new CommandQueue({ held: true }) };
  call = current;
  self.postMessage({ type: "state", state: "connecting" });
  void run(current, options);
}

async function run(current: Call, options: ConnectOptions) {
  const onReconnecting = (attempt: number, delay: number) => {
    if (current === call) onStreamReconnecting(current, attempt, delay);
  };
  const onReconnected = (_attempt: number, resumed: boolean) => {
    // A session started afresh announces itself with Welcome, which is where that case is handled.
    if (current === call && resumed) onStreamResumed(current);
  };
  IonWsClient.on("reconnecting", onReconnecting);
  IonWsClient.on("reconnected", onReconnected);

  let failure: unknown = null;
  try {
    const client = createClient(options.endpoint, [ticketInterceptor], {
      sessionId: options.sessionId,
      streamOptions: realtimeStreamOptions(options.webTransport),
      signal: current.controller.signal,
    });
    for await (const frame of client.EventBus.Realtime(current.commands)) {
      if (current !== call) return;
      try {
        onFrame(current, frame);
      } catch (e: any) {
        postLog("error", `Error processing a ${frame.UnionKey} frame`, e?.message);
      }
    }
  } catch (e) {
    failure = e;
  } finally {
    IonWsClient.off("reconnecting", onReconnecting);
    IonWsClient.off("reconnected", onReconnected);
  }

  if (current !== call) return;
  call = null;
  onCallEnded(failure);
}

function onFrame(current: Call, frame: IRealtimeFrame) {
  if (frame.isWelcome()) {
    onWelcome(current, frame.connectionId);
  } else if (frame.isForSelf()) {
    // Skip duplicates (a replayed event that also arrived live), but nothing else — an event that
    // simply arrives late still has to be shown.
    if (frame.entryId && !userDelivery.accept(frame.entryId)) return;
    forward("forSelf", frame.payload);
  } else if (frame.isForSpace()) {
    if (frame.entryId && !deliveryFor(frame.spaceId).accept(frame.entryId)) return;
    forward("forSpace", frame.payload);
  } else if (frame.isForChannel()) {
    // Channel-scoped content (messages/typing/reactions) for the channel(s) we've joined. No replay
    // cursor: missed messages are recovered by the chat's own history load; typing is ephemeral and
    // reactions load with their message.
    forward("forChannel", frame.payload);
  } else if (frame.isResumed()) {
    if (frame.needFullResync) {
      postLog("warn", "Resume reported a gap — full resync required");
      self.postMessage({ type: "needFullResync" });
    } else {
      postLog("info", "Resume completed, missed events replayed");
    }
  } else if (frame.isSessionRevoked()) {
    // Sent before the server closes the stream of a session that was signed out — from another
    // device, by a password change, by the periodic sweep. The argument is a reason code, not text;
    // the main thread translates it and signs this device out.
    const reason = frame.reason.length > 0 ? frame.reason : "session_ended";
    self.postMessage({ type: "sessionRevoked", reason });
    stopForSessionEnd(`the server ended this session (${reason})`);
  }
}

// TODO(open unions): frames will carry a typed ArgonEvent once Ion unions are open (see RealtimeFrame
// in ion/ChannelInteraction.ion); the worker then re-encodes it here, since prototypes do not survive postMessage.
function forward(channel: "forSelf" | "forSpace" | "forChannel", payload: Uint8Array) {
  const whole = payload.byteOffset === 0 && payload.byteLength === payload.buffer.byteLength;
  const data = (whole ? payload.buffer : payload.slice().buffer) as ArrayBuffer;
  self.postMessage({ type: "event", channel, data }, { transfer: [data] });
}

/**
 * A fresh server-side session: the first connect, a new call, or a drop the session did not survive.
 * It knows nothing of this client, so pull what was missed since the cursors, re-join the channels
 * and say what the status is — the server starts a session statusless.
 */
function onWelcome(current: Call, connectionId: string) {
  markConnected();
  postLog("info", "Realtime session started", connectionId);
  self.postMessage({ type: "state", state: "connected" });

  const cursors = spaceCursors();
  if (userDelivery.cursor !== null || cursors.length > 0)
    current.commands.push(new Resume(userDelivery.cursor, cursors));

  for (const channelId of subscribedChannels) current.commands.push(new SubscribeToChannel(channelId));

  current.commands.release();
  startHeartbeat();
}

function onStreamReconnecting(current: Call, attempt: number, delay: number) {
  current.commands.hold();
  markDisconnected();
  postLog("warn", `Realtime connection lost, attempt ${attempt} in ${delay} ms`);
  self.postMessage({ type: "state", state: "reconnecting" });
  // `attempt` counts from 1; what the app shows and measures is the attempts before this one.
  self.postMessage({ type: "reconnectInfo", attemptCount: attempt - 1, nextAttemptAt: Date.now() + delay });
}

/** Ion resumed the session: nothing was lost and the server-side state is intact. */
function onStreamResumed(current: Call) {
  current.commands.release();
  markConnected();
  postLog("info", "Realtime connection resumed");
  self.postMessage({ type: "state", state: "connected", resumed: true });
  // Renews the session's liveness at once rather than a tick after the gap.
  sendHeartbeatNow();
}

function onCallEnded(failure: unknown) {
  const uptimeMs = markDisconnected();
  stopHeartbeat();

  if (failure instanceof SessionEndedError) {
    stopForSessionEnd(failure.message);
    return;
  }
  if (failure instanceof IonRequestException && failure.error?.code === "SESSION_REVOKED") {
    self.postMessage({ type: "sessionRevoked", reason: SIGNED_OUT_REASON });
    stopForSessionEnd("the server refused this session");
    return;
  }

  postLog("error", "Realtime stream ended", describeEnding(failure));
  self.postMessage({ type: "state", state: "disconnected" });

  // Only a connection that stood up clears the backoff. One that died on arrival is another failed
  // attempt, and the next wait is longer than the last.
  if (uptimeMs > 0 && uptimeMs < STABLE_CONNECTION_MS)
    postLog("warn", `Connection lasted ${Math.round(uptimeMs / 1000)}s — backing off further`);

  scheduleReconnect();
}

function describeEnding(failure: unknown): string {
  if (failure === null) return "the server completed the stream";
  if (failure instanceof IonStreamClosedError)
    return `closed by the server${failure.reason ? ` (${failure.reason})` : ""}`;
  if (failure instanceof IonRequestException) return `${failure.error?.code}: ${failure.error?.message}`;
  return failure instanceof Error ? failure.message : String(failure);
}

function markConnected() {
  connected = true;
  connectedAt = Date.now();
}

/** The connection is down; returns how long it had been up, 0 when it was not up. */
function markDisconnected(): number {
  if (!connected) return 0;
  connected = false;
  const uptimeMs = Date.now() - connectedAt;
  connectedAt = 0;
  if (uptimeMs >= STABLE_CONNECTION_MS) hardReconnectAttempts = 0;
  return uptimeMs;
}

/** Ends the current call, if any, without reporting it: Ion leaves politely (CLOSE, then the socket). */
function endCall() {
  const current = call;
  if (current === null) return;
  call = null;
  current.controller.abort();
  current.commands.close();
}

/**
 * Stops for good because the session behind the stream is over. The main thread owns what happens
 * next (it is already signing the device out); a later `connect` message re-arms everything.
 */
function stopForSessionEnd(why: string) {
  postLog("warn", `Realtime connection stopped: ${why}`);
  shouldReconnect = false;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  markDisconnected();
  endCall();
  self.postMessage({ type: "state", state: "disconnected", intentional: true });
}

// Schedule a new call with capped exponential backoff + equal jitter. Without jitter, every client
// dropped by the same silo blip reconnects in synchronized waves, amplifying the outage; the backoff
// relieves a struggling silo.
function scheduleReconnect() {
  if (!shouldReconnect) return;
  const base = Math.min(1000 * Math.pow(2, hardReconnectAttempts), 30000);
  const delayMs = Math.round(base * 0.5 + Math.random() * base * 0.5);
  hardReconnectAttempts++;
  self.postMessage({
    type: "reconnectInfo",
    attemptCount: hardReconnectAttempts,
    nextAttemptAt: Date.now() + delayMs,
  });
  if (reconnectTimer !== null) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentConnect) connect(currentConnect);
  }, delayMs);
}

/**
 * The page came back from being frozen or hidden.
 *
 * A browser tab that loses focus for long enough stops being a running program: timers are throttled
 * to nothing and, once the tab is frozen outright, the socket is closed without the close ever being
 * delivered. What is left when the user returns is a connection that looks alive and a backoff that
 * was computed for a server which was struggling several hours ago. Both are stale, so the wait is
 * cancelled, the counter is cleared, and we either re-dial at once or make the live connection prove
 * itself with a heartbeat.
 */
function wake() {
  hardReconnectAttempts = 0;
  if (!currentConnect || !shouldReconnect) return;

  if (connected) {
    sendHeartbeatNow();
    return;
  }
  // A call on its way back — connecting, or in Ion's own reconnect — needs no help.
  if (call !== null) return;

  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  postLog("info", "Tab resumed, reconnecting now");
  connect(currentConnect);
}

function disconnect() {
  shouldReconnect = false;
  hardReconnectAttempts = 0;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  stopHeartbeat();
  // A close we asked for (logout, account switch, an explicit retry) is not a fault and must not
  // raise the reconnect UI on the way out. Reported only when there was a live connection to close.
  const wasConnected = connected;
  markDisconnected();
  endCall();
  if (wasConnected) self.postMessage({ type: "state", state: "disconnected", intentional: true });
}

// --- Heartbeat ---
// Ask the main thread for the current status and push it to the server now. The server starts a
// fresh session statusless and only learns the real status from a heartbeat, so firing one
// immediately — instead of waiting up to a full interval — collapses the window where a DnD/Away
// user briefly looks Online to everyone after connecting.
function sendHeartbeatNow() {
  if (connected) self.postMessage({ type: "heartbeatRequest" });
}

function startHeartbeat() {
  stopHeartbeat();
  sendHeartbeatNow();
  heartbeatInterval = setInterval(sendHeartbeatNow, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval !== null) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/** Only the latest status means anything: while the stream is down one heartbeat waits, not a pile. */
function pushHeartbeat(status: UserStatus) {
  call?.commands.pushLatest(new Heartbeat(status), (queued) => queued.isHeartbeat());
}

/** Commands that only mean something now; dropped rather than delivered late. */
function sendIfConnected(command: IRealtimeCommand) {
  if (connected) call?.commands.push(command);
}

function invoke(method: string, args: any[]) {
  switch (method) {
    case "Heartbeat":
      pushHeartbeat(args[0]);
      break;
    case "GoOffline":
      sendIfConnected(new GoOffline());
      break;
    case "Typing":
      sendIfConnected(new Typing(args[0], args[1]));
      break;
    case "StopTyping":
      sendIfConnected(new StopTyping(args[0], args[1]));
      break;
    default:
      postLog("warn", `Unknown realtime command ${method}`);
  }
}

// --- Message handler ---
self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  switch (msg.type) {
    case "connect":
      connect({ endpoint: msg.endpoint, sessionId: msg.sessionId, webTransport: msg.webTransport });
      break;
    case "disconnect":
      disconnect();
      break;
    case "wake":
      wake();
      break;
    // Queued even while the stream is down: a resumed session still has the subscriptions it had,
    // so a change made during the gap has to reach it. A fresh one is re-joined on Welcome.
    case "subscribeChannel":
      if (!subscribedChannels.has(msg.channelId)) {
        subscribedChannels.add(msg.channelId);
        call?.commands.push(new SubscribeToChannel(msg.channelId));
      }
      break;
    case "unsubscribeChannel":
      if (subscribedChannels.delete(msg.channelId))
        call?.commands.push(new UnsubscribeFromChannel(msg.channelId));
      break;
    case "ticketResponse":
      pendingTickets.get(msg.requestId)?.(msg);
      break;
    case "invoke":
      invoke(msg.method, msg.args ?? []);
      break;
    case "heartbeatInvoke":
      pushHeartbeat(msg.status);
      break;
  }
};
