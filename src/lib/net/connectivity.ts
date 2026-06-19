import { logger } from "@argon/core";

/**
 * Connectivity helpers for the auth / token-exchange path.
 *
 * Two rules this module enforces:
 *  1. We never issue auth requests while the runtime says we're offline — we'd just
 *     hammer a server we can't reach. Instead we park until the connection is back.
 *  2. A request that fails because the connection dropped is a transport failure,
 *     NOT a server verdict. It must read as "try again later", never as "your
 *     session is invalid" — otherwise a flaky network silently logs the user out.
 */

/**
 * The runtime's view of connectivity. A `false` here is authoritative — we are
 * definitely offline. A `true` can be optimistic (an interface is up but has no
 * route to the internet), so callers must still treat a thrown request as a
 * transient failure rather than proof of connectivity.
 */
export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Resolves once the runtime reports connectivity. Returns immediately when already
 * online. While offline it parks on the `online` event (plus a cheap safety-net
 * poll for webviews that don't fire it reliably) instead of spinning — so we issue
 * no network requests at all until the connection is actually back.
 */
export function waitForOnline(signal?: AbortSignal): Promise<void> {
  if (isOnline()) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    logger.info("Offline — parking until the connection returns");

    const cleanup = () => {
      globalThis.removeEventListener?.("online", check);
      clearInterval(poll);
      signal?.removeEventListener("abort", onAbort);
    };
    const check = () => {
      if (!isOnline()) return;
      cleanup();
      logger.info("Connection restored");
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const poll = setInterval(check, 1000);
    globalThis.addEventListener?.("online", check);
    signal?.addEventListener("abort", onAbort);
  });
}

/**
 * Runs an async operation, but only ever while we believe we're online. If it
 * throws *and we've since gone offline*, that's a transport failure: park until
 * the connection returns and retry — never surface it to the caller (which, on the
 * auth path, would tear the session down). A throw while still online is a real
 * error and propagates so the existing backoff/error handling can deal with it.
 */
export async function runWhenOnline<T>(
  op: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  for (;;) {
    await waitForOnline(signal);
    try {
      return await op();
    } catch (e) {
      if (!isOnline()) {
        logger.warn(
          "Request failed as the connection dropped — will retry once online",
          e
        );
        continue;
      }
      throw e;
    }
  }
}
