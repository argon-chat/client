/**
 * The idle detector's authority: it may take you Away (and, an hour later, to Snooze), and it may
 * bring you back — nothing else.
 *
 * Auto-Away is the only place in the client where the app changes your presence without being
 * asked, so its boundaries are the whole feature. It may act only on a user who is plainly Online
 * and plainly idle; it must be blind to DoNotDisturb and TouchGrass, which are statements the user
 * made on purpose; and it must never "restore" an Away it did not set, because to the user that
 * reads as the app refusing to let them be Away.
 *
 * The detector is driven here through its real 15 s tick rather than by reaching into
 * `handleStatusChange`: the flag that decides whether coming back is allowed lives across ticks,
 * and every bug worth catching here is a bug in how that flag survives from one tick to the next.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { UserStatus } from "@argon/glue";

const h = vi.hoisted(() => ({
  /** What the host reports for "seconds since the last input", read fresh on every tick. */
  idleSeconds: 0,
  /** The live `me` the store reads through `useMe()`. `1` is `UserStatus.Online`; the enum is not
   * importable from a hoisted block, and the value is pinned by the assertion in the first test. */
  current: 1 as UserStatus,
  temporary: [] as UserStatus[],
  /** Makes the next host read throw, standing in for an IPC hiccup right after launch. */
  failNextIdleRead: false,
}));

vi.mock("@argon/glue/native", () => ({
  native: {
    hostProc: {
      getIdleTimeSeconds: async () => {
        if (h.failNextIdleRead) {
          h.failNextIdleRead = false;
          throw new Error("host not ready");
        }
        return h.idleSeconds;
      },
    },
  },
  argon: { isArgonHost: true },
}));

vi.mock("@/store/auth/meStore", () => ({
  useMe: () => ({
    get me() {
      return { currentStatus: h.current, userId: ME };
    },
    setTemporaryStatus(status: UserStatus) {
      // The real store is a no-op when nothing changes; mirroring that keeps the call log honest.
      if (h.current === status) return;
      h.current = status;
      h.temporary.push(status);
    },
  }),
}));

vi.mock("@/store/media/unifiedCallStore", async () => {
  const { reactive } = await import("vue");
  const speaking = reactive(new Set<string>());
  return { useUnifiedCall: () => ({ speaking }) };
});

import { useIdleStore } from "@/store/ui/idleStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";

const ME = "me";
const TICK_MS = 15_000;
const IDLE_LIMIT = 180;
const SNOOZE_LIMIT = 60 * 60;
/** Who the call hears speaking; the local VU meter puts us here while we talk. */
const speaking = useUnifiedCall().speaking as Set<string>;

/** Let the detector observe `seconds` of inactivity for one tick. */
async function tick(seconds: number) {
  h.idleSeconds = seconds;
  await vi.advanceTimersByTimeAsync(TICK_MS);
}

