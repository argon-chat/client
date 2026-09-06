/**
 * The status the client puts on the wire, and when it puts it there.
 *
 * The heartbeat is the ONLY thing that tells the server what this user's status really is. The hub
 * no longer assumes Online at connect: it starts a session statusless and waits out a short
 * deadline for the first heartbeat, which makes that heartbeat the whole answer rather than a
 * correction to a guess. Three things follow, and all three are pinned here. It must carry the
 * status the user chose in a previous session, whether or not the profile has landed — the boot
 * sequence usually loads it first, but a heartbeat that beats it falls back to the persisted
 * preference rather than to Online. The profile landing on a connection that is already up (a
 * resync, an account switch, a retried boot step) announces itself instead of waiting for the
 * tick. And a status the user picks mid-session goes out at once, because a tick is 15 s and a
 * decision is not a sample.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { UserStatus } from "@argon/glue";

/** Every worker the bus built, and everything the bus said to it. */
const workers = vi.hoisted(() => ({ built: [] as FakeWorker[] }));

class FakeWorker {
  posted: any[] = [];
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  postMessage(message: any) {
    this.posted.push(message);
  }
  terminate() {}
  /** Speak as the worker does, from its own thread. */
  async say(data: any) {
    await this.onmessage?.({ data });
  }
  heartbeats() {
    return this.posted.filter((m) => m.type === "heartbeatInvoke");
  }
}

vi.mock("@/workers/realtimeWorker?worker", () => ({
  default: class {
    constructor() {
      const worker = new FakeWorker();
      workers.built.push(worker);
      return worker as never;
    }
  },
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
}));
vi.mock("@sentry/vue", () => ({ setUser: () => {} }));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: { count() {}, distribution() {}, gauge() {} },
  enumName: () => "x",
  errorKind: () => "x",
  bucket: () => "x",
  COUNT_EDGES: [],
}));
vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    userInteraction: {
      // What a web session's `init()` asks for. None of these answers carries a status — that is
      // the point: the status the first heartbeat reports can only come from what was persisted.
      GetMe: async () => ({
        userId: "u1",
        username: "u",
        displayName: "U",
        avatarFileId: null,
        flags: 0,
      }),
      GetMyProfile: async () => ({ userId: "u1" }),
      GetMyLegalState: async () => ({ tosVersion: null, privacyVersion: null }),
    },
    identityInteraction: {},
    eventBus: { PickTicket: async () => "ticket" },
    apiEndpoint: "https://api.test",
  }),
}));
vi.mock("@/store/features/featureFlagsStore", () => ({
  useFeatureFlags: () => ({ loadFeatureFlags: async () => {} }),
}));
vi.mock("@/store/data/ultimaStore", () => ({
  useUltimaStore: () => ({ isSubscribed: false, init: async () => {} }),
}));
vi.mock("@/store/auth/authStore", () => ({
  useAuthStore: () => ({ token: null, logout() {}, getRefreshToken: () => null, setAuthToken() {} }),
}));
vi.mock("@/store/auth/accountsStore", () => ({
  useAccounts: () => ({ syncActiveProfile: async () => {}, markActiveNeedsReauth() {}, updateActiveTokens() {} }),
}));
vi.mock("@/composables/useTheme", () => ({ useTheme: () => ({ applyAppearanceSettings() {} }) }));

import { useBus } from "@/store/realtime/busStore";
import { useMe } from "@/store/auth/meStore";

/** Where the preferred status is persisted; `activeAccountId()` is "default" with no account set. */
const PREFERRED_KEY = "preferredStatus::default";

/** Connect the bus and hand back the worker it created. */
async function connectedWorker() {
  const bus = useBus();
  await bus.doListenMyEvents();
  return workers.built.at(-1)!;
}

