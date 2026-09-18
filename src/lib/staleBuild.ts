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

/** Whether this looks like a chunk that is no longer on the server. */
function isMissingChunk(reason: unknown): boolean {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason ?? "");

  return /Failed to fetch dynamically imported module/i.test(text)
    || /error loading dynamically imported module/i.test(text)
    // What the browser says when the SPA fallback answered a .js request with the document.
    || /Expected a JavaScript(-or-Wasm)? module script/i.test(text)
    || /'text\/html' is not a valid JavaScript MIME type/i.test(text);
}

function reloadOnce(reason: unknown): void {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(MARK) ?? 0);
  } catch {
    // Storage refused (private mode, a blocked origin). Treating that as "not recently" risks one
    // extra reload and never a loop, because the failure has to recur for it to happen again.
  }

  if (Date.now() - last < COOLDOWN_MS) {
    logger.error(
      "[stale-build] a chunk is still missing after reloading; leaving the failure alone rather than looping",
      reason,
    );
    return;
  }

  try {
    sessionStorage.setItem(MARK, String(Date.now()));
  } catch {
    /* see above */
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

  // Vite's own signal, raised by the preload helper around every lazy import. It is the precise
  // one: it fires for exactly this failure and carries the chunk that could not be loaded.
  window.addEventListener("vite:preloadError", (event) => {
    // Without this Vite rethrows, which would reach the unhandled-rejection handler below and be
    // reported as a crash on the way out of a page that is about to be replaced anyway.
    event.preventDefault();
    reloadOnce((event as unknown as { payload?: unknown }).payload ?? "vite:preloadError");
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
