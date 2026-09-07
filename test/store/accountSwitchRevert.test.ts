/**
 * What happens when the account being switched INTO turns out to be unusable.
 *
 * The server can refuse it for good — its session was revoked, or the account was deleted outright —
 * and the app's answer to a refused session is to drop the credentials and reload into the sign-in
 * screen. On a switch that answer is wrong twice over: the account being switched away from is still
 * signed in, and the sign-in screen has no picker to go back to it with. So one click on a dead
 * account signed the device out of every other one, with no way in but typing a password.
 *
 * These tests drive the seam the real flow goes through — `markActiveNeedsReauth`, which the profile
 * load calls the moment the server says no — and check where the pointer ends up, because that is
 * what the reload immediately afterwards will boot into.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const stubs = vi.hoisted(() => ({
  reload: vi.fn(),
  continueAfterLogin: vi.fn(async () => true),
  restoreSession: vi.fn(async () => {}),
}));

vi.mock("@argon/core", () => ({
  logger: { log() {}, debug() {}, info() {}, warn() {}, error() {}, success() {}, fail() {} },
}));
vi.mock("@/lib/telemetry/metrics", () => ({
  metrics: { count() {}, distribution() {}, gauge() {}, startTimer: () => ({ end() {} }) },
  enumName: () => "x",
  errorKind: () => "x",
  bucket: () => "x",
}));
vi.mock("@/lib/platform", () => ({ isWeb: false, isDesktop: true, supports: () => true }));
vi.mock("@/store/system/instanceStore", () => ({
  useInstance: () => ({ active: {}, applyManifestObject: vi.fn() }),
  DEFAULT_MANIFEST: {},
  instanceManifestSchema: { safeParse: () => ({ success: false }) },
}));
vi.mock("@/store/db/dexie", () => ({
  db: { close: vi.fn() },
  reopenActiveAccountDb: vi.fn(async () => {}),
}));
vi.mock("@/store/system/sessionLifecycle", async () => {
  const { ref } = await import("vue");
  return { sessionEpoch: ref(0), isSwitchingAccount: ref(false), runSessionReset: vi.fn(async () => {}) };
});
vi.mock("@/store/realtime/busStore", () => ({
  useBus: () => ({ goOffline: vi.fn(async () => {}), closeAllSubscribes: vi.fn() }),
}));
vi.mock("@/store/media/unifiedCallStore", () => ({
  useUnifiedCall: () => ({ mode: "none", leave: vi.fn(async () => {}) }),
}));
vi.mock("@/store/system/apiStore", () => ({ useApi: () => ({ recycleClient: vi.fn() }) }));
vi.mock("@/store/auth/authStore", () => ({
  useAuthStore: () => ({ restoreSession: stubs.restoreSession }),
}));
vi.mock("@/router", () => ({ default: { push: vi.fn(async () => {}) } }));
vi.mock("@/store/system/appState", () => ({
  useAppState: () => ({ continueAfterLogin: stubs.continueAfterLogin }),
}));

const account = (id: string, displayName: string) => ({
  id,
  userId: id,
  displayName,
  avatarFileId: null,
  instanceManifest: { instance: { kind: "official" }, endpoints: { api: "https://api" }, branding: {} },
  instanceKind: "official",
  refreshToken: `rft-${id}`,
  accessToken: `token-${id}`,
  createdAt: 1,
  lastUsedAt: 1,
});

/** Two accounts on the device, `active` signed in and looking at the app. */
function seedRegistry(active: string) {
  localStorage.setItem("argon_accounts", JSON.stringify([account("first", "First"), account("second", "Second")]));
  localStorage.setItem("argon_active_account", active);
}

async function accountsStore() {
  const { useAccounts } = await import("@/store/auth/accountsStore");
  return useAccounts();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  setActivePinia(createPinia());
  vi.stubGlobal("location", { reload: stubs.reload });
});

describe("a switch into an account the server refuses", () => {
  test("hands the pointer back to the account it came from", async () => {
    seedRegistry("first");
    const accounts = await accountsStore();

    // The profile load rejects the target the way the server's verdict reaches it for real.
    stubs.continueAfterLogin.mockImplementation(async () => {
      accounts.markActiveNeedsReauth();
      return false;
    });

    await accounts.switchTo("second");

    expect(accounts.active?.id).toBe("first");
    expect(localStorage.getItem("argon_active_account")).toBe("first");
  });

  test("keeps the refused account, marked, and leaves the one we came from alone", async () => {
    seedRegistry("first");
    const accounts = await accountsStore();
    stubs.continueAfterLogin.mockImplementation(async () => {
      accounts.markActiveNeedsReauth();
      return false;
    });

    await accounts.switchTo("second");

    const refused = accounts.accounts.find(a => a.id === "second");
    expect(refused?.needsReauth).toBe(true);
    expect(refused?.accessToken).toBeNull(); // a stale token would only be refused again
    expect(accounts.accounts.find(a => a.id === "first")?.needsReauth).toBeFalsy();
  });

  test("says which account it could not open, once", async () => {
    seedRegistry("first");
    const accounts = await accountsStore();
    stubs.continueAfterLogin.mockImplementation(async () => {
      accounts.markActiveNeedsReauth();
      return false;
    });

    await accounts.switchTo("second");

    const { consumeSwitchFailure } = await import("@/store/auth/accountsStore");
    expect(consumeSwitchFailure()).toBe("Second");
    expect(consumeSwitchFailure()).toBeNull();
  });

  test("reports the outcome as a revert, so no sign-out notice is left behind", async () => {
    seedRegistry("first");
    const accounts = await accountsStore();
    let outcome: string | undefined;
    stubs.continueAfterLogin.mockImplementation(async () => {
      outcome = accounts.markActiveNeedsReauth();
      return false;
    });

    await accounts.switchTo("second");

    expect(outcome).toBe("reverted");
  });
});

describe("a session refused outside a switch", () => {
  test("still ends the session on this device", async () => {
    seedRegistry("first");
    const accounts = await accountsStore();

    expect(accounts.markActiveNeedsReauth()).toBe("signed_out");
    expect(accounts.active?.id).toBe("first");
    expect(accounts.active?.needsReauth).toBe(true);
    expect(sessionStorage.getItem("argon.switch_failed")).toBeNull();
  });

  test("has nowhere to go back to when the account it came from is refused as well", async () => {
    seedRegistry("first");
    const accounts = await accountsStore();
    // Both sessions are gone — the device really is signed out and belongs on the sign-in screen.
    accounts.accounts.forEach(a => { a.needsReauth = true; });

    stubs.continueAfterLogin.mockImplementation(async () => {
      expect(accounts.markActiveNeedsReauth()).toBe("signed_out");
      return false;
    });

    await accounts.switchTo("second");

    expect(accounts.active?.id).toBe("second");
  });
});
