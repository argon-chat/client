import { ByteLru } from "./lru";

const MiB = 1024 * 1024;

/**
 * Sticker/emoji file bytes by fileId. Files are content-addressed, so an entry never goes stale.
 * The disk cache is below this (the media service worker on web, Electron's own on desktop); this
 * one saves the fetch and the copy out of it while the same sticker is scrolled past again.
 */
export const bytesCache = new ByteLru<string, ArrayBuffer>({
  maxEntries: 32,
  maxBytes: 16 * MiB,
  sizeOf: (buffer) => buffer.byteLength,
});

const inflight = new Map<string, Promise<ArrayBuffer>>();

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`expression fetch failed: ${response.status}`);
  return response.arrayBuffer();
}

/**
 * The file's bytes. Concurrent calls for one fileId share a request. `fallbackUrl` is tried when
 * `url` cannot be fetched at all (an older desktop shell refusing fetch on its `app://` scheme).
 *
 * The returned buffer is the cached one: post it (structured clone copies), never transfer it.
 */
export function loadExpressionBytes(fileId: string, url: string, fallbackUrl?: string | null): Promise<ArrayBuffer> {
  const cached = bytesCache.get(fileId);
  if (cached) return Promise.resolve(cached);

  let promise = inflight.get(fileId);
  if (!promise) {
    promise = fetchBytes(url)
      .catch((err) => {
        if (fallbackUrl && fallbackUrl !== url && err instanceof TypeError) return fetchBytes(fallbackUrl);
        throw err;
      })
      .then((buffer) => {
        bytesCache.set(fileId, buffer);
        return buffer;
      })
      .finally(() => inflight.delete(fileId));
    inflight.set(fileId, promise);
  }
  return promise;
}

/**
 * First frames, kept so a sticker scrolled back into view shows at once instead of its outline
 * while its player loads. One per fileId and tone, the largest seen.
 */
export const previewCache = new ByteLru<string, ImageBitmap>({
  maxEntries: 64,
  maxBytes: 8 * MiB,
  sizeOf: (bitmap) => bitmap.width * bitmap.height * 4,
  onEvict: (bitmap) => bitmap.close?.(),
});

export function previewKey(fileId: string, toneIndex?: number | null): string {
  return `${fileId}-${toneIndex ?? 0}`;
}

export function getPreview(fileId: string, toneIndex?: number | null): ImageBitmap | undefined {
  return previewCache.get(previewKey(fileId, toneIndex));
}

/** Takes ownership of `bitmap`: it is kept or closed. */
export function putPreview(fileId: string, toneIndex: number | null | undefined, bitmap: ImageBitmap): void {
  const key = previewKey(fileId, toneIndex);
  const current = previewCache.peek(key);
  if (current && current.width >= bitmap.width && current.height >= bitmap.height) {
    bitmap.close?.();
    return;
  }
  if (!previewCache.set(key, bitmap)) bitmap.close?.();
}
