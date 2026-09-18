/**
 * What a member list is allowed to cost, and what it is allowed to keep.
 *
 * Opening a space mounts one row per member, and every row wanted a custom status. Each one was a
 * separate PrefetchProfile — a unary round trip that costs the server a DbContext and a three-way
 * join — fired all at once, repeated on every scroll pass, for a profile the row mostly threw away.
 *
 * These tests drive the store the rows go through and watch two things: how many calls reach the
 * transport and what each one carries, and what is left behind afterwards. The second half matters
 * as much as the first — PrefetchProfiles answers with date of birth, bio and banner whatever the
 * caller wanted, and a list that persists all of it turns one rendered string into a local dossier
 * on everyone in the space.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import type { ArgonUserProfile } from "@argon/glue";
import type { FakeTable } from "./inMemoryDexie";

/** One entry per call that reached the transport, held open until the test lets it answer. */
const { wire } = vi.hoisted(() => ({
  wire: [] as { userIds: string[]; answer: (profiles: unknown[]) => void; answered?: boolean }[],
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {}, success() {}, fail() {} },
}));
// Imported for the event payload's type only; the runtime value is never constructed here.
vi.mock("@argon/glue", () => ({ UserProfileUpdated: class {} }));

vi.mock("@/store/db/dexie", async () => {
  const { FakeTable } = await import("./inMemoryDexie");
  return { db: { profileCache: new FakeTable("profileCache", "key") } };
});

const { resetters } = vi.hoisted(() => ({ resetters: [] as (() => void)[] }));

vi.mock("@/store/system/sessionLifecycle", async () => {
  const { ref } = await import("vue");
  return {
    sessionEpoch: ref(0),
    onSessionReset: (fn: () => void) => resetters.push(fn),
  };
});
vi.mock("@/store/realtime/busStore", () => ({ useBus: () => ({ onServerEvent: () => {} }) }));
vi.mock("@/store/system/systemStore", () => ({
  useSystemStore: () => ({ isLongReconnecting: false }),
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    serverInteraction: {
      PrefetchProfiles: (_spaceId: string, userIds: string[]) =>
        new Promise(resolve => wire.push({ userIds, answer: resolve })),
    },
    userInteraction: {},
  }),
}));

import { db } from "@/store/db/dexie";
import { sessionEpoch } from "@/store/system/sessionLifecycle";
import { useProfileCacheStore } from "@/store/data/profileCacheStore";

/** What accountsStore.switchTo does when an account switch lands. */
const switchAccount = () => {
  sessionEpoch.value++;
  for (const reset of resetters) reset();
};

const profileCache = db.profileCache as unknown as FakeTable<any>;

const SPACE = "space-1";

/**
 * What the server sends back: everything, whatever the caller asked for.
 *
 * The one cast in this file. `dateOfBirth` is a `DateOnly` on the wire and a readable string here,
 * because what these tests have to say about it is that it never reaches the cache — and a real one
 * would put a glue constructor between the reader and that point for no gain.
 */
const serverProfile = (userId: string, customStatus: string | null = "at work") => ({
  userId,
  customStatus,
  customStatusIconId: null,
  bannerFileID: "banner-file",
  dateOfBirth: "1991-04-02",
  bio: "lives in Berlin, two cats",
  badges: ["early"],
  archetypes: [{ archetypeId: "role-1" }],
  backgroundId: null,
  voiceCardEffectId: null,
  avatarFrameId: null,
  nickEffectId: null,
  primaryColor: null,
  accentColor: null,
  registeredAt: null,
}) as unknown as ArgonUserProfile;

/**
 * Lets the store's coalescing window close, its cache reads resolve and its un-awaited cache writes
 * land. Real timers rather than fake ones: the window is what is under test here, and faking it
 * would only prove the test can advance a clock.
 */
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 12));
};

/** Answers a held-open call the way the server does: one entry per id it was given. */
const answerAll = (call: (typeof wire)[number], status = "at work") => {
  if (call.answered) return;
  call.answered = true;
  call.answer(call.userIds.map(id => serverProfile(id, status)));
};

/**
 * Answers everything on the wire, including the calls that go out as slots free up, until the queue
 * behind them is empty. Bounded, so a store that never stops sending fails the test rather than the
 * suite.
 */
