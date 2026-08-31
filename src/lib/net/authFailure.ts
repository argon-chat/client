import { IonRequestException } from "@argon-chat/ion.webcore";

/**
 * Did the server say this session is over, or did it merely fail to answer?
 *
 * The distinction decides whether credentials are destroyed. A request can fail for a dozen reasons
 * that have nothing to do with who is asking — a silo restarting, a gateway timing out, a request
 * blocked before it left the browser — and treating any of them as "you are signed out" turns a bad
 * minute on the server into a forced sign-in for everyone who happened to be starting the app.
 *
 * Only an explicit verdict counts: an authorization error named by the server, or the transport's
 * fallback for one, which carries nothing but the status code.
 */
export function isSessionRejected(error: unknown): boolean {
  if (!(error instanceof IonRequestException)) return false;

  const code = String(error.error?.code ?? "").toUpperCase();
  if (["UNAUTHORIZED", "FORBIDDEN", "BAD_TOKEN", "SESSION_EXPIRED"].includes(code)) return true;

  // `UPSTREAM_ERROR` is what the client throws when the body was not a protocol error it could
  // read; its message is the bare HTTP status.
  return /\b(401|403)\b/.test(String(error.error?.message ?? ""));
}
