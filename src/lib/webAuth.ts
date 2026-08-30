/**
 * Sign-in for the browser build: Aegis (Argon's identity provider) over OAuth 2.0 + PKCE.
 *
 * The desktop app can hold a password form and a device-bound session because it is a device. A tab
 * cannot, so the web build never sees credentials at all: it hands the browser to Aegis, gets an
 * authorization code back on the redirect, and exchanges it for tokens with a proof key. The access
 * token it ends up with is the same bearer the rest of the app already sends on every call, so
 * nothing downstream of `authStore.token` needs to know which of the two flows produced it.
 *
 * Free of Vue and of the store layer: the redirect lands mid-boot, before pinia exists.
 */

import { logger } from "@argon/core";

const AEGIS_AUTHORIZE_URL = "https://aegis.argon.gl/";
const AEGIS_TOKEN_URL = "https://aegis.argon.gl/connect/token";
/**
 * The registered Aegis application. Web only — the desktop app authenticates against the API.
 *
 * TEMPORARY: borrowing Meet's client id while Argon Web's own one
 * (A37E7A1DB06E9610C9C0BD77C61A821B) is not yet usable. Swap it back before release — the redirect
 * URIs are registered per client, so this also decides which origins may complete a sign-in.
 */
const CLIENT_ID = "700E951110574351BEA823D2D8258BCA";
const SCOPE = "identity offline_access";

/** The path Aegis redirects back to. Must match the registered redirect URI exactly. */
export const CALLBACK_PATH = "/callback";

const KEYS = {
  access: "argon_web_access_token",
  refresh: "argon_web_refresh_token",
  expiresAt: "argon_web_token_exp", // unix seconds
  verifier: "argon_web_pkce_verifier",
} as const;

/** Refresh this long before the token actually expires, so no in-flight call rides an expired one. */
const REFRESH_SKEW_SECONDS = 60;

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let inFlightRefresh: Promise<string | null> | null = null;

/**
 * Why the last sign-in attempt did not produce a session.
 *
 * A failure on the callback leg has nowhere to be seen: by the time the app has finished booting it
 * is back on the sign-in screen, the code is spent and the address bar has been cleaned, so without
 * this the only symptom is the button reappearing. Held here and shown on that screen.
 */
let lastError: string | null = null;

/** The reason the last sign-in failed, or null. Cleared once a new attempt starts. */
export function lastSignInError(): string | null {
  return lastError;
}

// ── token storage ────────────────────────────────────────────────────────────────────────────────

export function accessToken(): string | null {
  return localStorage.getItem(KEYS.access);
}

function refreshToken(): string | null {
  return localStorage.getItem(KEYS.refresh);
}

function expiresAt(): number {
  return Number(localStorage.getItem(KEYS.expiresAt)) || 0;
}

function isExpired(skew = REFRESH_SKEW_SECONDS): boolean {
  const exp = expiresAt();
  if (!exp) return true;
  return Math.floor(Date.now() / 1000) >= exp - skew;
}

/** A stored session exists — not necessarily a valid one; `ensureFreshToken` decides that. */
export function hasSession(): boolean {
  return !!accessToken() || !!refreshToken();
}

function saveTokens(data: { access_token: string; refresh_token?: string; expires_in?: number }): void {
  localStorage.setItem(KEYS.access, data.access_token);
  // A refresh response may legitimately omit a new refresh token; keeping the old one is correct.
  if (data.refresh_token) localStorage.setItem(KEYS.refresh, data.refresh_token);
  localStorage.setItem(
    KEYS.expiresAt,
    String(Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600)),
  );
}

export function clearTokens(): void {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
}

// ── PKCE ─────────────────────────────────────────────────────────────────────────────────────────

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const verifier = base64Url(random);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function redirectUri(): string {
  return `${window.location.origin}${CALLBACK_PATH}`;
}

// ── flow ─────────────────────────────────────────────────────────────────────────────────────────

