/**
 * Reloading a page that outlived its build — and reloading it exactly once.
 *
 * **Both halves are load-bearing.** Without the reload, the first lazy navigation after a deploy
 * dies on a chunk that no longer exists and the user is left on a dead screen with a MIME-type
 * error in a console they do not have open. With an unguarded reload, a chunk that is genuinely
 * missing — a half-landed deploy, a file that really 404s — becomes an infinite refresh, which is
 * worse than the error it replaced because it never stops and nothing can be read on the way past.
 *
 * So the guard is not an optimisation; it is the thing that makes the recovery safe to ship. These
 * tests exist because the failure it prevents cannot be noticed in review: both versions look
 * correct, and only one of them stops.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installStaleBuildRecovery } from "@/lib/staleBuild";

const reload = vi.fn();

/** A rejection as the browser raises it; jsdom has no PromiseRejectionEvent. */
function rejectWith(reason: unknown) {
  const event = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
}

function preloadFailed(payload: unknown) {
  const event = new Event("vite:preloadError", { cancelable: true });
  Object.defineProperty(event, "payload", { value: payload });
  window.dispatchEvent(event);
}

describe("recovering from a stale build", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(window, "location", {
      value: { reload, href: "https://app.test/", pathname: "/" },
      writable: true,
      configurable: true,
    });
    installStaleBuildRecovery(true);
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("reloads when a lazy chunk cannot be fetched", () => {
    preloadFailed(new Error("Failed to fetch dynamically imported module: /assets/Home-abc.js"));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  /**
   * What the browser actually says when the SPA fallback answers a .js request with the document —
   * the wording from the report that prompted all this.
   */
  it("recognises the MIME error the SPA fallback produces", () => {
    rejectWith(new TypeError(
      'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server '
      + 'responded with a MIME type of "text/html".',
    ));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on a failed dynamic import that arrives as a rejection", () => {
    rejectWith(new TypeError("Failed to fetch dynamically imported module: /assets/Chat-9f.js"));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  /** The guard. A second failure straight after the reload means reloading did not help. */
  it("does not reload twice in a row", () => {
    preloadFailed(new Error("Failed to fetch dynamically imported module: /assets/Home-abc.js"));
    preloadFailed(new Error("Failed to fetch dynamically imported module: /assets/Home-abc.js"));
    rejectWith(new TypeError("Failed to fetch dynamically imported module: /assets/Other-def.js"));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("recovers again once the cooldown has passed", () => {
    // As though the last recovery were long enough ago to have been a different incident.
    sessionStorage.setItem("argon.staleBuild.reloadedAt", String(Date.now() - 120_000));

    preloadFailed(new Error("Failed to fetch dynamically imported module: /assets/Home-abc.js"));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  // ── what must never trigger it ────────────────────────────────────────────────────────────

  it.each([
    ["an ordinary application error", new Error("something went wrong")],
    ["a refused request", new Error("Request failed with status 500")],
    ["a network failure", new TypeError("Failed to fetch")],
    ["nothing at all", undefined],
  ])("leaves %s alone", (_label, reason) => {
    rejectWith(reason);

    expect(reload).not.toHaveBeenCalled();
  });

  it("installs nothing off the web, where the bundle is on disk", () => {
    expect(installStaleBuildRecovery(false)).toBe(false);
  });
});
