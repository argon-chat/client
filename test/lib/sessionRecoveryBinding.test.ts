/**
 * That a bound session is renewed rather than ended.
 *
 * **Why this needs a test of its own.** Binding a web session deliberately cuts its cookie from a
 * month to minutes: that shortness *is* the protection, because a copied cookie is then worth only
 * the minutes left on it, and getting another needs a signature from a key that cannot leave the
 * browser. The consequence is that an expired session cookie stops being the end of a session and
 * becomes a routine event — several times an hour.
 *
 * Chromium performs that renewal itself, off the DBSC headers. Every other browser cannot, so the
 * app has to ask, and the asking has exactly one call site: the moment a refresh comes back refused.
 * Miss it and nothing fails loudly — the code that renews still exists, still passes its own tests,
 * and is simply never reached. What the user sees is being signed out every ten minutes, with a key
 * sitting in IndexedDB that would have kept them in. That is the bug this pins.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const stubs = vi.hoisted(() => ({
  refreshWebToken: vi.fn(async () => null as string | null),
  refreshDeviceBinding: vi.fn(async () => false),
  hasSession: vi.fn(() => true),
  markActiveNeedsReauth: vi.fn(() => "signed_out" as const),
}));

vi.mock("@/lib/platform", () => ({ isWeb: true, isNative: false }));

vi.mock("@/lib/net/deviceBinding", () => ({
  refreshDeviceBinding: stubs.refreshDeviceBinding,
}));

vi.mock("@/store/auth/authStore", () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    token: "an-access-token",
    refreshWebToken: stubs.refreshWebToken,
  }),
}));

vi.mock("@/store/auth/accountsStore", () => ({
  useAccounts: () => ({ markActiveNeedsReauth: stubs.markActiveNeedsReauth }),
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({ apiEndpoint: "https://api.test.invalid" }),
}));

vi.mock("@/lib/webAuth", () => ({
  hasSession: stubs.hasSession,
  forgetSession: vi.fn(),
  signOut: vi.fn(async () => {}),
}));

/** Fresh module each time: the recovery module keeps in-flight and sign-out state of its own. */
async function recovery() {
  vi.resetModules();
  return await import("@/lib/net/sessionRecovery");
}

describe("recovering a device-bound session", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    stubs.hasSession.mockReturnValue(true);
  });

  it("renews through the device key when the session cookie has expired", async () => {
    // The cookie is gone, the key is not: exactly the state a bound session spends its life in.
    stubs.refreshWebToken
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("a-new-access-token");
    stubs.refreshDeviceBinding.mockResolvedValue(true);

    const { handleSessionRejected } = await recovery();

    expect(await handleSessionRejected("test")).toBe("renewed");
    expect(stubs.refreshDeviceBinding).toHaveBeenCalledWith("https://api.test.invalid");
    // The session survived, so nothing may have marked the account for re-authentication.
    expect(stubs.markActiveNeedsReauth).not.toHaveBeenCalled();
  });

  it("asks the device to prove itself before concluding anything", async () => {
    stubs.refreshWebToken.mockResolvedValue(null);
    stubs.refreshDeviceBinding.mockResolvedValue(false);

    const { handleSessionRejected } = await recovery();
    await handleSessionRejected("test");

    // The point of the test: it is reached at all.
    expect(stubs.refreshDeviceBinding).toHaveBeenCalledTimes(1);
  });

  it("does not disturb the binding when an ordinary refresh works", async () => {
    stubs.refreshWebToken.mockResolvedValue("a-new-access-token");

    const { handleSessionRejected } = await recovery();

    expect(await handleSessionRejected("test")).toBe("renewed");
    expect(stubs.refreshDeviceBinding).not.toHaveBeenCalled();
  });

  /**
   * An unbound browser, or one whose binding is gone, must still reach the old answer — the
   * fallback may not turn a refused session into one that hangs on.
   */
  it("still gives up when there is no binding to fall back on", async () => {
    stubs.refreshWebToken.mockResolvedValue(null);
    stubs.refreshDeviceBinding.mockResolvedValue(false);
    stubs.hasSession.mockReturnValue(true); // a bad minute, not a refusal

    const { handleSessionRejected } = await recovery();

    expect(await handleSessionRejected("test")).toBe("unknown");
  });

  it("tries the binding once rather than looping on it", async () => {
    stubs.refreshWebToken.mockResolvedValue(null);
    stubs.refreshDeviceBinding.mockResolvedValue(true);

    const { handleSessionRejected } = await recovery();
    await handleSessionRejected("test");

    // Proven, retried, and then done: a key that proves itself while the token still will not
    // renew is not a state more attempts improve.
    expect(stubs.refreshDeviceBinding).toHaveBeenCalledTimes(1);
    expect(stubs.refreshWebToken).toHaveBeenCalledTimes(2);
  });
});
