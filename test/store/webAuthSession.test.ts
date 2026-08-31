/**
 * How the browser build gets a token, and what it is allowed to conclude when it does not.
 *
 * There are two ways in and they look nothing alike. A redirect landing right now carries an
 * authorization code, spent once and turned into a session. Every other load has no code and no
 * token — what it may have is the session cookie the API set last time, which is `HttpOnly` and
 * therefore invisible from the page. The only way to find out is to ask, and the asking is
 * `GetMyAuthorization` with both arguments empty: not placeholders, but the literal truth that the
 * page has nothing to send.
 *
 * The failure paths are the reason this file exists. "Refused" and "did not get an answer" arrive at
 * the same place — no token — and treating the second as the first is how a server having a bad
 * minute becomes a forced sign-in for everyone who happened to be starting the app. Only an explicit
 * refusal may forget the marker that says a session exists.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const API_ENDPOINT = "https://api.test.invalid";

const stubs = vi.hoisted(() => ({
  isCallback: vi.fn(() => false),
  completeSignIn: vi.fn(async () => null as string | null),
  hasSession: vi.fn(() => false),
  forgetSession: vi.fn(),
  signOut: vi.fn(async () => {}),
  getMyAuthorization: vi.fn(),
  goOffline: vi.fn(async () => {}),
}));

vi.mock("@/lib/webAuth", () => ({
  isCallback: stubs.isCallback,
  completeSignIn: stubs.completeSignIn,
  hasSession: stubs.hasSession,
  forgetSession: stubs.forgetSession,
  signOut: stubs.signOut,
}));

vi.mock("@/store/system/apiStore", () => ({
  useApi: () => ({
    apiEndpoint: API_ENDPOINT,
    identityInteraction: { GetMyAuthorization: stubs.getMyAuthorization },
  }),
}));

vi.mock("@/store/realtime/busStore", () => ({ useBus: () => ({ goOffline: stubs.goOffline }) }));
vi.mock("@/lib/platform", () => ({ isWeb: true }));
vi.mock("@argon/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/** The three answers `GetMyAuthorization` can give that this code distinguishes between. */
const renewed = (token: string) => ({ isBadAuthStatus: () => false, isGoodAuthStatus: () => true, token });
const refused = () => ({ isBadAuthStatus: () => true, isGoodAuthStatus: () => false });
const lockedDown = () => ({ isBadAuthStatus: () => false, isGoodAuthStatus: () => false });

async function authStore() {
  const { useAuthStore } = await import("@/store/auth/authStore");
  return useAuthStore();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  // Implementations, not just call records: `clearAllMocks` forgets who called what but keeps any
  // `mockReturnValue` a test set, so without this the second test in the file starts out believing
  // it is on a redirect because the first one was.
  stubs.isCallback.mockReturnValue(false);
  stubs.hasSession.mockReturnValue(false);
  stubs.completeSignIn.mockResolvedValue(null);
  stubs.getMyAuthorization.mockReset();

  setActivePinia(createPinia());
  localStorage.clear();
});

describe("restoring a browser session", () => {
  test("a redirect is completed against the API this build talks to", async () => {
    stubs.isCallback.mockReturnValue(true);
    stubs.completeSignIn.mockResolvedValue("fresh-token");

    const store = await authStore();
    await store.restoreSession();

    expect(stubs.completeSignIn).toHaveBeenCalledWith(API_ENDPOINT);
    expect(store.token).toBe("fresh-token");
    expect(store.isAuthenticated).toBe(true);
    // The cookie is set by the exchange itself; nothing here should also be asking to renew.
    expect(stubs.getMyAuthorization).not.toHaveBeenCalled();
  });

  test("a cold start renews from the cookie, sending nothing of its own", async () => {
    stubs.hasSession.mockReturnValue(true);
    stubs.getMyAuthorization.mockResolvedValue(renewed("renewed-token"));

    const store = await authStore();
    await store.restoreSession();

    // Both arguments empty. A page that passed a token here would be a page that had one to lose.
    expect(stubs.getMyAuthorization).toHaveBeenCalledWith("", null);
    expect(store.token).toBe("renewed-token");
    expect(store.isAuthenticated).toBe(true);
  });

  test("a browser that never signed in is not asked about", async () => {
    stubs.hasSession.mockReturnValue(false);

    const store = await authStore();
    await store.restoreSession();

    expect(stubs.getMyAuthorization).not.toHaveBeenCalled();
    expect(store.isAuthenticated).toBe(false);
  });

  test("a refused session is forgotten, so the next start goes to sign-in", async () => {
    stubs.hasSession.mockReturnValue(true);
    stubs.getMyAuthorization.mockResolvedValue(refused());

    const store = await authStore();
    await store.restoreSession();

    expect(stubs.forgetSession).toHaveBeenCalled();
    expect(store.token).toBeNull();
    expect(store.isAuthenticated).toBe(false);
  });

  test("a session that could not be reached is kept", async () => {
    stubs.hasSession.mockReturnValue(true);
    stubs.getMyAuthorization.mockRejectedValue(new TypeError("Failed to fetch"));

    const store = await authStore();
    await store.restoreSession();

    // No token this time, and that is all it means. Forgetting the marker here would turn a dropped
    // connection into a sign-out, and the session in the cookie is still perfectly good.
    expect(stubs.forgetSession).not.toHaveBeenCalled();
    expect(store.token).toBeNull();
  });

  test("an account under lockdown is not treated as a session that ended", async () => {
    stubs.hasSession.mockReturnValue(true);
    stubs.getMyAuthorization.mockResolvedValue(lockedDown());

    const store = await authStore();
    await store.restoreSession();

    // The restriction is shown to the user elsewhere; throwing the session away here would replace
    // an explanation with a sign-in screen.
    expect(stubs.forgetSession).not.toHaveBeenCalled();
  });
});

describe("signing out", () => {
  test("the API is told, so the session stops being honoured on other tabs too", async () => {
    const store = await authStore();

    store.setAuthToken("a-token");
    store.logout();

    expect(stubs.signOut).toHaveBeenCalledWith(API_ENDPOINT);
    expect(store.token).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(localStorage.getItem("token")).toBeNull();
  });
});
