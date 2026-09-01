/**
 * Page-side control of the browser build's media cache.
 *
 * The caching itself happens in /media-sw.js; this is the half that installs it, asks the browser to
 * treat our storage as worth keeping, and gives the settings screen a way to inspect and empty it.
 * Desktop has its own on-disk cdn cache in the Electron host and never touches any of this.
 */

import { logger } from "@argon/core";
import { isWeb } from "@/lib/platform";
import { cdnCacheEnabled } from "@/store/system/cdnCache";

const SW_URL = "/media-sw.js";

let registration: ServiceWorkerRegistration | null = null;

/**
 * Take the worker back out of the way.
 *
 * A worker that has been unregistered keeps controlling the pages it already controls, so this only
 * takes full effect on the next load — which is why the setting reloads the app when it changes.
 */
async function removeWorker(): Promise<void> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) return;
  await clearMediaCache();
  await existing.unregister();
  logger.info("[media-cache] service worker removed");
}

/**
 * Install the media cache worker.
 *
 * Fire-and-forget by design: a failure here costs cache hits, not function — every request the
 * worker would have served still resolves over the network on its own.
 */
export async function initMediaCache(): Promise<void> {
  if (!isWeb || !("serviceWorker" in navigator)) return;

  // Caching turned off for diagnosis: leave nothing between the page and the CDN, and take away
  // anything a previous session left installed.
  if (!cdnCacheEnabled.value) {
    await removeWorker().catch((e) => logger.warn("[media-cache] could not remove worker", e));
    return;
  }

  try {
    // Persisted storage is what separates "kept until the user clears it" from "kept until the
    // browser needs the space". Chromium grants it silently for installed/engaged origins and
    // refuses quietly otherwise, so there is nothing to handle either way.
    await navigator.storage?.persist?.().catch(() => false);

    registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    logger.info("[media-cache] service worker registered");
  } catch (e) {
    logger.warn("[media-cache] registration failed, falling back to network only", e);
  }
}

function activeWorker(): ServiceWorker | null {
  return navigator.serviceWorker?.controller ?? registration?.active ?? null;
}

/** Drop every cached picture. Used by the storage settings "clear cache" action. */
export async function clearMediaCache(): Promise<void> {
  activeWorker()?.postMessage({ type: "media-cache-clear" });
}

export interface MediaCacheStats {
  entries: number;
  usedBytes: number | null;
}

/** How much the media cache holds, or null when the worker isn't running. */
export async function mediaCacheStats(): Promise<MediaCacheStats | null> {
  const worker = activeWorker();
  if (!worker) return null;

  return new Promise<MediaCacheStats | null>((resolve) => {
    const channel = new MessageChannel();
    // A worker that is being replaced never answers; the app must not wait on it forever.
    const timer = setTimeout(() => resolve(null), 2000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data as MediaCacheStats);
    };
    worker.postMessage({ type: "media-cache-stats" }, [channel.port2]);
  });
}
