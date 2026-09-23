/**
 * The realtime worker's connection lifecycle over the Ion stream: who reconnects when, what a
 * resumed session is spared, what a fresh one is re-told, and when the worker stops for good.
 *
 * Two layers can reconnect here — Ion within a call, the worker by starting a new call — and the
 * failures that matter are the ones where both do, or neither does: two sockets, a reconnect banner
 * over a session that never dropped, or a signed-out device asking for tickets forever. None of
 * them throws, which is why they are pinned here rather than left to be noticed.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ForChannel,
  ForSelf,
  ForSpace,
  Resumed,
  SessionRevoked,
  type Resume,
  type SubscribeToChannel,
} from "@argon/glue";
import {
  connectFresh,
  host,
  payload,
  posted,
  send,
  settle,
  sockets,
  startWorker,
  states,
  stopWorker,
  welcome,
} from "./realtimeHarness";

const SPACE_A = "0b7a1c9e-4c6f-4d7e-9a51-3f1d2c3b4a5e";
const SPACE_B = "1c8b2daf-5d70-4e8f-8b62-402e3d4c5b6f";
const CHANNEL = "2d9c3eb0-6e81-4f90-9c73-513f4e5d6c70";

beforeEach(startWorker);
afterEach(stopWorker);

describe("realtime worker connection", () => {
  test("opens the realtime stream with the app's session id and a ticket from the main thread", async () => {
    await send({ type: "connect", endpoint: "https://api.test", sessionId: "sid-1" });

    expect(host.ticketRequests).toBe(1);
    const ws = sockets[0];
    expect(ws.url).toMatch(/^wss:\/\/api\.test\/ion\/IEventBus\/Realtime\.ws\?/);
    expect(new URL(ws.url).searchParams.get("sid")).toBe("sid-1");
    expect(ws.protocols[0]).toMatch(/^ion!ticket#.+!ver#2$/);

    await welcome(ws);
    expect(states()).toEqual([{ state: "connecting" }, { state: "connected" }]);
  });

  test("ignores the ending of a call that has already been replaced", async () => {
    const first = await connectFresh();

    // What `retryConnectionNow` does: drop the call and immediately dial again.
    await send({ type: "disconnect" });
    await send({ type: "connect", endpoint: "https://api.test" });
    await welcome(sockets[1]);
    expect(sockets).toHaveLength(2);

    host.posted.length = 0;
    first.drop();
    await settle();

    // The live call must not be reported as lost, and nothing may be queued on top of it.
    expect(states()).toHaveLength(0);
    expect(posted("reconnectInfo")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(2);
  });

  test("a dropped connection is left to Ion's reconnect, not doubled by a second call", async () => {
    const ws = await connectFresh();
    host.posted.length = 0;

    ws.drop();
    await settle();

    expect(states()).toEqual([{ state: "reconnecting" }]);
    // Ion counts attempts from 1; the app is told the attempts before this one.
    expect(posted("reconnectInfo")).toEqual([
      expect.objectContaining({ type: "reconnectInfo", attemptCount: 0 }),
    ]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    expect(host.ticketRequests).toBe(2);
  });

  test("starts a new call, with a backoff, when the server ends the stream", async () => {
    const ws = await connectFresh();
    host.posted.length = 0;

    ws.fail("INTERNAL", "the stream method threw");
    await settle();

    expect(states()).toEqual([{ state: "disconnected" }]);
    expect(posted("reconnectInfo")).toEqual([
      expect.objectContaining({ type: "reconnectInfo", attemptCount: 1 }),
    ]);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
  });

  test("a CLOSE that does not invite a reconnect is a server-side end, backed off like one", async () => {
    const ws = await connectFresh();
    host.posted.length = 0;

    ws.closeStream("draining", false);
    await settle();

    expect(states()).toEqual([{ state: "disconnected" }]);
    expect(posted("reconnectInfo")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
  });

  test("a call that dies on arrival backs off further every time", async () => {
    const delays: number[] = [];
    let ws = await connectFresh();
    for (let i = 0; i < 3; i++) {
      host.posted.length = 0;
      ws.fail("INTERNAL", "silo not ready");
      await settle();
      const delay = posted("reconnectInfo")[0].nextAttemptAt - Date.now();
      delays.push(delay);

      await vi.advanceTimersByTimeAsync(delay);
      await settle();
      ws = sockets.at(-1)!;
      await welcome(ws);
    }
    expect(sockets).toHaveLength(4);

    // Equal jitter over 1 s, 2 s, 4 s: each wait is at least the half of its bound.
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[1]).toBeGreaterThanOrEqual(1_000);
    expect(delays[2]).toBeGreaterThanOrEqual(2_000);
  });

  test("reports a close we asked for as intentional", async () => {
    await connectFresh();
    host.posted.length = 0;

    await send({ type: "disconnect" });

    expect(states()).toEqual([{ state: "disconnected", intentional: true }]);
    expect(posted("reconnectInfo")).toHaveLength(0);
  });

  test("a disconnect with nothing connected reports nothing", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    host.posted.length = 0;

    await send({ type: "disconnect" });

    expect(states()).toEqual([]);
  });
});

describe("resume", () => {
  test("a lossless resume reports connected without a Resume or re-subscribing", async () => {
    const ws = await connectFresh({ resumeToken: "tok" });
    await send({ type: "subscribeChannel", channelId: CHANNEL });
    host.posted.length = 0;

    ws.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    const back = sockets[1].accept();
    expect(back.resuming).toBe(true);
    back.resumed(ws.commands().length);
    await settle();

    expect(states()).toEqual([{ state: "reconnecting" }, { state: "connected", resumed: true }]);
    expect(back.commandKeys()).not.toContain("Resume");
    expect(back.commandKeys()).not.toContain("SubscribeToChannel");
    expect(posted("needFullResync")).toHaveLength(0);
  });

  test("a session that could not be resumed is re-told the cursors, the channels and the status", async () => {
    const ws = await connectFresh({ resumeToken: "tok" });
    await send({ type: "subscribeChannel", channelId: CHANNEL });
    ws.push(new ForSelf(payload(1), "100-0"));
    ws.push(new ForSpace(payload(2), SPACE_A, "200-3"));
    await settle();
    host.posted.length = 0;

    ws.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    // The server restarted: the session is gone, so Ion starts the call afresh.
    const attempt = sockets[1].accept();
    expect(attempt.resuming).toBe(true);
    attempt.fail("STREAM_NOT_RESUMABLE", "no such session");
    await settle();
    const fresh = sockets[2];
    await welcome(fresh);
    expect(fresh.resuming).toBe(false);

    const commands = fresh.commands();
    const resume = commands.find((c) => c.isResume()) as Resume;
    expect(resume.userCursor).toBe("100-0");
    expect(resume.spaceCursors).toEqual([{ spaceId: SPACE_A, entryId: "200-3" }]);
    const subscribe = commands.find((c) => c.isSubscribeToChannel()) as SubscribeToChannel;
    expect(subscribe.channelId).toBe(CHANNEL);
    expect(states().at(-1)).toEqual({ state: "connected" });
    expect(posted("heartbeatRequest")).toHaveLength(1);
  });

  test("the very first session sends no Resume: there is nothing to resume from", async () => {
    const ws = await connectFresh();

    expect(ws.commandKeys()).not.toContain("Resume");
  });

  test("a Resume the server could not honour in full asks the app for a full resync", async () => {
    const ws = await connectFresh();

    ws.push(new Resumed(false));
    await settle();
    expect(posted("needFullResync")).toHaveLength(0);

    ws.push(new Resumed(true));
    await settle();
    expect(posted("needFullResync")).toHaveLength(1);
  });
});

describe("delivery", () => {
  test("forwards each event once, as the payload bytes it arrived in", async () => {
    const ws = await connectFresh();

    ws.push(new ForSelf(payload(1, 2, 3), "100-0"));
    // A replayed event that also arrived live.
    ws.push(new ForSelf(payload(1, 2, 3), "100-0"));
    await settle();

    const events = posted("event");
    expect(events).toHaveLength(1);
    expect(events[0].channel).toBe("forSelf");
    expect(events[0].data).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(events[0].data)]).toEqual([1, 2, 3]);
  });

  test("filters duplicates per space: the same entry id in two spaces is two events", async () => {
    const ws = await connectFresh();

    ws.push(new ForSpace(payload(1), SPACE_A, "100-0"));
    ws.push(new ForSpace(payload(2), SPACE_B, "100-0"));
    ws.push(new ForSpace(payload(1), SPACE_A, "100-0"));
    await settle();

    expect(posted("event").map((e) => [...new Uint8Array(e.data)])).toEqual([[1], [2]]);
  });

  test("channel content has no cursor and is always delivered", async () => {
    const ws = await connectFresh();

    ws.push(new ForChannel(payload(7), CHANNEL));
    ws.push(new ForChannel(payload(7), CHANNEL));
    await settle();

    expect(posted("event").map((e) => e.channel)).toEqual(["forChannel", "forChannel"]);
  });
});

describe("session end", () => {
  test("a revoked session signs the device out and nothing reconnects", async () => {
    const ws = await connectFresh();
    host.posted.length = 0;

    ws.push(new SessionRevoked("session_signed_out"));
    ws.closeStream("session revoked", false);
    await settle();

    expect(posted("sessionRevoked")).toEqual([{ type: "sessionRevoked", reason: "session_signed_out" }]);
    expect(states()).toEqual([{ state: "disconnected", intentional: true }]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    expect(host.ticketRequests).toBe(1);
  });

  test("a connect refused as SESSION_REVOKED is the same sign-out", async () => {
    await send({ type: "connect", endpoint: "https://api.test" });
    sockets[0].accept().ready().fail("SESSION_REVOKED", "this session has been signed out");
    await settle();

    expect(posted("sessionRevoked")).toEqual([{ type: "sessionRevoked", reason: "session_signed_out" }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  test("a ticket refused because the session is over stops for good", async () => {
    host.ticketMode = "fatal";
    await send({ type: "connect", endpoint: "https://api.test" });

    expect(states()).toEqual([{ state: "connecting" }, { state: "disconnected", intentional: true }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(host.ticketRequests).toBe(1);
    expect(sockets).toHaveLength(0);
  });

  test("a refused ticket the main thread recovered from is retried by a new call, backed off", async () => {
    host.ticketMode = "refused";
    await send({ type: "connect", endpoint: "https://api.test" });

    expect(states()).toEqual([{ state: "connecting" }, { state: "disconnected" }]);
    expect(posted("reconnectInfo")).toEqual([expect.objectContaining({ attemptCount: 1 })]);
    expect(sockets).toHaveLength(0);

    host.ticketMode = "ok";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(1);
  });

  test("a ticket that failed on the network is retried within the call", async () => {
    host.ticketMode = "network";
    await send({ type: "connect", endpoint: "https://api.test" });

    expect(states()).toEqual([{ state: "connecting" }, { state: "reconnecting" }]);
    expect(posted("reconnectInfo")).toEqual([expect.objectContaining({ attemptCount: 0 })]);

    host.ticketMode = "ok";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(1);
  });

  test("a ticket request the main thread never answers times out and is retried", async () => {
    host.ticketMode = "silent";
    await send({ type: "connect", endpoint: "https://api.test" });
    expect(sockets).toHaveLength(0);

    host.ticketMode = "ok";
    await vi.advanceTimersByTimeAsync(11_000);
    expect(host.ticketRequests).toBe(2);
    expect(sockets).toHaveLength(1);
  });
});

describe("wake", () => {
  test("re-dials at once instead of waiting out a stale backoff", async () => {
    host.ticketMode = "refused";
    await send({ type: "connect", endpoint: "https://api.test" });
    expect(sockets).toHaveLength(0);

    host.ticketMode = "ok";
    await send({ type: "wake" });

    expect(sockets).toHaveLength(1);
  });

  test("leaves a live connection alone and makes it prove itself with a heartbeat", async () => {
    await connectFresh();
    host.posted.length = 0;

    await send({ type: "wake" });

    expect(sockets).toHaveLength(1);
    expect(posted("heartbeatRequest")).toHaveLength(1);
  });
});
