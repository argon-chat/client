/**
 * When the worker asks the app what status to report, and what reaches the stream.
 *
 * The heartbeat is the only channel through which the server ever learns this client's real status:
 * a fresh server-side session starts with no preferred status and stays that way until a heartbeat
 * says otherwise. That makes the timing of the FIRST heartbeat a presence-visible property, not an
 * implementation detail — every millisecond between the session coming up and that message landing
 * is time a Do-Not-Disturb user is broadcast as Online to their spaces and their friends.
 *
 * The cadence pinned here is also what makes the `busStore` fallback matter: the first heartbeat is
 * asked for the instant the session is up, which on a cold start is *before* `meStore.init()` has
 * fetched the profile. See `test/store/busHeartbeatStatus.test.ts` for what the app answers in that
 * window.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import type { Heartbeat, Typing } from "@argon/glue";
import {
  connectFresh,
  host,
  posted,
  send,
  settle,
  sockets,
  startWorker,
  stopWorker,
  welcome,
} from "./realtimeHarness";

const SPACE = "0b7a1c9e-4c6f-4d7e-9a51-3f1d2c3b4a5e";
const CHANNEL = "2d9c3eb0-6e81-4f90-9c73-513f4e5d6c70";

/** `UserStatus.DoNotDisturb` and friends, as plain numbers: the worker only forwards them. */
const DND = 6;

const heartbeatRequests = () => posted("heartbeatRequest");
const heartbeats = (ws = sockets.at(-1)!) =>
  ws.commands().filter((c) => c.isHeartbeat()).map((c) => (c as Heartbeat).status);

beforeEach(startWorker);
afterEach(stopWorker);

describe("realtime worker heartbeat", () => {
  test("asks for a status the moment the session starts, not a tick later", async () => {
    await connectFresh();

    // Nothing has been allowed to elapse beyond the connect itself.
    expect(heartbeatRequests()).toHaveLength(1);
  });

  test("keeps asking every 15 seconds", async () => {
    await connectFresh();
    host.posted.length = 0;

    await vi.advanceTimersByTimeAsync(15_000);
    expect(heartbeatRequests()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(45_000);
    expect(heartbeatRequests()).toHaveLength(4);
  });

  test("the status the app answers with is what reaches the stream", async () => {
    await connectFresh();

    await send({ type: "heartbeatInvoke", status: DND });

    expect(heartbeats()).toEqual([DND]);
  });

  test("a status pushed by the app goes out as the same Heartbeat", async () => {
    await connectFresh();

    await send({ type: "invoke", method: "Heartbeat", args: [DND] });

    expect(heartbeats()).toEqual([DND]);
  });

  test("a fresh session after a drop re-asserts the status immediately", async () => {
    const ws = await connectFresh();
    ws.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    host.posted.length = 0;

    // The server kept nothing (the session was not resumable), so the new one starts statusless; a
    // full interval of silence here is a full interval of everyone seeing the wrong status.
    await welcome(sockets[1]);

    expect(heartbeatRequests()).toHaveLength(1);
  });

  test("a resumed connection renews the status at once as well", async () => {
    const ws = await connectFresh({ resumeToken: "tok" });
    ws.drop();
    await vi.advanceTimersByTimeAsync(1_000);
    host.posted.length = 0;

    sockets[1].accept().resumed(ws.commands().length);
    await settle();

    expect(heartbeatRequests()).toHaveLength(1);
  });

  test("a dropped connection stops asking into the void", async () => {
    const ws = await connectFresh();
    ws.drop();
    await settle();
    host.posted.length = 0;

    // The server never takes the connection back: Ion keeps trying, the worker keeps quiet.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(heartbeatRequests()).toHaveLength(0);
  });

  test("a connection closed on purpose does not keep a heartbeat running behind it", async () => {
    await connectFresh();
    await send({ type: "disconnect" });
    host.posted.length = 0;

    // Logout / account switch: no reconnect is coming, so nothing may keep ticking.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(heartbeatRequests()).toHaveLength(0);
    expect(sockets).toHaveLength(1);
  });

  test("status answers that arrive while the stream is down wait as one heartbeat, the latest", async () => {
    const ws = await connectFresh({ resumeToken: "tok" });
    ws.drop();
    await settle();

    await send({ type: "heartbeatInvoke", status: 1 });
    await send({ type: "heartbeatInvoke", status: 3 });
    await send({ type: "heartbeatInvoke", status: DND });

    await vi.advanceTimersByTimeAsync(1_000);
    const back = sockets[1];
    back.accept().resumed(ws.commands().length);
    await settle();

    expect(heartbeats(back)).toEqual([DND]);
  });

  test("going offline on purpose is sent to the stream", async () => {
    await connectFresh();

    await send({ type: "invoke", method: "GoOffline", args: [] });

    expect(sockets[0].commandKeys()).toContain("GoOffline");
  });

  test("typing goes out with its space and channel", async () => {
    await connectFresh();

    await send({ type: "invoke", method: "Typing", args: [SPACE, CHANNEL] });
    await send({ type: "invoke", method: "StopTyping", args: [SPACE, CHANNEL] });

    const commands = sockets[0].commands();
    expect(commands.map((c) => c.UnionKey)).toEqual(["Typing", "StopTyping"]);
    expect({ ...(commands[0] as Typing) }).toMatchObject({ spaceId: SPACE, channelId: CHANNEL });
  });

  test("typing while the stream is down is dropped, not delivered late", async () => {
    const ws = await connectFresh({ resumeToken: "tok" });
    ws.drop();
    await settle();

    await send({ type: "invoke", method: "Typing", args: [SPACE, CHANNEL] });
    await vi.advanceTimersByTimeAsync(1_000);
    const back = sockets[1];
    back.accept().resumed(ws.commands().length);
    await settle();

    expect(back.commandKeys()).not.toContain("Typing");
  });
});
