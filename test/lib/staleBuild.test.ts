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
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { installStaleBuildRecovery } from "@/lib/staleBuild";

const reload = vi.fn();

/** A rejection as the browser raises it; jsdom has no PromiseRejectionEvent. */
function rejectWith(reason: unknown) {
  const event = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(event, "reason", { value: reason });
  window.dispatchEvent(event);
}

/** Returns the event, so a test can ask whether Vite was allowed to rethrow. */
function preloadFailed(payload: unknown): Event {
  const event = new Event("vite:preloadError", { cancelable: true });
  Object.defineProperty(event, "payload", { value: payload });
  window.dispatchEvent(event);
  return event;
}

/**
 * Runs `body` with `sessionStorage` refusing the given operation, the way a browser in private mode
 * or on a blocked origin does — by throwing, not by answering null.
 */
function withStorageRefusing(operation: "getItem" | "setItem", body: () => void) {
  const real = window.sessionStorage;
  const refusing = {
    ...real,
    getItem: (key: string) => {
      if (operation === "getItem") throw new DOMException("denied", "SecurityError");
      return real.getItem(key);
    },
    setItem: (key: string, value: string) => {
      if (operation === "setItem") throw new DOMException("denied", "SecurityError");
      real.setItem(key, value);
    },
    removeItem: (key: string) => real.removeItem(key),
    clear: () => real.clear(),
  };

  Object.defineProperty(window, "sessionStorage", { value: refusing, configurable: true });
  try {
    body();
  } finally {
    Object.defineProperty(window, "sessionStorage", { value: real, configurable: true });
  }
}

/** Runs `body` with the browser reporting no network. */
function whileOffline(body: () => void) {
  const real = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
  try {
    body();
  } finally {
    if (real) Object.defineProperty(Navigator.prototype, "onLine", real);
    Reflect.deleteProperty(navigator, "onLine");
  }
}

describe("recovering from a stale build", () => {
  // Once, not per test: the handlers are added to a `window` that outlives the test, and installing
  // again in `beforeEach` leaves the previous one attached. A file's worth of those turns every
  // event into a stack of handlers, and then "reloaded exactly once" passes because the cooldown
  // caught the other sixteen rather than because one handler ran.
  beforeAll(() => {
    installStaleBuildRecovery(true);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(window, "location", {
      value: { reload, href: "https://app.test/", pathname: "/" },
      writable: true,
      configurable: true,
    });
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

  /**
   * Vite raises `vite:preloadError` for every way a preload can fail, not only for a build that
   * moved. Suppressing all of them made this handler the place other people's errors went to die:
   * `preventDefault()` stops Vite rethrowing, so the caller's own catch never runs and the crash
   * report never gets written.
   */
  describe("a preload failure that is not a stale build", () => {
    it.each([
      ["an ordinary module error", new Error("Cannot read properties of undefined")],
      ["a chunk that returned 500", new Error("Unable to preload CSS for /assets/app-abc.css")],
    ])("leaves %s to Vite", (_label, payload) => {
      const event = preloadFailed(payload);

      expect(reload).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    /**
     * The same words cover a chunk that is gone and a chunk that could not be reached. Reloading an
     * offline tab shows the offline page and burns the one attempt the cooldown allows, so the
     * genuine staleness underneath it — if there is one — is no longer recoverable.
     */
    it("leaves a fetch failure alone while the browser has no network", () => {
      whileOffline(() => {
        const event = preloadFailed(
          new TypeError("Failed to fetch dynamically imported module: /assets/Home-abc.js"),
        );

        expect(reload).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
      });
    });

    it("recovers from that same failure once the network is back", () => {
      preloadFailed(new TypeError("Failed to fetch dynamically imported module: /assets/Home-abc.js"));

      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The mark is the guard, not bookkeeping. Storage that refuses means the next failure would read
   * no mark and reload again, and the one after that, which is the infinite refresh this whole file
   * exists to prevent — so a reload that cannot be remembered must not happen at all.
   */
  describe("when sessionStorage refuses", () => {
    it("does not reload when the mark cannot be read", () => {
      withStorageRefusing("getItem", () => {
        preloadFailed(new Error("Failed to fetch dynamically imported module: /assets/Home-abc.js"));
      });

      expect(reload).not.toHaveBeenCalled();
    });

    it("does not reload when the mark cannot be written", () => {
      withStorageRefusing("setItem", () => {
        preloadFailed(new Error("Failed to fetch dynamically imported module: /assets/Home-abc.js"));
      });

      expect(reload).not.toHaveBeenCalled();
    });

    it("recovers as usual once storage works again", () => {
      preloadFailed(new Error("Failed to fetch dynamically imported module: /assets/Home-abc.js"));

      expect(reload).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("argon.staleBuild.reloadedAt")).not.toBeNull();
    });
  });

  it("installs nothing off the web, where the bundle is on disk", () => {
    expect(installStaleBuildRecovery(false)).toBe(false);
  });
});
