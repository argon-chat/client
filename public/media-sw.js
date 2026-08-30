/* eslint-disable no-restricted-globals */
/**
 * Media cache for the browser build.
 *
 * Avatars, banners and attachments are served from `{api}/files/{fileId}` — content-addressed, so a
 * given URL's bytes never change. That makes them worth keeping hard: once a file has been read it
 * should never be fetched again, not on the next view, not on the next session, not after the tab
 * has been asleep for a day. The HTTP cache will not promise that (it is shared, small, and evicted
 * on whatever grounds the browser likes), so the bytes live in a storage bucket of their own instead
 * — a quota Argon owns, persisted, with its own eviction policy, separate from the app's database so
 * that clearing pictures never threatens the message cache.
 *
 * Sitting in a service worker rather than in the app means `<img src>` and `fetch` are both covered
 * without a single call site knowing about it.
 *
 * Not bundled — served verbatim from /media-sw.js. Plain JS, no imports.
 */

const BUCKET_NAME = "argon-media";
const CACHE_NAME = "media-v1";

/** Above this many entries the oldest are dropped. Cache keys come back in insertion order. */
const MAX_ENTRIES = 4000;
/** Trimming walks every key, so it is not done on every write. */
const TRIM_EVERY = 50;

let writesSinceTrim = 0;
let cachePromise = null;

/**
 * The bucket cache, opened once.
 *
 * A bucket can be evicted wholesale by the browser, which makes an already-opened handle useless;
 * the memoized promise is therefore dropped on failure so the next request opens a fresh one rather
 * than inheriting a dead one forever.
 */
function mediaCache() {
  if (!cachePromise) {
    cachePromise = (async () => {
      const buckets = self.navigator.storageBuckets;
      if (!buckets) throw new Error("storage buckets unavailable");
      const bucket = await buckets.open(BUCKET_NAME, {
        durability: "relaxed", // pictures — losing the last write on a crash costs one refetch
        persisted: true,
      });
      return bucket.caches.open(CACHE_NAME);
    })().catch((e) => {
      cachePromise = null;
      throw e;
    });
  }
  return cachePromise;
}

/** Is this a request for an immutable media file? */
function isMediaRequest(request) {
  if (request.method !== "GET") return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  // `{apiEndpoint}/files/{fileId}` — the one canonical, region-agnostic media URL the client builds.
  if (/\/files\/[^/]+$/.test(url.pathname)) return true;
  // Regional mirrors, when a redirect has already been resolved into a direct URL.
  if (/(^|\.)cdn\.argon\.gl$/i.test(url.hostname)) return true;
  return false;
}

async function trimIfNeeded(cache) {
  writesSinceTrim += 1;
  if (writesSinceTrim < TRIM_EVERY) return;
  writesSinceTrim = 0;
  const keys = await cache.keys();
  if (keys.length <= MAX_ENTRIES) return;
  const excess = keys.length - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

async function respondFromCache(request) {
  let cache = null;
  try {
    cache = await mediaCache();
    // `ignoreSearch`: the same file is sometimes asked for with a cache-busting query attached, and
    // the bytes behind the fileId are the same either way.
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
  } catch {
    // No bucket — fall through and behave like a plain pass-through fetch.
  }

  const response = await fetch(request);
  // Only complete, readable responses are worth keeping: an opaque cross-origin response cannot be
  // measured against the quota and a partial one would be served later as if it were whole.
  if (cache && response.ok && response.status === 200 && response.type !== "opaque") {
    const copy = response.clone();
    // Deliberately not awaited: the picture should paint now, not after the write lands.
    void cache
      .put(request, copy)
      .then(() => trimIfNeeded(cache))
      .catch(() => {});
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (!isMediaRequest(event.request)) return; // everything else goes to the network untouched
  event.respondWith(respondFromCache(event.request));
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === "media-cache-clear") {
    event.waitUntil(
      (async () => {
        try {
          const bucket = await self.navigator.storageBuckets.open(BUCKET_NAME);
          await bucket.caches.delete(CACHE_NAME);
        } catch {
          /* nothing to clear */
        } finally {
          cachePromise = null;
        }
      })(),
    );
    return;
  }

  if (data.type === "media-cache-stats" && event.ports?.[0]) {
    const port = event.ports[0];
    event.waitUntil(
      (async () => {
        try {
          const cache = await mediaCache();
          const keys = await cache.keys();
          const estimate = await self.navigator.storage?.estimate?.();
          port.postMessage({ entries: keys.length, usedBytes: estimate?.usage ?? null });
        } catch {
          port.postMessage({ entries: 0, usedBytes: null });
        }
      })(),
    );
  }
});
