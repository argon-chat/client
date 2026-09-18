/**
 * Which failures mean "this session is over" — the first link in the recovery chain.
 *
 * **Why the list matters more than it looks.** On the web the credential is a short-lived cookie, so
 * a page that has been sitting idle will routinely present nothing and be refused. That refusal is
 * the *normal* way a web session learns it needs renewing, and everything downstream hangs off this
 * one predicate: recognised, and the app quietly refreshes and carries on; unrecognised, and the
 * call just fails, the tab keeps failing every poll, and only a reload fixes it. That exact
 * behaviour shipped once, when the server answered a missing credential with a 500 instead of
 * `NO_AUTH`.
 *
 * The other half is the opposite mistake. A silo restarting, a gateway timing out, a request that
 * never left the browser — treating any of those as a verdict turns a bad minute on the server into
 * a forced sign-in for everyone who happened to be starting the app. So the rule is: only an
 * explicit answer from the server counts.
 */
import { describe, it, expect } from "vitest";
import { IonRequestException } from "@argon-chat/ion.webcore";
import { isSessionRejected } from "@/lib/net/authFailure";

const refusedWith = (code: string, message = "") =>
  new IonRequestException({ code, message } as any);

describe("telling a refused session from a bad minute", () => {
  /** What the API's own interceptor answers when a call carries no usable credential. */
  it("recognises NO_AUTH", () => {
    expect(isSessionRejected(refusedWith("NO_AUTH"))).toBe(true);
  });

  it.each(["UNAUTHORIZED", "FORBIDDEN", "BAD_TOKEN", "SESSION_EXPIRED", "DEVICE_BANNED"])(
    "recognises %s",
    (code) => {
      expect(isSessionRejected(refusedWith(code))).toBe(true);
    },
  );

  it("does not care how the server spelled the code", () => {
    expect(isSessionRejected(refusedWith("no_auth"))).toBe(true);
  });

  /** The transport's fallback when the body was not a protocol error it could read. */
  it("reads a bare status out of an upstream error", () => {
    expect(isSessionRejected(refusedWith("UPSTREAM_ERROR", "no buffer return, status: 401"))).toBe(true);
    expect(isSessionRejected(refusedWith("UPSTREAM_ERROR", "no buffer return, status: 403"))).toBe(true);
  });

  // ── the half that must stay false ─────────────────────────────────────────────────────────

  /**
   * The failure that started this: a missing credential answered as a server fault. It is not a
   * verdict, so it must not read as one — the fix was to stop the server sending it at all.
   */
  it("does not treat an internal error as a verdict", () => {
    expect(isSessionRejected(refusedWith("INTERNAL_ERROR", "An internal error occurred."))).toBe(false);
  });

  it.each([
    ["UPSTREAM_ERROR", "no buffer return, status: 500"],
    ["UPSTREAM_ERROR", "no buffer return, status: 503"],
    ["TIMEOUT", "the silo did not answer"],
  ])("does not sign anyone out over %s (%s)", (code, message) => {
    expect(isSessionRejected(refusedWith(code, message))).toBe(false);
  });

  it("ignores anything that is not a protocol error at all", () => {
    expect(isSessionRejected(new TypeError("Failed to fetch"))).toBe(false);
    expect(isSessionRejected("401")).toBe(false);
    expect(isSessionRejected(null)).toBe(false);
    expect(isSessionRejected(undefined)).toBe(false);
  });
});
