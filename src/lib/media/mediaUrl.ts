import { logger } from "@argon/core";
import { cdnFetchUrl } from "@/store/system/fileStorage";

/**
 * The address a video plays from: the file's direct regional storage URL, asked of
 * `GET {api}/files/{id}/url` (`{ url, ttlSeconds }`).
 *
 * A `<video>` reads its file in byte ranges, a request per seek and per buffered stretch. Through
 * `{api}/files/{id}` every one of them is a 302 the browser may not cache, and Electron's `app://cdn`
 * cannot answer a range at all — so playback goes straight to storage and never through either.
 *
 * Answers are kept for their ttl (less a margin) and concurrent asks for one file share a request,
 * which gives up after 8 s. When the endpoint fails the redirecting `{api}/files/{id}` stands in,
 * briefly — on the desktop too, never `app://`.
 */

interface Entry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();

/** How long a fallback stands before the endpoint is asked again. */
const FALLBACK_TTL_MS = 30_000;
/** Every asker shares the one request: a hung one must not hold them all. */
const REQUEST_TIMEOUT_MS = 8_000;
const MIN_TTL_MS = 5_000;
const MAX_ENTRIES = 256;

export function resolveMediaUrl(fileId: string): Promise<string> {
  const hit = cache.get(fileId);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);
  const pending = inflight.get(fileId);
  if (pending) return pending;
  const request = ask(fileId).finally(() => inflight.delete(fileId));
  inflight.set(fileId, request);
  return request;
}

/** Forget a file's URL (it stopped working), so the next ask goes to the server. */
export function invalidateMediaUrl(fileId: string): void {
  cache.delete(fileId);
}

/** Tests. */
export function clearMediaUrlCache(): void {
  cache.clear();
  inflight.clear();
}

async function ask(fileId: string): Promise<string> {
  const fallback = cdnFetchUrl(fileId);
  try {
    const resp = await fetch(`${fallback}/url`, { credentials: "omit", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = (await resp.json()) as { url?: unknown; ttlSeconds?: unknown };
    if (typeof body?.url !== "string" || !body.url) throw new Error("no url in the answer");
    const url = new URL(body.url, fallback);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`refused scheme ${url.protocol}`);
    const ttl = typeof body.ttlSeconds === "number" && body.ttlSeconds > 0 ? body.ttlSeconds : 60;
    remember(fileId, url.toString(), Math.max(MIN_TTL_MS, (ttl - Math.min(30, ttl / 2)) * 1000));
    return url.toString();
  } catch (e) {
    logger.warn("[media] no direct url, playing through the file redirect", e);
    remember(fileId, fallback, FALLBACK_TTL_MS);
    return fallback;
  }
}

function remember(fileId: string, url: string, ttlMs: number) {
  if (cache.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  }
  cache.set(fileId, { url, expiresAt: Date.now() + ttlMs });
}