/** Leave for Aegis. Does not return — the page navigates away. */
export async function beginSignIn(): Promise<void> {
  lastError = null;
  const { verifier, challenge } = await createPkcePair();
  localStorage.setItem(KEYS.verifier, verifier);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${AEGIS_AUTHORIZE_URL}?${params.toString()}`;
}

/** Is this page load the return leg of a sign-in? */
export function isCallback(): boolean {
  if (window.location.pathname !== CALLBACK_PATH) return false;
  const query = new URLSearchParams(window.location.search);
  return query.has("code") || query.has("error");
}

/**
 * Puts the address bar back to the app's own URL.
 *
 * The code is single-use and the app routes in memory, so leaving `/callback?code=…` in the bar
 * would only give the user a link that fails if they ever reloaded it.
 */
function cleanUpUrl(): void {
  window.history.replaceState(null, "", window.location.origin + "/");
}

async function exchange(form: URLSearchParams): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(AEGIS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
  } catch (e) {
    // Never rethrown: this runs inside the boot sequence, where a thrown error is indistinguishable
    // from any other failed init step and gets retried instead of reported. A blocked cross-origin
    // request lands here too, and looks exactly like the network being down.
    lastError = "network";
    logger.error("[web-auth] could not reach the token endpoint", e);
    return null;
  }

  if (!res.ok) {
    // The body is where the answer is: OpenIddict returns `error` / `error_description`, and an
    // unregistered redirect uri or a rejected client id says so there and nowhere else.
    const detail = await res.text().catch(() => "");
    lastError = `http_${res.status}`;
    logger.error(`[web-auth] token endpoint returned ${res.status}`, detail);
    return null;
  }

  const data = await res.json().catch(() => null);
  if (!data?.access_token) {
    lastError = "no_token";
    logger.error("[web-auth] token response carried no access_token", data);
    return null;
  }

  lastError = null;
  saveTokens(data);
  return data.access_token as string;
}

/**
 * Finish the redirect: turn the authorization code into tokens.
 *
 * Returns the access token, or null when the user declined, the code was already spent, or the
 * verifier is gone (a callback opened in a different browser profile, say) — all of which mean the
 * same thing to the caller: show the sign-in screen again.
 */
export async function completeSignIn(): Promise<string | null> {
  const query = new URLSearchParams(window.location.search);
  const error = query.get("error");
  const code = query.get("code");
  const verifier = localStorage.getItem(KEYS.verifier);
  localStorage.removeItem(KEYS.verifier);
  cleanUpUrl();

  if (error) {
    lastError = query.get("error_description") || error;
    logger.warn("[web-auth] sign-in was declined:", lastError);
    return null;
  }
  if (!code || !verifier) {
    // Most often the sign-in was started from a different origin than the one it came back to —
    // the verifier is stored per origin, and a dev server that moved port counts as another one.
    lastError = !verifier ? "no_verifier" : "no_code";
    logger.warn("[web-auth] callback without a usable code/verifier pair", { code: !!code, verifier: !!verifier });
    return null;
  }

  const token = await exchange(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  );
  if (token) logger.success("[web-auth] signed in");
  return token;
}

/** Trade the refresh token for a new access token. Clears the session if the server refuses. */
async function refresh(): Promise<string | null> {
  const rt = refreshToken();
  if (!rt) return null;

  try {
    const token = await exchange(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, client_id: CLIENT_ID }),
    );
    if (!token) clearTokens();
    return token;
  } catch (e) {
    // A network failure is not a rejected session: keep the tokens and let the next attempt decide.
    logger.warn("[web-auth] refresh could not be completed", e);
    return null;
  }
}

/**
 * The token to send right now, refreshing first if the stored one is spent.
 *
 * Concurrent callers share one refresh — the tab wakes several things at once (realtime, the API
 * client, whatever the user clicked), and a refresh token may only be redeemed once.
 */
export async function ensureFreshToken(): Promise<string | null> {
  if (!isExpired()) return accessToken();
  if (!inFlightRefresh) {
    inFlightRefresh = refresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/**
 * Keep the token fresh while the app runs.
 *
 * The interval is coarse because it is not the only thing holding the session up: a tab that was
 * asleep gets an explicit check on wake, and `ensureFreshToken` is called on the paths that matter.
 */
export function startAutoRefresh(onToken: (token: string) => void): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(async () => {
    if (!isExpired()) return;
    const token = await ensureFreshToken();
    if (token) onToken(token);
  }, 60_000);
}

export function stopAutoRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

/** Drop the local session. Aegis keeps its own — signing in again will not ask for a password. */
export function signOut(): void {
  stopAutoRefresh();
  clearTokens();
}
