/**
 * The realtime stream's input: what the stream's pump is handed, and when.
 *
 * The case worth pinning is the held queue. Ion's pump asks for the next command as soon as it has
 * sent the last, so it is already waiting when a connection drops; anything handed to it then is
 * held by Ion and sent on the next connection, beyond the reach of any coalescing. Holding the queue
 * over the gap is what keeps a flapping connection from turning into a pile of stale heartbeats.
 */

import { describe, test, expect } from "vitest";
import { CommandQueue } from "@/workers/commandQueue";

/** What a pull that has not been answered within a turn of the event loop races to. */
const stillPending = () => new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 0));

describe("CommandQueue", () => {
  test("hands items over in order", async () => {
    const queue = new CommandQueue<number>();
    queue.push(1);
    queue.push(2);
    const it = queue[Symbol.asyncIterator]();

    expect(await it.next()).toEqual({ value: 1, done: false });
    expect(await it.next()).toEqual({ value: 2, done: false });
  });

  test("a consumer that is already waiting gets the next push", async () => {
    const queue = new CommandQueue<number>();
    const it = queue[Symbol.asyncIterator]();
    const next = it.next();

    queue.push(7);

    expect(await next).toEqual({ value: 7, done: false });
  });

  test("keeps at most one of a kind waiting, the latest", async () => {
    const queue = new CommandQueue<string>();
    const isStatus = (s: string) => s.startsWith("status:");

    queue.pushLatest("status:online", isStatus);
    queue.push("subscribe");
    queue.pushLatest("status:dnd", isStatus);

    const it = queue[Symbol.asyncIterator]();
    expect((await it.next()).value).toBe("status:dnd");
    expect((await it.next()).value).toBe("subscribe");
    expect(queue.size).toBe(0);
  });

  test("a held queue hands nothing over, even to a consumer already waiting", async () => {
    const queue = new CommandQueue<number>();
    const it = queue[Symbol.asyncIterator]();
    const next = it.next();

    queue.hold();
    queue.push(1);
    queue.push(2);

    expect(await Promise.race([next, stillPending()])).toBe("pending");
    expect(queue.size).toBe(2);

    queue.release();
    expect(await next).toEqual({ value: 1, done: false });
    expect(await it.next()).toEqual({ value: 2, done: false });
  });

  test("coalesces while held, so a gap leaves one item where it would have left many", async () => {
    const queue = new CommandQueue<string>({ held: true });
    const isStatus = (s: string) => s.startsWith("status:");
    for (const s of ["a", "b", "c"]) queue.pushLatest(`status:${s}`, isStatus);

    const it = queue[Symbol.asyncIterator]();
    const next = it.next();
    expect(await Promise.race([next, stillPending()])).toBe("pending");

    queue.release();
    expect(await next).toEqual({ value: "status:c", done: false });
    expect(queue.size).toBe(0);
  });

  test("closing ends the iteration and drops what was waiting", async () => {
    const queue = new CommandQueue<number>({ held: true });
    queue.push(1);
    const it = queue[Symbol.asyncIterator]();
    const next = it.next();

    queue.close();
    queue.push(2);

    expect(await next).toEqual({ value: undefined, done: true });
    expect(await it.next()).toEqual({ value: undefined, done: true });
    expect(queue.size).toBe(0);
  });

  test("return() from the consumer closes the queue", async () => {
    const queue = new CommandQueue<number>();
    const it = queue[Symbol.asyncIterator]();

    await it.return!();
    queue.push(1);

    expect(await it.next()).toEqual({ value: undefined, done: true });
  });
});
