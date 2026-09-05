/**
 * Sign-in for the browser build: Aegis (Argon's identity provider) over OAuth 2.0 + PKCE, then one
 * exchange for an Argon session.
 *
 * The desktop app can hold a password form and a device-bound session because it is a device. A tab
 * cannot, so the web build never sees credentials at all: it hands the browser to Aegis, gets an
 * authorization code back on the redirect, and exchanges it for tokens with a proof key.
 *
 * **The Aegis token is not what the app runs on.** It is presented once, to `/auth/web/session`, and
 * then dropped. What comes back is an ordinary Argon access token — the same bearer the desktop
 * sends — plus a session cookie the API sets and this code can never read. That cookie is the
 * long-lived half: it is `HttpOnly`, so a script that gets onto the page cannot take the session with
 * it, which is the whole reason nothing here writes a refresh token to `localStorage` any more.
 *
 * Renewal is therefore not this module's job. `GetMyAuthorization` mints a new access token from the
 * cookie, and the store layer calls it — at boot and when a sleeping tab wakes — exactly as the
 * desktop build already does with its own refresh token. There is no timer here for the same reason
 * the desktop has none: an access token is good for days, and the two moments that matter are
 * covered.
 *
 * Free of Vue and of the store layer: the redirect lands mid-boot, before pinia exists. That is also
 * why the API's address arrives as an argument rather than being read from configuration.
 */

import { logger } from "@argon/core";

const AEGIS_AUTHORIZE_URL = "https://aegis.argon.gl/";
const AEGIS_TOKEN_URL = "https://aegis.argon.gl/connect/token";

/**
 * The registered Aegis application. Web only — the desktop app authenticates against the API.
 */
const CLIENT_ID = "A37E7A1DB06E9610C9C0BD77C61A821B";

/**
 * No `offline_access`.
 *
 * That scope exists to get a refresh token, and a refresh token is the thing this flow deliberately
 * no longer keeps: the Argon session cookie is what survives a reload now, and asking Aegis to mint
 * a credential nobody stores would only widen what an intercepted redirect is worth.
 */
const SCOPE = "identity";

/** The path Aegis redirects back to. Must match the registered redirect URI exactly. */
export const CALLBACK_PATH = "/callback";

/**
 * That a session was opened — a hint, never a credential.
 *
 * The session itself is an `HttpOnly` cookie, so the page cannot see whether it has one. Without
 * some mark of its own the app could not tell "signed in, token expired" from "never signed in", and
 * would have to attempt a refresh on every cold start including the very first. Losing this flag
 * costs a trip to the sign-in screen; it cannot be used to authenticate anything.
 */
const SESSION_HINT_KEY = "argon_web_session";

const VERIFIER_KEY = "argon_web_pkce_verifier";

/** Treat a token as spent this long before it actually expires. */
const EXPIRY_SKEW_SECONDS = 60;

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

// ── session marker ───────────────────────────────────────────────────────────────────────────────

/** A session was opened on this browser once. Whether it is still good is the API's to say. */
export function hasSession(): boolean {
  return localStorage.getItem(SESSION_HINT_KEY) === "1";
}

/**
 * Forget the local traces of a session.
 *
 * Only the traces: the session lives in a cookie on the API's host, and ending it there is what
 * {@link signOut} is for. This is the half that runs when the API has already refused the session
 * and there is nothing left to end.
 */
export function forgetSession(): void {
  localStorage.removeItem(SESSION_HINT_KEY);
  localStorage.removeItem(VERIFIER_KEY);
}

// ── token inspection ─────────────────────────────────────────────────────────────────────────────

/**
 * When an Argon access token stops being accepted, read out of the token itself.
 *
 * Read rather than stored beside it: an expiry kept in `localStorage` next to the token is a second
 * source of truth that drifts the moment either is written without the other, and the answer is
 * already inside the thing being asked about.
 */
