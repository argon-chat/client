/**
 * What `preferredStatus` is allowed to remember.
 *
 * `preferredStatus` is the only presence state that outlives a session: it is the thing the client
 * re-asserts on the next launch, before the server has told it anything. So exactly two statuses
 * belong in it — the two a user picks on purpose and expects to still be in tomorrow, DoNotDisturb
 * and TouchGrass. Online is the absence of a choice; Away is a verdict the idle detector reaches on
 * its own and never a wish, and a persisted Away would mean a user who was idle when they closed
 * the app comes back "Away" to everyone with nothing on screen explaining why.
 *
 * The failures this guards are all invisible in the moment and only show up a launch later, which
 * is why they are pinned here rather than left to be noticed.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { UserStatus } from "@argon/glue";

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
  useApi: () => ({ userInteraction: {}, identityInteraction: {}, apiEndpoint: "https://api.test" }),
}));
vi.mock("@/store/realtime/busStore", () => ({
  useBus: () => ({ doListenMyEvents: () => {} }),
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
vi.mock("@/composables/useTheme", () => ({
  useTheme: () => ({ applyAppearanceSettings() {} }),
}));

import { useMe } from "@/store/auth/meStore";

/** The key `useLocalStorage` writes under; `activeAccountId()` falls back to "default" here. */
const KEY = "preferredStatus::default";

const persisted = () => {
  const raw = localStorage.getItem(KEY);
  return raw === null ? null : Number(raw);
};

/** The store only has a status to change once a profile has landed. */
function withMe(store: ReturnType<typeof useMe>, status: UserStatus) {
  store.me = { userId: "u1", username: "u", displayName: "U", currentStatus: status } as never;
}

describe("meStore preferred status", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  test("DoNotDisturb is remembered for the next launch", async () => {
    const me = useMe();
    withMe(me, UserStatus.Online);

    await me.changeStatusTo(UserStatus.DoNotDisturb);
    await nextTick();

    expect(me.me!.currentStatus).toBe(UserStatus.DoNotDisturb);
    expect(persisted()).toBe(UserStatus.DoNotDisturb);
  });

  test("TouchGrass is remembered for the next launch", async () => {
    const me = useMe();
    withMe(me, UserStatus.Online);

    await me.changeStatusTo(UserStatus.TouchGrass);
    await nextTick();

    expect(me.me!.currentStatus).toBe(UserStatus.TouchGrass);
    expect(persisted()).toBe(UserStatus.TouchGrass);
  });

  test("coming back to Online from DoNotDisturb clears the remembered status", async () => {
    const me = useMe();
    withMe(me, UserStatus.Online);
    await me.changeStatusTo(UserStatus.DoNotDisturb);
    await nextTick();

    await me.changeStatusTo(UserStatus.Online);
    await nextTick();

    expect(me.me!.currentStatus).toBe(UserStatus.Online);
    expect(persisted()).toBe(UserStatus.Online);
  });

  test("coming back to Online from TouchGrass clears the remembered status", async () => {
    const me = useMe();
    withMe(me, UserStatus.Online);
    await me.changeStatusTo(UserStatus.TouchGrass);
    await nextTick();

    await me.changeStatusTo(UserStatus.Online);
    await nextTick();

    expect(persisted()).toBe(UserStatus.Online);
  });

  test("a manual Away is never written to the remembered status", async () => {
    const me = useMe();
    withMe(me, UserStatus.Online);

    await me.changeStatusTo(UserStatus.Away);
    await nextTick();

    // The user is Away right now...
    expect(me.me!.currentStatus).toBe(UserStatus.Away);
    // ...but tomorrow's launch must not start them Away.
    expect(persisted()).toBe(UserStatus.Online);
  });

  test("leaving DoNotDisturb for Away still clears the remembered DoNotDisturb", async () => {
    const me = useMe();
    withMe(me, UserStatus.Online);
    await me.changeStatusTo(UserStatus.DoNotDisturb);
    await nextTick();

    await me.changeStatusTo(UserStatus.Away);
    await nextTick();

    // Away is not remembered, and the DND it replaced must not be either — the user left it.
    expect(persisted()).toBe(UserStatus.Online);
  });

  test("the idle detector's status change never touches what is remembered", async () => {
    const me = useMe();
    withMe(me, UserStatus.Online);
    await me.changeStatusTo(UserStatus.DoNotDisturb);
    await nextTick();

    me.setTemporaryStatus(UserStatus.Away);
    await nextTick();
    expect(me.me!.currentStatus).toBe(UserStatus.Away);
    expect(persisted()).toBe(UserStatus.DoNotDisturb);

    me.setTemporaryStatus(UserStatus.Online);
    await nextTick();
    expect(persisted()).toBe(UserStatus.DoNotDisturb);
  });

  test("a persisted Away is normalised to Online when the store loads", async () => {
    // Written by an older build (or by a race that let the idle detector through).
    localStorage.setItem(KEY, String(UserStatus.Away));

    useMe();
    await nextTick();

    expect(persisted()).toBe(UserStatus.Online);
  });

  test("a persisted DoNotDisturb survives the load untouched", async () => {
    localStorage.setItem(KEY, String(UserStatus.DoNotDisturb));

    useMe();
    await nextTick();

    expect(persisted()).toBe(UserStatus.DoNotDisturb);
  });
});
