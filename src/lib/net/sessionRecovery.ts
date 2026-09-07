/**
 * What happens when the server stops accepting this session mid-flight.
 *
 * Two very different things arrive looking the same — an `IonRequestException` with `NO_AUTH` on a
 * call that carried a token:
 *
 *  - **The access token expired.** It is good for a week and the app can run longer than that. The
 *    refresh token is still fine; a `GetMyAuthorization` mints a new access token and everything
 *    carries on.
 *  - **The session was ended** — signed out from another device, sign-out-everywhere, a password
 *    change. Then the refresh is refused too, and the only honest thing left is to drop the
 *    credentials and go back to the sign-in screen.
 *
 * So the response to a rejection is always the same first step: try to refresh, once, and let the
 * server's answer decide. Until this existed neither case was handled at all — the realtime worker
 * asked for a hub ticket, was told `NO_AUTH`, and asked again on every reconnect attempt, forever,
 * while the app sat there "reconnecting" and kept the tokens of a session that no longer existed.
 *
 * Single-flight: a burst of rejected calls (the worker retries its ticket three times) collapses
 * into one refresh and one decision.
 *
 * Reasons are codes, never sentences. The server sends `session_signed_out` on the socket before it
 * closes it, this module adds its own, and the sign-in screen turns whichever it finds into a message
 * in the user's language after the reload — see `consumeSignOutReason` / `signOutReasonMessageKey`.
 */

import { logger } from "@argon/core";
import { useApi } from "@/store/system/apiStore";
import { useAuthStore } from "@/store/auth/authStore";
import { useAccounts } from "@/store/auth/accountsStore";
import { isWeb } from "@/lib/platform";
import { withDeviceProof } from "@/lib/net/deviceProofHeader";
import { isSessionRejected } from "@/lib/net/authFailure";
import * as webAuth from "@/lib/webAuth";
import { metrics } from "@/lib/telemetry/metrics";

export type RecoveryOutcome =
  /** A new access token is in place; callers may retry. */
  | "renewed"
  /** The session is over. Credentials are gone and the page is reloading into sign-in. */
  | "signed_out"
  /** Could not tell — offline, a server error, a lockdown. Nothing was changed. */
  | "unknown";

/**
 * Why a device was signed out, as a code. `session_signed_out` is what the server sends on the
 * socket and what a refused refresh means; `session_ended` is the catch-all for anything this side
 * decided on its own.
 */
export type SignOutReason = "session_signed_out" | "session_ended";

/** Where the reason waits across the reload that ends the session. Session storage: this tab, this once. */
const SIGN_OUT_REASON_KEY = "argon.signout_reason";

/**
 * A guard against the one loop a refresh cannot fix on its own: the server renews the token but
 * keeps refusing the session it belongs to. Two renewals inside this window with rejections still
 * arriving means the credentials are not the problem, and the session is treated as ended.
 */
const RENEWAL_LOOP_WINDOW_MS = 60_000;
const RENEWAL_LOOP_LIMIT = 2;

let inFlight: Promise<RecoveryOutcome> | null = null;
let recentRenewals: number[] = [];
let signingOut = false;

/**
 * The server rejected an authenticated call. Decide whether the session can go on.
 *
 * @param source A short label for the log — which path noticed.
 */