const drainWire = async (status = "at work") => {
  for (let round = 0; round < 12; round++) {
    const pending = wire.filter(call => !call.answered);
    if (pending.length === 0) return;
    for (const call of pending) answerAll(call, status);
    await settle();
  }
  throw new Error("the wire never drained");
};

/** Every id carried by every call that has reached the transport. */
const asked = () => wire.flatMap(call => call.userIds);

beforeEach(() => {
  wire.length = 0;
  resetters.length = 0;
  sessionEpoch.value = 0;
  profileCache.clear();
  setActivePinia(createPinia());
});

describe("member list prefetch", () => {
  test("rows asking for the same member in one frame send one call", async () => {
    const store = useProfileCacheStore();

    // The shape the bug had: several rows for the same member mount in the same tick. The cache
    // read used to run before anything was recorded as in-flight, so all of them got past it.
    const rows = Promise.all([
      store.getStatus(SPACE, "u1"),
      store.getStatus(SPACE, "u1"),
      store.getStatus(SPACE, "u1"),
      store.getStatus(SPACE, "u1"),
    ]);
    await settle();

    expect(wire).toHaveLength(1);
    expect(wire[0].userIds).toEqual(["u1"]);

    answerAll(wire[0], "away");
    expect(await rows).toEqual(Array(4).fill({ customStatus: "away", customStatusIconId: null }));
  });

  test("a screenful of members goes out as one call, not one call each", async () => {
    const store = useProfileCacheStore();

    const onScreen = Array.from({ length: 20 }, (_, i) => `u${i}`);
    onScreen.forEach(id => void store.getStatus(SPACE, id).catch(() => {}));
    await settle();

    expect(wire).toHaveLength(1);
    expect(wire[0].userIds).toHaveLength(20);
    expect([...wire[0].userIds].sort()).toEqual([...onScreen].sort());

    answerAll(wire[0], "away");
    await settle();

    expect(await store.getStatus(SPACE, "u7")).toEqual({
      customStatus: "away",
      customStatusIconId: null,
    });
    expect(wire).toHaveLength(1);
  });

  test("more members than one call may carry are split, and only six calls run at once", async () => {
    const store = useProfileCacheStore();

    const wholeSpace = Array.from({ length: 500 }, (_, i) => `u${i}`);
    wholeSpace.forEach(id => void store.getStatus(SPACE, id).catch(() => {}));
    await settle();

    // Six calls of fifty rather than five hundred calls of one.
    expect(wire).toHaveLength(6);
    expect(wire.every(call => call.userIds.length === 50)).toBe(true);
    expect(new Set(asked()).size).toBe(300);

    // A slot frees up as each answer lands, and exactly one more call takes it.
    answerAll(wire[0]);
    await settle();
    expect(wire).toHaveLength(7);
  });

  test("a row scrolled away before its call went out never costs one", async () => {
    const store = useProfileCacheStore();

    // Asked for first, so every row that mounts after it is newer — and the queue is drained newest
    // first, on the grounds that the newest request is the one the user is looking at.
    const scrolledPast = new AbortController();
    const dropped = store.getStatus(SPACE, "scrolled-past", { signal: scrolledPast.signal });

    for (let i = 0; i < 600; i++) void store.getStatus(SPACE, `visible-${i}`).catch(() => {});
    await settle();

    expect(wire).toHaveLength(6);
    expect(asked()).not.toContain("scrolled-past");

    scrolledPast.abort();
    await expect(dropped).rejects.toMatchObject({ name: "AbortError" });

    // Draining the wire lets the queue behind it through; the abandoned row is not in it.
    await drainWire();

    expect(asked().length).toBeGreaterThan(300);
    expect(asked()).not.toContain("scrolled-past");
  });

  test("a call already on the wire is left to land and fill the cache", async () => {
    const store = useProfileCacheStore();

    const closedEarly = new AbortController();
    const abandoned = store.getStatus(SPACE, "u1", { signal: closedEarly.signal });
    await settle();
    expect(wire).toHaveLength(1);

    closedEarly.abort();
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });

    answerAll(wire[0], "back soon");
    await settle();

    // Paid for already, so the next row that wants it is served without a second call.
    expect(await store.getStatus(SPACE, "u1")).toEqual({
      customStatus: "back soon",
      customStatusIconId: null,
    });
    expect(wire).toHaveLength(1);
  });

  test("a member seen once is not asked for again when the row remounts", async () => {
    const store = useProfileCacheStore();

    const first = store.getStatus(SPACE, "u1");
    await settle();
    answerAll(wire[0], "away");
    await first;

    // Virtualised rows remount every time they cross the viewport.
    for (let i = 0; i < 10; i++) await store.getStatus(SPACE, "u1");

    expect(wire).toHaveLength(1);
  });

  test("a member the server has nothing to say about fails alone", async () => {
    const store = useProfileCacheStore();

    const present = store.getStatus(SPACE, "u1");
    const absent = store.getStatus(SPACE, "u2");
    await settle();

    expect(wire).toHaveLength(1);
    // The answer is paired up by userId, so a missing entry costs its own job and nothing else.
    wire[0].answer([serverProfile("u1", "away")]);

    expect(await present).toEqual({ customStatus: "away", customStatusIconId: null });
    await expect(absent).rejects.toThrow(/u2/);
  });
});

