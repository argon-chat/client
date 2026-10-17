/**
 * A row's status — custom status and what its member wears — read through the profile cache's
 * batched queue: asked only while wanted, dropped when the row goes, asked again when the cache says
 * what it holds for that person changed.
 */

import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  effectScope,
  nextTick,
  reactive,
  ref,
} from "vue";

const h = vi.hoisted(() => ({
  getStatus: vi.fn(),
  debug: vi.fn(),
  revisions: null as unknown as Map<string, number>,
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug: h.debug, info() {}, warn() {}, error() {} },
}));
vi.mock("@/store/data/profileCacheStore", () => ({
  useProfileCacheStore: () => ({
    getStatus: h.getStatus,
    revisionOf: (userId: string) => h.revisions.get(userId) ?? 0,
  }),
}));

import type { ProfileStatus } from "@/store/data/profileCacheStore";
import { useProfileStatus } from "@/composables/useProfileStatus";

function row(customStatus: string): ProfileStatus {
  return {
    customStatus,
    customStatusIconId: null,
    customStatusEmoji: null,
    cosmetics: null,
  };
}

async function settled() {
  await Promise.resolve();
  await nextTick();
}

beforeEach(() => {
  h.revisions = reactive(new Map<string, number>()) as Map<string, number>;
  h.getStatus.mockReset();
  h.debug.mockReset();
  h.getStatus.mockImplementation(async (_spaceId: string | null, userId: string) => row(`${userId}-status`));
});

describe("a row's status", () => {
  test("is not asked for while it is not wanted", async () => {
    const wanted = ref(false);
    const scope = effectScope();
    const status = scope.run(() => useProfileStatus("space", "alice", wanted))!;

    await settled();

    expect(h.getStatus).not.toHaveBeenCalled();
    expect(status.value).toBeNull();

    wanted.value = true;
    await settled();

    expect(h.getStatus).toHaveBeenCalledWith("space", "alice", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(status.value?.customStatus).toBe("alice-status");

    scope.stop();
  });

  test("is asked again, without blanking, when the cache changes what it holds for that person", async () => {
    const scope = effectScope();
    const status = scope.run(() => useProfileStatus("space", "alice", true))!;

    await settled();
    expect(status.value?.customStatus).toBe("alice-status");

    let answer!: (value: ProfileStatus) => void;

    h.getStatus.mockImplementationOnce(() => new Promise<ProfileStatus>(resolve => {
      answer = resolve;
    }));
    h.revisions.set("alice", 1);
    await nextTick();

    expect(h.getStatus).toHaveBeenCalledTimes(2);
    expect(status.value?.customStatus).toBe("alice-status");

    answer(row("fresh"));
    await settled();

    expect(status.value?.customStatus).toBe("fresh");

    scope.stop();
  });

  test("is not touched by somebody else's change", async () => {
    const scope = effectScope();

    scope.run(() => useProfileStatus("space", "alice", true));
    await settled();

    h.revisions.set("bob", 1);
    await settled();

    expect(h.getStatus).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  test("drops what it held when the row moves to somebody else", async () => {
    const userId = ref("alice");
    const scope = effectScope();
    const status = scope.run(() => useProfileStatus("space", userId, true))!;

    await settled();

    h.getStatus.mockImplementationOnce(() => new Promise<ProfileStatus>(() => {}));
    userId.value = "bob";
    await nextTick();

    expect(status.value).toBeNull();

    scope.stop();
  });

  test("cancels the request when the row goes away", async () => {
    let signal: AbortSignal | undefined;

    h.getStatus.mockImplementationOnce((_spaceId: string | null, _userId: string, options: { signal: AbortSignal }) => {
      signal = options.signal;

      return new Promise<ProfileStatus>(() => {});
    });

    const scope = effectScope();

    scope.run(() => useProfileStatus("space", "alice", true));
    scope.stop();

    expect(signal?.aborted).toBe(true);
  });

  test("a cancelled request is quiet, any other failure is logged", async () => {
    h.getStatus.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "AbortError" }));

    const first = effectScope();

    first.run(() => useProfileStatus("space", "alice", true));
    await settled();
    first.stop();

    expect(h.debug).not.toHaveBeenCalled();

    h.getStatus.mockRejectedValueOnce(new Error("offline"));

    const second = effectScope();

    second.run(() => useProfileStatus("space", "bob", true));
    await settled();
    second.stop();

    expect(h.debug).toHaveBeenCalledTimes(1);
  });
});