export function handleSessionRejected(source: string): Promise<RecoveryOutcome> {
  if (signingOut) return Promise.resolve("signed_out");

  inFlight ??= recover(source).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * The server said, in as many words, that this session is over — the hub told the socket so before
 * closing it. No refresh to try: drop the credentials and return to sign-in.
 *
 * @param reason The code the server sent. Unknown codes are kept as they are and shown generically.
 * @param detail For the log only.
 */
export function forceSignOut(reason: string | undefined, detail: string): void {
  signOutLocally(isKnownReason(reason) ? reason : "session_ended", detail);
}

/**
 * The reason the last sign-out on this device happened, if it was one this module performed and the
 * sign-in screen has not shown it yet. Read once; a second call returns null.
 */
export function consumeSignOutReason(): string | null {
  try {
    const reason = sessionStorage.getItem(SIGN_OUT_REASON_KEY);
    if (reason) sessionStorage.removeItem(SIGN_OUT_REASON_KEY);
    return reason;
  } catch {
    return null;
  }
}

/** The message key for a sign-out reason code, with a generic fallback for a code this build does not know. */
export function signOutReasonMessageKey(reason: string): string {
  switch (reason) {
    case "session_signed_out":
      return "session_ended_remote";
    default:
      return "session_ended_generic";
  }
}

function isKnownReason(reason: string | undefined): reason is SignOutReason {
  return reason === "session_signed_out" || reason === "session_ended";
}

async function recover(source: string): Promise<RecoveryOutcome> {
  const authStore = useAuthStore();

  // Nothing to recover on the sign-in screen: a rejection there is the sign-in itself failing, and
  // it has its own reporting.
  if (!authStore.isAuthenticated || !authStore.token) return "unknown";

  const now = Date.now();
  recentRenewals = recentRenewals.filter((t) => now - t < RENEWAL_LOOP_WINDOW_MS);

  if (recentRenewals.length >= RENEWAL_LOOP_LIMIT) {
    logger.warn(`[session] rejected again after ${recentRenewals.length} renewals in a minute (${source}); the session is over`);
    signOutLocally("session_ended", "renewal loop");
    return "signed_out";
  }

  logger.warn(`[session] the API rejected an authenticated call (${source}); refreshing the token to find out why`);

  try {
    const outcome = isWeb ? await refreshWeb() : await refreshDesktop();

    if (outcome === "renewed") recentRenewals.push(Date.now());
    if (outcome === "signed_out") signOutLocally("session_signed_out", "refresh refused");

    return outcome;
  } catch (e) {
    // The refresh itself was refused at the door — the session id the cookie carries is on the
    // tombstone list, so the server would not even look at the refresh token.
    if (isSessionRejected(e)) {
      signOutLocally("session_signed_out", "refresh rejected");
      return "signed_out";
    }

    // Anything else is the server or the network having a bad minute, and a bad minute is not a
    // reason to destroy credentials. The next rejection asks again.
    logger.warn("[session] could not refresh the token; leaving the session alone", e);
    return "unknown";
  }
}

async function refreshDesktop(): Promise<RecoveryOutcome> {
  const authStore = useAuthStore();
  const api = useApi();

  const result = await withDeviceProof(() =>
    api.identityInteraction.GetMyAuthorization(authStore.token!, authStore.getRefreshToken()),
  );

  if (result.isGoodAuthStatus()) {
    authStore.setAuthToken(result.token);
    useAccounts().updateActiveTokens(result.token);
    metrics.count("auth.token.refresh", { result: "ok" });
    return "renewed";
  }

  if (result.isBadAuthStatus()) {
    metrics.count("auth.token.refresh", { result: "refused" });
    return "signed_out";
  }

  // Locked accounts and refused clients: the boot flow shows those screens; a mid-session
  // rejection has nothing better to add than leaving the state for the next boot to explain.
  metrics.count("auth.token.refresh", { result: "declined" });
  return "unknown";
}

async function refreshWeb(): Promise<RecoveryOutcome> {
  const authStore = useAuthStore();
  const token = await authStore.refreshWebToken();

  if (token) return "renewed";

  // `refreshWebToken` forgets the local marker only on an explicit refusal, so a missing marker
  // afterwards is the server's verdict and everything else was a bad minute.
  return webAuth.hasSession() ? "unknown" : "signed_out";
}

/**
 * Ends the session on this device: the account stays in the picker, marked as needing sign-in, the
 * tokens are dropped, the reason is left for the sign-in screen, and the page reloads so every store
 * starts from nothing. The same landing the boot sequence uses when the server refuses a stored
 * session.
 */
function signOutLocally(reason: SignOutReason, detail: string): void {
  if (signingOut) return;
  signingOut = true;

  logger.warn(`[session] signing out on this device: ${reason} (${detail})`);
  metrics.count("auth.session.check", { result: "rejected" });

  // Marked first, because it decides where the reload lands. A session refused during an account
  // switch does not end the user's day: the account being switched away from is still signed in and
  // gets the pointer back, so there is no sign-in screen to explain anything to and the reason must
  // not be left waiting for the next, unrelated one.
  let outcome: "signed_out" | "reverted" = "signed_out";
  try {
    outcome = useAccounts().markActiveNeedsReauth();
  } catch (e) {
    logger.warn("[session] could not mark the account for re-authentication", e);
  }

  if (outcome === "signed_out") {
    try {
      sessionStorage.setItem(SIGN_OUT_REASON_KEY, reason);
    } catch {
      /* no storage, no message — the sign-out itself does not depend on it */
    }
  }

  useAuthStore().logout();
  location.reload();
}