/**
 * Two things happening at once: a reply on its way in, and the ground moving under it. An account
 * switch swaps the API client and the Dexie database; an invalidation empties the cache on purpose.
 * Either way a call that was already in flight is carrying an answer from before the change, and
 * the bugs here are all the same bug — that answer being written down as though nothing happened.
 */
describe("an answer that arrives after the ground moved", () => {
  test("a reply from the previous account does not evict the new account's job", async () => {
    const store = useProfileCacheStore();

    const abandoned = store.getStatus(SPACE, "u1");
    abandoned.catch(() => {});
    await settle();
    expect(wire).toHaveLength(1);

    // The switch drops everything in flight; the call it dropped is still on the wire.
    switchAccount();

    const afterSwitch = store.getStatus(SPACE, "u1");
    afterSwitch.catch(() => {});
    await settle();
    expect(wire).toHaveLength(2);

    // The previous account's call lands. It has no business touching the registry any more: the
    // key it was filed under now belongs to somebody else's job.
    answerAll(wire[0], "stale");
    await settle();

    // Which is what this proves — a third request still joins the live job rather than opening a
    // call of its own, because that job is still registered.
    const joining = store.getStatus(SPACE, "u1");
    joining.catch(() => {});
    await settle();
    expect(wire).toHaveLength(2);

    answerAll(wire[1], "current");
    expect(await joining).toEqual({ customStatus: "current", customStatusIconId: null });
  });

  test("an update event for the previous account is not written into the new one's cache", async () => {
    const store = useProfileCacheStore();

    const key = `${SPACE}:u1`;
    profileCache.seed({
      key,
      spaceId: SPACE,
      userId: "u1",
      profile: serverProfile("u1", "before"),
      fetchedAt: Date.now(),
      scope: "full",
    });

    // The event is read out of Dexie first, and that read is where the switch gets in.
    const applying = store.updateProfile(SPACE, "u1", serverProfile("u1", "after"));
    switchAccount();
    await applying;
    await settle();

    expect(profileCache.peek(key).profile.customStatus).toBe("before");
  });

  test("an invalidated profile is not put back by the call that was already asking for it", async () => {
    const store = useProfileCacheStore();

    const asking = store.getStatus(SPACE, "u1");
    await settle();
    expect(wire).toHaveLength(1);

    // The long reconnect ends and the cache is emptied — while the answer is still on the wire.
    await store.invalidateAll();
    answerAll(wire[0], "from before the reconnect");
    await settle();

    // The caller is still answered: it asked, and dropping the reply on the floor would leave a row
    // blank for no reason.
    expect(await asking).toEqual({
      customStatus: "from before the reconnect",
      customStatusIconId: null,
    });

    // But nothing was written down, so the next reader goes and asks.
    expect(profileCache.peek(`${SPACE}:u1`)).toBeUndefined();

    const next = store.getStatus(SPACE, "u1");
    next.catch(() => {});
    await settle();
    expect(wire).toHaveLength(2);
  });

  test("invalidating one member leaves the others in flight alone", async () => {
    const store = useProfileCacheStore();

    const purged = store.getStatus(SPACE, "u1");
    const kept = store.getStatus(SPACE, "u2");
    await settle();
    expect(wire).toHaveLength(1);

    await store.invalidateUser("u1");
    answerAll(wire[0], "away");
    await Promise.all([purged, kept]);
    await settle();

    expect(profileCache.peek(`${SPACE}:u1`)).toBeUndefined();
    expect(profileCache.peek(`${SPACE}:u2`)?.profile.customStatus).toBe("away");
  });

  test("a stored row read across the purge is not handed out as though it survived", async () => {
    const store = useProfileCacheStore();

    profileCache.seed({
      key: `${SPACE}:u1`,
      spaceId: SPACE,
      userId: "u1",
      profile: serverProfile("u1", "from before the purge"),
      fetchedAt: Date.now(),
      scope: "status",
    });

    // The local read is already in flight — begin() has issued it and is waiting on it — when the
    // cache is emptied underneath it.
    const reading = store.getStatus(SPACE, "u1");
    reading.catch(() => {});
    await store.invalidateAll();
    await settle();

    // So the row it comes back holding is one that no longer exists, and it has to go and ask.
    expect(wire).toHaveLength(1);
    expect(wire[0].userIds).toEqual(["u1"]);

    answerAll(wire[0], "current");
    expect(await reading).toEqual({ customStatus: "current", customStatusIconId: null });
  });

  test("a member still waiting its turn when the cache is emptied is cached as usual", async () => {
    const store = useProfileCacheStore();

    // Asked for first, so the three hundred rows that mount after it are drained ahead of it and it
    // is still sitting in the queue, having fetched nothing, when the purge lands.
    const queued = store.getStatus(SPACE, "still-queued");
    for (let i = 0; i < 300; i++) void store.getStatus(SPACE, `visible-${i}`).catch(() => {});
    await settle();
    expect(asked()).not.toContain("still-queued");

    await store.invalidateAll();

    // Whatever it brings back is read after the purge, so it is the fresh data the purge wanted.
    await drainWire();

    await queued;
    expect(profileCache.peek(`${SPACE}:still-queued`)?.profile.customStatus).toBe("at work");
  });
});

