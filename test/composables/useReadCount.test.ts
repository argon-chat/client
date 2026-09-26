/**
 * "Read by N" is fetched lazily and cached briefly: one request per message however many rows ask
 * at once, none again inside the TTL, a refusal remembered like an answer, and a fresh request once
 * the TTL has passed.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@argon/core", () => ({ logger: { warn() {}, info() {}, error() {} } }));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ channelInsightsInteraction: { GetReadCount: h.get } }),
}));

import { FailedReadCount, ReadCountError, SuccessReadCount } from "@argon/glue";
import {
  READ_COUNT_TTL_MS,
  canSeeReadCount,
  clearReadCountCache,
  fetchReadCount,
  peekReadCount,
} from "@/composables/useReadCount";

let clock = 1_000_000;
const now = () => clock;

beforeEach(() => {
  clearReadCountCache();
  h.get.mockReset();
  clock = 1_000_000;
});

describe("fetchReadCount", () => {
  test("asks once and serves the cache inside the TTL", async () => {
    h.get.mockResolvedValue(new SuccessReadCount(3, 10));

    expect(await fetchReadCount("s1", "c1", 5n, now)).toEqual({ readers: 3, members: 10 });
    clock += READ_COUNT_TTL_MS - 1;
    expect(await fetchReadCount("s1", "c1", 5n, now)).toEqual({ readers: 3, members: 10 });

    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.get).toHaveBeenCalledWith("s1", "c1", 5n);
    expect(peekReadCount("c1", 5n)).toEqual({ readers: 3, members: 10 });
  });

  test("rows asking at the same time share one request", async () => {
    let answer!: (v: unknown) => void;
    h.get.mockReturnValue(new Promise((r) => (answer = r)));

    const a = fetchReadCount("s1", "c1", 7n, now);
    const b = fetchReadCount("s1", "c1", 7n, now);
    answer(new SuccessReadCount(1, 2));

    expect(await a).toEqual({ readers: 1, members: 2 });
    expect(await b).toEqual({ readers: 1, members: 2 });
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  test("asks again once the TTL has passed", async () => {
    h.get.mockResolvedValueOnce(new SuccessReadCount(1, 5)).mockResolvedValueOnce(new SuccessReadCount(4, 5));

    await fetchReadCount("s1", "c1", 9n, now);
    clock += READ_COUNT_TTL_MS;

    expect(await fetchReadCount("s1", "c1", 9n, now)).toEqual({ readers: 4, members: 5 });
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  test("a refusal is cached as null and not asked again inside the TTL", async () => {
    h.get.mockResolvedValue(new FailedReadCount(ReadCountError.INSUFFICIENT_PERMISSIONS));

    expect(await fetchReadCount("s1", "c1", 11n, now)).toBeNull();
    expect(await fetchReadCount("s1", "c1", 11n, now)).toBeNull();
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  test("a failed refresh keeps the last answer", async () => {
    h.get.mockResolvedValueOnce(new SuccessReadCount(2, 3)).mockRejectedValueOnce(new Error("offline"));

    await fetchReadCount("s1", "c1", 13n, now);
    clock += READ_COUNT_TTL_MS;

    expect(await fetchReadCount("s1", "c1", 13n, now)).toEqual({ readers: 2, members: 3 });
  });

  test("messages are cached apart", async () => {
    h.get.mockResolvedValueOnce(new SuccessReadCount(1, 9)).mockResolvedValueOnce(new SuccessReadCount(2, 9));

    expect(await fetchReadCount("s1", "c1", 1n, now)).toEqual({ readers: 1, members: 9 });
    expect(await fetchReadCount("s1", "c1", 2n, now)).toEqual({ readers: 2, members: 9 });
    expect(peekReadCount("c2", 1n)).toBeUndefined();
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
