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

  // NO_AUTH is what the API's own interceptor answers with — for a missing or expired token, and
  // for a session that was ended from another device. It was not on this list, so a signed-out
  // device read its refusals as a flaky server and kept reconnecting. DEVICE_BANNED is the machine
  // being barred, which no refresh can undo either.
  const code = String(error.error?.code ?? "").toUpperCase();
  if (["UNAUTHORIZED", "FORBIDDEN", "BAD_TOKEN", "SESSION_EXPIRED", "NO_AUTH", "DEVICE_BANNED"].includes(code)) return true;

  // `UPSTREAM_ERROR` is what the client throws when the body was not a protocol error it could
  // read; its message is the bare HTTP status.
  return /\b(401|403)\b/.test(String(error.error?.message ?? ""));
}
