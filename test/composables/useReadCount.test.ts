/**
 * "Read by N" is fetched lazily, in batches, and cached briefly. The posts asked about within
 * 300 ms go out as one GetReadCounts call per channel (at most 50 ids a call) instead of one call
 * per post; nothing is asked again inside the TTL; a post the answer leaves out (too few members,
 * no permission…) is remembered as having no count; a failed call keeps the last answer; a session
 * reset forgets everything.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ getMany: vi.fn() }));

vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ channelInsightsInteraction: { GetReadCounts: h.getMany } }),
}));

import {
  READ_COUNT_BATCH_MAX,
  READ_COUNT_BATCH_MS,
  READ_COUNT_TTL_MS,
  canSeeReadCount,
  clearReadCountCache,
  fetchReadCount,
  peekReadCount,
} from "@/composables/useReadCount";
import { runSessionReset } from "@/store/system/sessionLifecycle";

let clock = 1_000_000;
const now = () => clock;

const entry = (messageId: bigint, readers: number, members = 10) => ({ messageId, readers, members });

/** The server: counts for the ids it is asked about, from a table. */
function serverCounting(table: Record<string, [number, number]>) {
  h.getMany.mockImplementation(async (_s: string, _c: string, ids: bigint[]) =>
    ids.filter((id) => table[String(id)]).map((id) => entry(id, ...table[String(id)])),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  clearReadCountCache();
  h.getMany.mockReset();
  clock = 1_000_000;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchReadCount", () => {
  test("the posts asked about within the window go out as one call", async () => {
    serverCounting({ "1": [3, 10], "2": [4, 10], "3": [5, 10] });

    const all = Promise.all([1n, 2n, 3n].map((id) => fetchReadCount("s1", "c1", id, now)));
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS - 1);
    expect(h.getMany).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await all).toEqual([
      { readers: 3, members: 10 },
      { readers: 4, members: 10 },
      { readers: 5, members: 10 },
    ]);
    expect(h.getMany).toHaveBeenCalledTimes(1);
    expect(h.getMany).toHaveBeenCalledWith("s1", "c1", [1n, 2n, 3n]);
  });

  test(`more than ${READ_COUNT_BATCH_MAX} posts are split into calls of at most ${READ_COUNT_BATCH_MAX}`, async () => {
    h.getMany.mockImplementation(async (_s: string, _c: string, ids: bigint[]) => ids.map((id) => entry(id, 1)));

    const ids = Array.from({ length: READ_COUNT_BATCH_MAX + 5 }, (_, i) => BigInt(i + 1));
    const all = Promise.all(ids.map((id) => fetchReadCount("s1", "c1", id, now)));
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);
    await all;

    expect(h.getMany.mock.calls.map((c) => c[2].length)).toEqual([READ_COUNT_BATCH_MAX, 5]);
  });

  test("channels are asked about apart", async () => {
    serverCounting({ "1": [1, 5], "2": [2, 5] });

    const a = fetchReadCount("s1", "c1", 1n, now);
    const b = fetchReadCount("s1", "c2", 2n, now);
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);
    await Promise.all([a, b]);

    expect(h.getMany.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["c1", [1n]],
      ["c2", [2n]],
    ]);
    expect(peekReadCount("c2", 1n)).toBeUndefined();
  });

  test("rows asking about the same post at once share it, and the cache serves it for a minute", async () => {
    serverCounting({ "5": [3, 10] });

    const a = fetchReadCount("s1", "c1", 5n, now);
    const b = fetchReadCount("s1", "c1", 5n, now);
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);
    expect(await a).toEqual({ readers: 3, members: 10 });
    expect(await b).toEqual({ readers: 3, members: 10 });
    expect(h.getMany).toHaveBeenCalledWith("s1", "c1", [5n]);

    expect(READ_COUNT_TTL_MS).toBe(60_000);
    clock += READ_COUNT_TTL_MS - 1;
    expect(await fetchReadCount("s1", "c1", 5n, now)).toEqual({ readers: 3, members: 10 });
    expect(h.getMany).toHaveBeenCalledTimes(1);
    expect(peekReadCount("c1", 5n)).toEqual({ readers: 3, members: 10 });
  });

  test("asks again once the TTL has passed", async () => {
    h.getMany.mockResolvedValueOnce([entry(9n, 1, 5)]).mockResolvedValueOnce([entry(9n, 4, 5)]);

    const first = fetchReadCount("s1", "c1", 9n, now);
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);
    await first;
    clock += READ_COUNT_TTL_MS;

    const second = fetchReadCount("s1", "c1", 9n, now);
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);
    expect(await second).toEqual({ readers: 4, members: 5 });
    expect(h.getMany).toHaveBeenCalledTimes(2);
  });

  test("a post the answer leaves out has no count, and is not asked about again inside the TTL", async () => {
    // TOO_FEW_MEMBERS, no permission, gone: the server simply leaves the post out.
    serverCounting({ "1": [2, 10] });

    const both = Promise.all([fetchReadCount("s1", "c1", 1n, now), fetchReadCount("s1", "c1", 11n, now)]);
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);

    expect(await both).toEqual([{ readers: 2, members: 10 }, null]);
    expect(peekReadCount("c1", 11n)).toBeNull();
    expect(await fetchReadCount("s1", "c1", 11n, now)).toBeNull();
    expect(h.getMany).toHaveBeenCalledTimes(1);
  });

  test("a failed call keeps the last answer", async () => {
    h.getMany.mockResolvedValueOnce([entry(13n, 2, 3)]).mockRejectedValueOnce(new Error("offline"));

    const first = fetchReadCount("s1", "c1", 13n, now);
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);
    await first;
    clock += READ_COUNT_TTL_MS;

    const second = fetchReadCount("s1", "c1", 13n, now);
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);
    expect(await second).toEqual({ readers: 2, members: 3 });
  });

  test("an account switch forgets the counts and drops the batch still waiting", async () => {
    serverCounting({ "1": [2, 10], "2": [3, 10] });
    const first = fetchReadCount("s1", "c1", 1n, now);
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);
    await first;

    const waiting = fetchReadCount("s1", "c1", 2n, now);
    await runSessionReset();
    await vi.advanceTimersByTimeAsync(READ_COUNT_BATCH_MS);

    expect(await waiting).toBeNull();
    expect(peekReadCount("c1", 1n)).toBeUndefined();
    expect(peekReadCount("c1", 2n)).toBeUndefined();
    expect(h.getMany).toHaveBeenCalledTimes(1);
  });
});

describe("canSeeReadCount", () => {
  test("the author and moderators, never for a message still sending", () => {
    const mine = { sender: "me" };
    const theirs = { sender: "them" };

    expect(canSeeReadCount(mine, "me", false)).toBe(true);
    expect(canSeeReadCount(theirs, "me", false)).toBe(false);
    expect(canSeeReadCount(theirs, "me", true)).toBe(true);
    expect(canSeeReadCount({ sender: "me", _optimistic: true }, "me", true)).toBe(false);
    expect(canSeeReadCount({ sender: "me", _failed: true }, "me", false)).toBe(false);
    expect(canSeeReadCount(mine, null, false)).toBe(false);
  });
});
