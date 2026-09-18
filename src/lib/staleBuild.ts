/**
 * Recovering from a page that outlived the build it was loaded from.
 *
 * **What goes wrong.** Every lazy route is a separate file whose name carries a content hash, and a
 * deploy replaces the whole set. A document loaded before the deploy — from a tab left open, or
 * from a cached copy — names chunks that no longer exist. Nothing is wrong until the moment someone
 * navigates to a route that was never loaded, and then the import fails:
 *
 *     Failed to load module script: expected a JavaScript module but the server responded
 *     with a MIME type of "text/html"
 *
 * That MIME error is the SPA fallback doing its job. A single-page app asks the host to answer every
 * unmatched path with `index.html` so deep links work, and the host cannot tell a route it should
 * answer that way from a missing asset it should not. So the browser asks for a `.js` and is handed
 * a web page, and says so in the least helpful way available.
 *
 * **What to do about it.** Reload. The document comes back naming the chunks that exist now, and the
 * navigation the user was making completes. There is nothing to repair and nothing to tell them
 * about — the page they wanted is one round trip away.
 *
 * **Except when reloading will not help**, and then it must not be done twice. If the new document
 * is broken too — a deploy that half-landed, an asset that genuinely 404s — an unguarded reload is
 * an infinite refresh, which is worse than an error message because it never stops and takes the
 * console with it. Hence the mark below: one reload per short window, then the failure is left to
 * surface.
 */
import { logger } from "@argon/core";

/**
 * When the last recovery reload happened. In `sessionStorage`, so it dies with the tab — a reload
 * recorded a week ago says nothing about the one being considered now.
 */
const MARK = "argon.staleBuild.reloadedAt";

/**
 * How long a reload counts as "just tried". Long enough to cover the reload and the failing import
 * that follows it, short enough that a genuine staleness hours later is still recovered from.
 */
const COOLDOWN_MS = 30_000;

/**
 * Whether this looks like a chunk that is no longer on the server.
 *
 * Two of the four wordings are proof and two are only evidence. "Expected a JavaScript module
 * script" and the `text/html` MIME complaint mean the server answered and what it answered with was
 * the SPA fallback document — nothing but a build that moved produces that. "Failed to fetch a
 * dynamically imported module" covers a chunk that is gone and a chunk that could not be reached,
 * in the same words, and a reload fixes only the first. When the browser says it has no network,
 * the second is what happened.
 */
function isMissingChunk(reason: unknown): boolean {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? "");

  // What the browser says when the SPA fallback answered a .js request with the document.
  if (/Expected a JavaScript(-or-Wasm)? module script/i.test(text)) return true;
  if (/'text\/html' is not a valid JavaScript MIME type/i.test(text)) return true;

  const couldNotFetch = /Failed to fetch dynamically imported module/i.test(text)
    || /error loading dynamically imported module/i.test(text);

  return couldNotFetch && !isOffline();
}

/**
 * Whether the browser believes it has no network at all.
 *
 * `onLine` is worth exactly this much: false is reliable — the machine has no interface up — while
 * true only means an interface exists. So it is read as a veto and never as permission.
 */
function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function reloadOnce(reason: unknown): void {
  // The mark is not bookkeeping, it is the whole guard: without a record of the last attempt, a
  // chunk that is genuinely missing turns recovery into a refresh that never stops. So storage
  // refusing (private mode, a blocked origin, a full quota) is not something to shrug off and carry
  // on from — it is the one condition under which reloading cannot be made safe, and the failure is
  // left to surface instead.
  let last: number;
  try {
    last = Number(sessionStorage.getItem(MARK) ?? 0);
  } catch (err) {
    logger.error(
      "[stale-build] cannot read the reload mark, so a reload could not be kept to one; leaving the failure alone",
      reason,
      err,
    );
    return;
  }

  // A mark written by something else, or truncated: no usable answer, so treat it as no mark. One
  // reload follows, and it writes a mark that parses.
  if (!Number.isFinite(last)) last = 0;

  if (Date.now() - last < COOLDOWN_MS) {
    logger.error(
      "[stale-build] a chunk is still missing after reloading; leaving the failure alone rather than looping",
      reason,
    );
    return;
  }

  try {
    sessionStorage.setItem(MARK, String(Date.now()));
  } catch (err) {
    logger.error(
      "[stale-build] cannot record the reload mark, so a reload could not be kept to one; leaving the failure alone",
      reason,
      err,
    );
    return;
  }

  logger.warn("[stale-build] this page was loaded from an older build; reloading to pick up the current one", reason);

  // `reload()` rather than assigning to href: it keeps the current URL, so whoever was midway
  // through a navigation lands back where they were.
  window.location.reload();
}

/**
 * Watches for imports that fail because the build moved on.
 *
 * Call once, as early as possible — before any route is loaded, so the very first lazy navigation
 * after a deploy is covered.
 *
 * @returns whether anything was installed; false off the web, where the bundle is on disk and
 *          cannot go missing underneath a running window.
 */
export function installStaleBuildRecovery(isWeb: boolean): boolean {
  if (!isWeb || typeof window === "undefined") return false;

  // Vite's own signal, raised by the preload helper around every lazy import. It is the closest
  // thing to a precise signal — it carries the error the chunk failed with — but it is raised for
  // every reason a preload can fail, not only for a build that moved.
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as unknown as { payload?: unknown }).payload;

    // Anything else is somebody else's failure to report. Left alone, Vite rethrows it and it
    // surfaces the way it would have if none of this were installed — which is what a caller
    // handling its own import errors, and anyone reading a crash report, is entitled to.
    if (!isMissingChunk(payload)) return;

    // Suppressed only now that it is known to be recoverable: without this Vite rethrows, and the
    // rethrow is reported as a crash on the way out of a page that is about to be replaced anyway.
    event.preventDefault();
    reloadOnce(payload);
  });

  // The net under it. A dynamic import made outside Vite's helper, or a module script the browser
  // itself rejected, arrives here instead — same cause, same cure.
  window.addEventListener("unhandledrejection", (event) => {
    if (isMissingChunk(event.reason)) {
      event.preventDefault();
      reloadOnce(event.reason);
    }
  });

  return true;
}