describe("what a prefetch leaves behind", () => {
  test("a list row keeps the status and nothing else", async () => {
    const store = useProfileCacheStore();

    const row = store.getStatus(SPACE, "u1");
    await settle();
    answerAll(wire[0], "away");
    await row;
    await settle();

    const cached = profileCache.peek(`${SPACE}:u1`);
    expect(cached.scope).toBe("status");
    expect(cached.profile.customStatus).toBe("away");
    // The rest of the answer is not the list's to hold on to.
    expect(cached.profile.bio).toBeNull();
    expect(cached.profile.dateOfBirth).toBeNull();
    expect(cached.profile.bannerFileID).toBeNull();
    expect(cached.profile.badges).toEqual([]);
    expect(cached.profile.archetypes).toEqual([]);
  });

  test("an opened profile card keeps the whole profile", async () => {
    const store = useProfileCacheStore();

    const card = store.getProfile(SPACE, "u1");
    await settle();
    answerAll(wire[0]);
    await card;
    await settle();

    const cached = profileCache.peek(`${SPACE}:u1`);
    expect(cached.scope).toBe("full");
    expect(cached.profile.bio).toBe("lives in Berlin, two cats");
    expect(cached.profile.archetypes).toHaveLength(1);
  });

  test("a card opened over a listed member fetches rather than showing the trimmed copy", async () => {
    const store = useProfileCacheStore();

    const row = store.getStatus(SPACE, "u1");
    await settle();
    answerAll(wire[0], "away");
    await row;
    await settle();

    const card = store.getProfile(SPACE, "u1");
    await settle();
    expect(wire).toHaveLength(2);

    answerAll(wire[1], "away");
    expect((await card).bio).toBe("lives in Berlin, two cats");
  });

  test("callers cannot reach into the cached copy", async () => {
    const store = useProfileCacheStore();

    const card = store.getProfile(SPACE, "u1");
    await settle();
    answerAll(wire[0]);
    // The profile popover appends the badges it derives from the member's roles before rendering.
    (await card).badges.push("derived");
    await settle();

    const again = await store.getProfile(SPACE, "u1");
    expect(again.badges).toEqual(["early"]);
  });
});
