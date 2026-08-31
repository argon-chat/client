/**
 * What a failed profile load is allowed to conclude about the browser session.
 *
 * The web build has no session exchange to check a token against — the first authenticated call is
 * the check. That makes the failure path load-bearing: read it as "this session is over" and every
 * bad minute the server has signs people out and sends them back to the sign-in screen, with the
 * refresh token thrown away on the way. Only the server's own verdict may do that; everything else
 * has to travel back up to the boot sequence, which already retries with backoff.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { IonRequestException } from "@argon-chat/ion.webcore";

const stubs = vi.hoisted(() => ({
  getMe: vi.fn(),
  signOut: vi.fn(),
  logout: vi.fn(),
  reload: vi.fn(),
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    userInteraction: {
      GetMe: stubs.getMe,
      GetMyProfile: vi.fn(async () => ({})),
      GetMyLegalState: vi.fn(async () => ({ tosVersion: null, privacyVersion: null })),
      AcceptLegal: vi.fn(async () => {}),
    },
    identityInteraction: { GetMyAuthorization: vi.fn() },
  }),
}));
vi.mock("@/store/realtime/busStore", () => ({ useBus: () => ({ doListenMyEvents: vi.fn() }) }));
vi.mock("@/store/features/featureFlagsStore", () => ({
  useFeatureFlags: () => ({ loadFeatureFlags: vi.fn(async () => {}) }),
}));
vi.mock("@/store/data/ultimaStore", () => ({
  useUltimaStore: () => ({ init: vi.fn(async () => {}), isSubscribed: false }),
}));
vi.mock("@/composables/useTheme", () => ({
  useTheme: () => ({ applyAppearanceSettings: vi.fn() }),
}));
vi.mock("@/store/auth/authStore", () => ({
  useAuthStore: () => ({
    logout: stubs.logout,
    token: "access-token",
    getRefreshToken: () => null,
    setAuthToken: vi.fn(),
  }),
}));
vi.mock("@/store/auth/accountsStore", () => ({
  useAccounts: () => ({
    syncActiveProfile: vi.fn(async () => {}),
    markActiveNeedsReauth: vi.fn(),
    updateActiveTokens: vi.fn(),
  }),
}));
vi.mock("@/lib/webAuth", () => ({ signOut: stubs.signOut }));
vi.mock("@sentry/vue", () => ({ setUser: vi.fn() }));

/** The transport's fallback when the body was not a protocol error: the bare status, nothing else. */
const upstream = (status: string) =>
  new IonRequestException({ code: "UPSTREAM_ERROR", message: status });

async function initMe() {
  const { useMe } = await import("@/store/auth/meStore");
  return useMe().init();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  setActivePinia(createPinia());
  vi.stubGlobal("location", { reload: stubs.reload });
});

describe("web session init", () => {
  test("a server error while online leaves the session alone", async () => {
    stubs.getMe.mockRejectedValue(upstream("503"));

    // Rethrown rather than swallowed: the boot sequence owns the retry.
    await expect(initMe()).rejects.toThrow();

    expect(stubs.signOut).not.toHaveBeenCalled();
    expect(stubs.logout).not.toHaveBeenCalled();
    expect(stubs.reload).not.toHaveBeenCalled();
  });

  test("a failure that is not the server's verdict at all leaves the session alone", async () => {
    stubs.getMe.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(initMe()).rejects.toThrow();

    expect(stubs.signOut).not.toHaveBeenCalled();
    expect(stubs.logout).not.toHaveBeenCalled();
  });

  test("the server refusing the session signs out", async () => {
    stubs.getMe.mockRejectedValue(upstream("401"));

    await expect(initMe()).resolves.toBe(false);

    expect(stubs.signOut).toHaveBeenCalled();
    expect(stubs.logout).toHaveBeenCalled();
    expect(stubs.reload).toHaveBeenCalled();
  });

  test("a named authorization error signs out too", async () => {
    stubs.getMe.mockRejectedValue(
      new IonRequestException({ code: "UNAUTHORIZED", message: "session is not valid" }),
    );

    await expect(initMe()).resolves.toBe(false);

    expect(stubs.signOut).toHaveBeenCalled();
  });

  test("a profile that loads is not mistaken for a failure", async () => {
    stubs.getMe.mockResolvedValue({ userId: "u1", displayName: "Someone", username: "someone" });

    await expect(initMe()).resolves.toBe(true);

    expect(stubs.signOut).not.toHaveBeenCalled();
  });
});
