/**
 * The machine identity a browser carries for itself.
 *
 * **Why a tab needs one at all.** Every access token is minted against a machine id and carries it
 * as `mh`; the request pipeline resolves the caller's id and checks the two agree. An installed
 * client writes that id into the `ArgonSecure` cookie from native code. The web build cannot — the
 * cookie is `HttpOnly` and written by the API on its own host — so the server writes it instead, and
 * for a page served from the same site that is the end of the story: the browser sends the cookie
 * back and nothing here is needed.
 *
 * **It is needed when the page is served from somewhere else.** That cookie is `SameSite=Lax`, so a
 * tab on another site never returns it. The server then had nothing to read, minted a fresh identity
 * on every exchange, and bound the session to an id the page could not present again — so sign-in
 * succeeded and the first call after it failed with `MachineId is not defined`. A development build
 * on `localhost` talking to the deployed API is exactly that shape, and so is any self-hosted
 * front-end on a host of its own.
 *
 * **`X-Sec-Carry`, not `Sec-Carry`.** The server reads both, but `Sec-` is a forbidden header prefix
 * in fetch: a page that sets `Sec-Carry` has it removed before the request is sent, with no error.
 * Only the `X-` spelling survives, which is why the server accepts one of each.
 *
 * Not a fingerprint and deliberately not derived from one. It is a random value that identifies a
 * browser profile, in the same alphabet and of the same length as the one the server mints. Clearing
 * site data produces a new one — which is the same promise the cookie made, and the reason this is
 * not something to build a ban on.
 */
import { logger } from "@argon/core";

export const MACHINE_ID_HEADER = "X-Sec-Carry";

/**
 * The session label, and the second thing the device cookie carries that a cross-site tab cannot get
 * back. `GetSessionId` reads `scid` out of the same cookie and fails the request outright when it is
 * missing — so a browser that cannot send the cookie has to present this instead.
 *
 * Unlike the machine id, this one is **not ours to invent**: the server mints it at the exchange and
 * files the session under it, so the page is echoing a value rather than choosing one. It arrives in
 * the exchange response and lives until the session ends.
 */
export const SESSION_ID_HEADER = "X-Sec-Ref";

const STORAGE_KEY = "argon_web_machine";
const SESSION_KEY = "argon_web_scid";

/** 128 random bits, base64url — the shape `ArgonSecureCookie.NewMachineId` writes. */
function mint(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cached: string | null = null;

/**
 * This browser's machine id, the same one for the life of the profile.
 *
 * Held in memory as well as in storage so that a browser which refuses `localStorage` — a private
 * window with site data blocked — still presents one stable value for the life of the tab. That is
 * worth more than it sounds: without it every call in the tab would carry a different id, and every
 * one of them would fail the `mh` check rather than merely losing the session on reload.
 */
export function machineId(): string {
  if (cached) return cached;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return (cached = stored);
  } catch (e) {
    logger.warn("[machine-id] storage is unreadable; using a value that lasts this tab only", e);
  }

  cached = mint();

  try {
    localStorage.setItem(STORAGE_KEY, cached);
  } catch {
    /* reported above; the in-memory value still holds the tab together */
  }

  return cached;
}

/** Remember the session id the API minted for this browser. */
export function rememberSessionId(sessionId: string): void {
  try {
    localStorage.setItem(SESSION_KEY, sessionId);
  } catch (e) {
    logger.warn("[machine-id] could not store the session id; it will be missing after a reload", e);
  }
}

/** The session id this browser was given, or null before the first exchange. */
export function sessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function forgetSessionId(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to forget if it could not be written either */
  }
}