describe("idle auto-away", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    h.idleSeconds = 0;
    h.current = UserStatus.Online;
    h.temporary = [];
    h.failNextIdleRead = false;
    speaking.clear();
    // The store branches on the host bridge; the desktop build is the one that has an idle timer.
    vi.stubGlobal("argon", { isArgonHost: true });
    vi.stubGlobal("console", { ...console, log() {}, warn() {} });
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("an Online user goes Away once the idle threshold is reached", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT);

    expect(h.temporary).toEqual([UserStatus.Away]);
  });

  test("a user just short of the threshold is left Online", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT - 1);

    expect(h.temporary).toEqual([]);
    expect(h.current).toBe(UserStatus.Online);
  });

  test("staying idle does not keep re-announcing Away", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT);
    await tick(IDLE_LIMIT * 2);
    await tick(IDLE_LIMIT * 4);

    expect(h.temporary).toEqual([UserStatus.Away]);
  });

  test("coming back to the keyboard restores Online", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT);
    await tick(0);

    expect(h.temporary).toEqual([UserStatus.Away, UserStatus.Online]);
    expect(h.current).toBe(UserStatus.Online);
  });

  test("DoNotDisturb is never taken Away", async () => {
    h.current = UserStatus.DoNotDisturb;
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT * 10);

    expect(h.temporary).toEqual([]);
    expect(h.current).toBe(UserStatus.DoNotDisturb);
  });

  test("TouchGrass is never taken Away", async () => {
    h.current = UserStatus.TouchGrass;
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT * 10);

    expect(h.temporary).toEqual([]);
    expect(h.current).toBe(UserStatus.TouchGrass);
  });

  test("an Away the user chose is never auto-reverted", async () => {
    // No auto-away has ever happened, so nothing about this Away belongs to the detector.
    h.current = UserStatus.Away;
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT * 2);
    await tick(0);

    expect(h.temporary).toEqual([]);
    expect(h.current).toBe(UserStatus.Away);
  });

  test("a manual status change during auto-away hands control back to the user", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT);
    expect(h.current).toBe(UserStatus.Away);

    // The user, still idle, picks Online themselves — the detector must forget it ever acted.
    h.current = UserStatus.Online;
    await tick(IDLE_LIMIT * 2);

    // Still idle and Online again: only a fresh crossing of the threshold may take them Away, and
    // the tick that saw the manual change must not be the one that does it.
    expect(h.temporary).toEqual([UserStatus.Away]);
    expect(h.current).toBe(UserStatus.Online);

    // And then the user picks Away on their own. Activity must not undo that.
    h.current = UserStatus.Away;
    await tick(0);

    expect(h.current).toBe(UserStatus.Away);
  });

  test("switching to DoNotDisturb while auto-away stops the detector for good", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT);
    h.current = UserStatus.DoNotDisturb;

    await tick(0);
    await tick(IDLE_LIMIT * 2);

    expect(h.current).toBe(UserStatus.DoNotDisturb);
    expect(h.temporary).toEqual([UserStatus.Away]);
  });

  test("a status the detector does not own (InGame) is left alone in both directions", async () => {
    h.current = UserStatus.InGame;
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT * 3);
    await tick(0);

    expect(h.temporary).toEqual([]);
    expect(h.current).toBe(UserStatus.InGame);
  });

  test("a host that cannot answer does not kill idle tracking for the session", async () => {
    const idle = useIdleStore();
    await idle.init();

    h.failNextIdleRead = true;
    await tick(5);

    await tick(IDLE_LIMIT);

    expect(h.temporary).toEqual([UserStatus.Away]);
  });

  test("an hour of idleness deepens the detector's Away into Snooze", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT);
    await tick(SNOOZE_LIMIT - 1);
    expect(h.current).toBe(UserStatus.Away);

    await tick(SNOOZE_LIMIT);
    await tick(SNOOZE_LIMIT * 2);

    expect(h.temporary).toEqual([UserStatus.Away, UserStatus.Snooze]);
  });

  test("an Online user first seen after an hour of idleness goes straight to Snooze", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(SNOOZE_LIMIT);

    expect(h.temporary).toEqual([UserStatus.Snooze]);
  });

  test("coming back from Snooze restores Online", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT);
    await tick(SNOOZE_LIMIT);
    await tick(0);

    expect(h.temporary).toEqual([UserStatus.Away, UserStatus.Snooze, UserStatus.Online]);
  });

  test("an Away the user chose is never deepened into Snooze", async () => {
    h.current = UserStatus.Away;
    const idle = useIdleStore();
    await idle.init();

    await tick(SNOOZE_LIMIT * 2);

    expect(h.temporary).toEqual([]);
    expect(h.current).toBe(UserStatus.Away);
  });

  test("talking in a call is activity: the user stays Online however long the input is idle", async () => {
    const idle = useIdleStore();
    await idle.init();

    speaking.add(ME);
    await tick(IDLE_LIMIT * 10);
    await tick(SNOOZE_LIMIT);

    expect(h.temporary).toEqual([]);
    expect(h.current).toBe(UserStatus.Online);
  });

  test("the idle clock starts when the user stops talking, not at the last input", async () => {
    const idle = useIdleStore();
    await idle.init();

    speaking.add(ME);
    await tick(IDLE_LIMIT * 10);
    speaking.delete(ME);

    // Input has been idle for an hour, but the user spoke a moment ago.
    await tick(3600);
    expect(h.current).toBe(UserStatus.Online);

    // Twelve 15 s ticks in all: three minutes since they last spoke.
    for (let i = 0; i < 11; i++) await tick(3600);
    expect(h.temporary).toEqual([UserStatus.Away]);
  });

  test("speaking while auto-away brings the user back", async () => {
    const idle = useIdleStore();
    await idle.init();

    await tick(IDLE_LIMIT);
    speaking.add(ME);
    await tick(IDLE_LIMIT * 2);

    expect(h.temporary).toEqual([UserStatus.Away, UserStatus.Online]);
  });

  test("someone else talking is not the user's activity", async () => {
    const idle = useIdleStore();
    await idle.init();

    speaking.add("someone-else");
    await tick(IDLE_LIMIT);

    expect(h.temporary).toEqual([UserStatus.Away]);
  });
});
