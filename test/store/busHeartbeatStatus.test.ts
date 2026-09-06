/**
 * The status the client puts on the wire, and when it puts it there.
 *
 * The heartbeat is the ONLY thing that tells the server what this user's status really is: the hub
 * starts every fresh session as Online and only learns otherwise from a heartbeat. Two things
 * follow, and both are pinned here. The first heartbeat of a session decides how a Do-Not-Disturb
 * user is shown to everyone until the next one, so it must already carry the status they chose in
 * a previous session — which it does because the boot sequence loads the profile before the worker
 * that heartbeats exists, an ordering guarded below rather than assumed. And a status the user
 * picks mid-session goes out at once, because a tick is 15 s and a decision is not a sample.
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
   * The boot-order contract behind `me.me?.currentStatus ?? UserStatus.Online` in
   * `src/store/realtime/busStore.ts`.
   *
   * That fallback is a hard-coded Online, i.e. exactly the status a Do-Not-Disturb user did not
   * choose — so what keeps a DND user from being announced Online on every cold start is that the
   * fallback is never reached: the realtime worker is built by `completeInit()`, which runs after
   * `init()` has loaded the profile, and `init()` seeds `currentStatus` from the persisted
   * `preferredStatus` before the first `GetMe` answer is merged in. Nothing about that ordering is
   * self-evident from either file, and moving the connect ahead of the profile load would silently
   * turn every persisted DND into an Online announcement, so the order is asserted here (no worker
   * exists until `completeInit`) together with what it buys (the FIRST heartbeat is already DND).
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