describe("heartbeat status", () => {
  beforeEach(() => {
    localStorage.clear();
    workers.built.length = 0;
    setActivePinia(createPinia());
  });

  test("reports the status the user actually has", async () => {
    const me = useMe();
    me.me = { userId: "u1", username: "u", displayName: "U", currentStatus: UserStatus.DoNotDisturb } as never;

    const worker = await connectedWorker();
    await worker.say({ type: "heartbeatRequest" });

    expect(worker.heartbeats()).toEqual([{ type: "heartbeatInvoke", status: UserStatus.DoNotDisturb }]);
  });

  test("follows the user across a status change without waiting for a reconnect", async () => {
    const me = useMe();
    me.me = { userId: "u1", username: "u", displayName: "U", currentStatus: UserStatus.Online } as never;

    const worker = await connectedWorker();
    await worker.say({ type: "heartbeatRequest" });

    await me.changeStatusTo(UserStatus.TouchGrass);
    await worker.say({ type: "heartbeatRequest" });

    expect(worker.heartbeats().map((h) => h.status)).toEqual([UserStatus.Online, UserStatus.TouchGrass]);
  });

  test("an automatic Away goes out on the very next heartbeat", async () => {
    const me = useMe();
    me.me = { userId: "u1", username: "u", displayName: "U", currentStatus: UserStatus.Online } as never;

    const worker = await connectedWorker();
    me.setTemporaryStatus(UserStatus.Away);
    await worker.say({ type: "heartbeatRequest" });

    expect(worker.heartbeats().at(-1)!.status).toBe(UserStatus.Away);
  });

  test("always answers, so the worker is never left waiting on a heartbeat", async () => {
    const worker = await connectedWorker();
    await worker.say({ type: "heartbeatRequest" });

    expect(worker.heartbeats()).toHaveLength(1);
  });

  /**
   * The boot-order contract behind the heartbeat's answer in `src/store/realtime/busStore.ts`.
   *
   * The realtime worker is built by `completeInit()`, which runs after `init()` has loaded the
   * profile, and `init()` seeds `currentStatus` from the persisted `preferredStatus` before the
   * first `GetMe` answer is merged in. Nothing about that ordering is self-evident from either
   * file, and it is what makes the FIRST heartbeat of a cold start already say Do Not Disturb — on
   * a server that now takes that first heartbeat as the session's status outright. The order is
   * asserted (no worker exists until `completeInit`) together with what it buys. The test below it
   * covers the same user when the order does not hold.
   */
  test("the first heartbeat of a cold start carries the persisted Do Not Disturb", async () => {
    // The user chose Do Not Disturb in a previous session; nothing has been fetched yet this one.
    localStorage.setItem(PREFERRED_KEY, String(UserStatus.DoNotDisturb));

    const me = useMe();
    expect(me.me).toBeNull();

    expect(await me.init()).toBe(true);

    // The profile is in and the status it carries is the persisted one — and no worker has been
    // built yet, so no heartbeat could have gone out ahead of it.
    expect(me.me!.currentStatus).toBe(UserStatus.DoNotDisturb);
    expect(workers.built).toHaveLength(0);

    await me.completeInit();
    const worker = workers.built.at(-1)!;
    await worker.say({ type: "heartbeatRequest" });

    expect(worker.heartbeats()).toEqual([
      { type: "heartbeatInvoke", status: UserStatus.DoNotDisturb },
    ]);
  });

  /**
   * A deliberate status change is sent, not sampled.
   *
   * `meStore.changeStatusTo` used to write `me.currentStatus` and stop there, leaving the new status
   * to the next 15 s heartbeat tick: a user who picked "Do Not Disturb" before a meeting went on
   * being shown to everyone else as whatever they were, for up to a full interval, while their own
   * screen already said otherwise. `busStore.pushStatusNow` closes that window by sending the same
   * `Heartbeat` the tick sends — the server no-ops a repeat and rate-limits real changes itself.
   *
   * The mechanism is asserted, not just the effect, because the client has a second one that looks
   * like it would do: `wakeConnection()`. It must NOT be used here — `wake` resets the worker's
   * reconnect attempt counter, cancels its backoff timer and can re-dial the hub, which is
   * reconnect machinery that has no business running because someone opened a status menu.
   */
  test("choosing a status pushes it instead of waiting for the next tick", async () => {
    const me = useMe();
    me.me = { userId: "u1", username: "u", displayName: "U", currentStatus: UserStatus.Online } as never;
    const worker = await connectedWorker();
    // Answer the connect-time heartbeat so only what the change itself causes is left.
    await worker.say({ type: "heartbeatRequest" });
    worker.posted.length = 0;

    await me.changeStatusTo(UserStatus.DoNotDisturb);

    expect(worker.posted).toEqual([
      { type: "invoke", method: "Heartbeat", args: [UserStatus.DoNotDisturb] },
    ]);
  });

  /**
   * The idle detector's Away is a decision too, and goes out the same way.
   *
   * `setTemporaryStatus` is what auto-Away calls; it does not persist anything (an Away is a
   * verdict, not a wish) but the server still has to hear about it now, or a user who walked away
   * from the keyboard keeps showing as Online for another tick — and the same on the way back.
   */
  test("an automatic Away is pushed as soon as the detector decides it", async () => {
    const me = useMe();
    me.me = { userId: "u1", username: "u", displayName: "U", currentStatus: UserStatus.Online } as never;
    const worker = await connectedWorker();
    await worker.say({ type: "heartbeatRequest" });
    worker.posted.length = 0;

    me.setTemporaryStatus(UserStatus.Away);
    me.setTemporaryStatus(UserStatus.Online);

    expect(worker.posted).toEqual([
      { type: "invoke", method: "Heartbeat", args: [UserStatus.Away] },
      { type: "invoke", method: "Heartbeat", args: [UserStatus.Online] },
    ]);
  });

  /**
   * The same contract with TouchGrass. Kept separate because TouchGrass has a second failure
   * stacked on it server-side (`RecalculateAggregatedStatusAsync` does not recognise it and folds
   * such a session to Offline), so a client that reported Online here would hide that defect rather
   * than merely mis-state a status.
   */
  /**
   * The fallback, for the boot orders where the profile is not in yet.
   *
   * The test above pins the cold start, where nothing heartbeats before `init()` returns. It is not
   * the only order: the worker reconnects on its own and heartbeats the moment it is back, and the
   * boot sequence re-runs (a full resync, an account switch, a step that failed and is retried)
   * with `me` cleared by `onSessionReset` while that connection is still up. A hard-coded Online
   * there announced the one status a Do-Not-Disturb user did not choose, and — since the server
   * stopped inventing a status of its own — it was the client, not the hub, producing the flash.
   */
  test("a heartbeat that beats the profile reports the persisted status, not Online", async () => {
    localStorage.setItem(PREFERRED_KEY, String(UserStatus.DoNotDisturb));

    const me = useMe();
    expect(me.me).toBeNull();

    const worker = await connectedWorker();
    await worker.say({ type: "heartbeatRequest" });

    expect(worker.heartbeats()).toEqual([
      { type: "heartbeatInvoke", status: UserStatus.DoNotDisturb },
    ]);
  });

  /**
   * With no preference persisted there is nothing to prefer, and Online is the right answer: it is
   * the absence of a choice, not a choice. Pinned so the fallback chain above cannot be "fixed"
   * into reporting Offline (which the server maps back to Online anyway) or nothing at all.
   */
  test("a heartbeat that beats the profile reports Online when nothing was persisted", async () => {
    const worker = await connectedWorker();
    await worker.say({ type: "heartbeatRequest" });

    expect(worker.heartbeats()).toEqual([{ type: "heartbeatInvoke", status: UserStatus.Online }]);
  });

  /**
   * The profile landing is a status decision too, and is announced like one.
   *
   * When the connection is already up — the boot sequence re-running after a resync or an account
   * switch — the session is being heartbeated with whatever the fallback or the previous account
   * left behind, and `init()` is the moment that stops being true. Waiting for the next tick showed
   * the wrong user's status for up to 15 s; the push costs one `Heartbeat` the server no-ops when
   * it repeats what it already has.
   */
  test("the profile landing on a live connection announces its status at once", async () => {
    localStorage.setItem(PREFERRED_KEY, String(UserStatus.DoNotDisturb));

    const worker = await connectedWorker();
    worker.posted.length = 0;

    const me = useMe();
    expect(await me.init()).toBe(true);

    expect(worker.posted).toEqual([
      { type: "invoke", method: "Heartbeat", args: [UserStatus.DoNotDisturb] },
    ]);
  });

  test("the first heartbeat of a cold start carries a persisted TouchGrass", async () => {
    localStorage.setItem(PREFERRED_KEY, String(UserStatus.TouchGrass));

    const me = useMe();
    expect(await me.init()).toBe(true);
    expect(workers.built).toHaveLength(0);

    await me.completeInit();
    const worker = workers.built.at(-1)!;
    await worker.say({ type: "heartbeatRequest" });

    expect(worker.heartbeats().at(-1)!.status).toBe(UserStatus.TouchGrass);
  });
});