export function expiresAt(token: string | null): number {
  if (!token) return 0;

  const payload = token.split(".")[1];
  if (!payload) return 0;

  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return Number(JSON.parse(json).exp) || 0;
  } catch {
    // A token that cannot be read is one the API will not accept either, and answering "expired"
    // sends the caller down the refresh path — which is where an unusable token should end up.
    return 0;
  }
}

export function isExpired(token: string | null, skew = EXPIRY_SKEW_SECONDS): boolean {
  const exp = expiresAt(token);
  if (!exp) return true;
  return Math.floor(Date.now() / 1000) >= exp - skew;
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
  localStorage.setItem(VERIFIER_KEY, verifier);

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

/**
 * Redeems the authorization code at Aegis.
 *
 * The token it returns is held for the length of one call and never written down: its only use is
 * the exchange below, and after that it is of no further interest to this app.
 */
async function redeemCode(code: string, verifier: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(AEGIS_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
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

  return data.access_token as string;
}

/**
 * Trades the Aegis token for an Argon session.
 *
 * `credentials: "include"` is load-bearing rather than boilerplate: the response's whole point is
 * the `Set-Cookie` it carries, and a cross-origin fetch without it neither sends nor accepts one.
 * The app would then sign in successfully and be signed out again by the next reload, with nothing
 * in the console to say why.
 */
async function openSession(apiBase: string, aegisToken: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}/auth/web/session`, {
      method: "POST",
      credentials: "include",
      headers: { authorization: `Bearer ${aegisToken}` },
    });
  } catch (e) {
    lastError = "network";
    logger.error("[web-auth] could not reach the session endpoint", e);
    return null;
  }

  if (!res.ok) {
    // A 401 here is the API refusing the identity server's token, which in practice means this
    // client's audience is not on the API's allowlist — a deployment mismatch rather than anything
    // the user did, and worth saying so plainly in the log.
    lastError = `session_http_${res.status}`;
    logger.error(`[web-auth] the API refused to open a session (${res.status})`,
      await res.text().catch(() => ""));
    return null;
  }

  const data = await res.json().catch(() => null);
  if (!data?.accessToken) {
    lastError = "no_session_token";
    logger.error("[web-auth] session response carried no accessToken", data);
    return null;
  }

  localStorage.setItem(SESSION_HINT_KEY, "1");
  lastError = null;
  return data.accessToken as string;
}

/**
 * Finish the redirect: authorization code in, Argon access token out.
 *
 * Returns null when the user declined, the code was already spent, the verifier is gone (a callback
 * opened in a different browser profile, say), or the API would not open a session — all of which
 * mean the same thing to the caller: show the sign-in screen again.
 */
export async function completeSignIn(apiBase: string): Promise<string | null> {
  const query = new URLSearchParams(window.location.search);
  const error = query.get("error");
  const code = query.get("code");
  const verifier = localStorage.getItem(VERIFIER_KEY);
  localStorage.removeItem(VERIFIER_KEY);
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

  const aegisToken = await redeemCode(code, verifier);
  if (!aegisToken) return null;

  const token = await openSession(apiBase, aegisToken);
  if (!token) return null;

  logger.success("[web-auth] signed in");
  return token;
}

/**
 * End the session, at the API and here.
 *
 * Best-effort on the wire and unconditional locally: the point of the call is the tombstone the API
 * writes against the session id, and a user who is offline when they press sign out still expects
 * the app to stop being signed in.
 *
 * Aegis keeps its own session regardless — signing in again will not ask for a password. That is the
 * behaviour of every application sharing an identity provider, and ending it here would mean signing
 * the user out of the others too.
 */
export async function signOut(apiBase: string): Promise<void> {
  try {
    // keepalive: callers reload the page right after signing out, and a plain fetch is cancelled
    // with the document — the tombstone would never be written.
    await fetch(`${apiBase}/auth/web/logout`, { method: "POST", credentials: "include", keepalive: true });
  } catch (e) {
    logger.warn("[web-auth] sign-out could not reach the API; clearing locally anyway", e);
  } finally {
    forgetSession();
  }
}
