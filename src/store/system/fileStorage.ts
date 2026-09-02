import { Guid } from "@argon-chat/ion.webcore";
import { logger } from "@argon/core";
import { useInstance } from "@/store/system/instanceStore";
import { useConfig } from "@/store/system/remoteConfig";
import { isWeb } from "@/lib/platform";
import { clearMediaCache, mediaCacheStats } from "@/lib/webMediaCache";
import { cdnCacheEnabled } from "@/store/system/cdnCache";

export type GroupReport = {
  name: string;
  usedBytes: number;
  percentOfQuota: number | null;
  percentOfGroupsTotal: number;
};

export type StorageUsageReport = {
  quotaBytes: number | null;
  storageUsedBytes: number | null;
  totalFreeBytes: number | null;
  groups: GroupReport[];
};

const isNative = typeof window !== "undefined" && "argonIpc" in window;

/**
 * Every file (avatar / banner / attachment) resolves to a single region-agnostic, by-fileId URL on
 * THIS instance's API: `{apiEndpoint}/files/{fileId}`. The API 302s it to the nearest reachable
 * regional mirror at fetch time (geo decided then, never baked in), so a transient VPN/region can't
 * pin a dead cross-region URL. The api base comes from the client's own config, so self-hosted
 * instances point at their own server automatically. `spaceId` is no longer needed (the server
 * resolves the S3 key from the fileId) — kept for call-site compatibility.
 */
export function cdnUrl(fileId: string, _spaceId: Guid | null = null): string {
  const full = `${apiBase()}/files/${fileId}`;

  // Caching turned off for diagnosis — ask the server directly, so what is drawn is its answer and
  // not something kept from an earlier one. See `cdnCacheEnabled`.
  if (!cdnCacheEnabled.value) return full;

  const inst = useInstance();
  // Official native → the dedicated app://cdn cache (Electron resolves it against the official API
  // file-redirect and caches the resolved bytes under a stable, region-independent key).
  if (isNative && inst.isOfficial)
    return `app://cdn/${fileId}`;
  // Self-hosted/managed native → cache locally against THIS instance's API via the generic
  // app://cdn-proxy interceptor (cache key is the stable api URL, so no region poisoning).
  if (isNative)
    return `app://cdn-proxy/${encodeURIComponent(full)}`;
  return full;
}

/**
 * The same file, as a plain https URL on this instance's API — no `app://` wrapper.
 *
 * `cdnUrl` hands Electron its own caching schemes, which are meant for an `<img>` and not for
 * `fetch`. Code that has to read the bytes (rather than display them) asks for this instead.
 */
export function cdnFetchUrl(fileId: string): string {
  return `${apiBase()}/files/${fileId}`;
}

function apiBase(): string {
  return useConfig().apiEndpoint.replace(/\/+$/, "");
}

/**
 * Resolve URL for message attachments. We deliberately IGNORE any server-provided downloadUrl and
 * build from the fileId instead: building from the stable fileId means a stale URL that was cached
 * into chat history (e.g. during a VPN blip) can never poison rendering — the region is always
 * resolved fresh by the API redirect.
 */
export function resolveAttachmentUrl(fileId: string, _downloadUrl?: string | null): string {
  return cdnUrl(fileId);
}

/** Single source of truth for the on-disk userData breakdown (native only). */
type StorageBreakdown = { categories: Array<{ name: string; bytes: number }>; totalBytes: number };

export async function getStorageUsageReport(): Promise<StorageUsageReport> {
  // Native: walk the real userData footprint (cdn-cache + HTTP cache + IndexedDB
  // + service worker + shaders…). navigator.storage.estimate() can't see most of
  // these, so on desktop it badly undercounts — we replace it entirely.
  if (isNative) {
    try {
      const res = (await (window as any).argonIpc.invoke(
        "Storage",
        "breakdown",
        [],
      )) as StorageBreakdown;

      const total = res.categories.reduce((s, c) => s + (c.bytes || 0), 0);
      const groups: GroupReport[] = res.categories.map((c) => ({
        name: c.name,
        usedBytes: c.bytes,
        percentOfQuota: null,
        percentOfGroupsTotal: total > 0 ? round2((c.bytes / total) * 100) : 0,
      }));

      // No meaningful quota for an app cache — leave it null so UsageStatus
      // renders a proportional "what eats space" breakdown instead of a
      // misleading bar against the whole system drive.
      return { quotaBytes: null, storageUsedBytes: res.totalBytes, totalFreeBytes: null, groups };
    } catch {
      // fall through to the web estimate() path on RPC failure
    }
  }

  const groups: GroupReport[] = [];
  let quota: number | null = null;
  let storageUsed: number | null = null;

  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quota = typeof est.quota === "number" ? est.quota : null;
      storageUsed = typeof est.usage === "number" ? est.usage : null;
    }
  } catch {}

  // On the web the pictures live in a bucket of their own, which is the one part of the footprint
  // that can be named and cleared on its own — worth showing separately from the total.
  if (isWeb) {
    const media = await mediaCacheStats();
    if (media)
      groups.push({
        name: "Media cache",
        usedBytes: media.usedBytes ?? 0,
        percentOfQuota:
          quota && media.usedBytes ? round2((media.usedBytes / quota) * 100) : null,
        percentOfGroupsTotal: 100,
      });
  }

  const totalFree =
    quota != null && storageUsed != null ? Math.max(0, quota - storageUsed) : null;

  return { quotaBytes: quota, storageUsedBytes: storageUsed, totalFreeBytes: totalFree, groups };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export const pruneAll = async (pruneLocalStorage = true) => {
  await pruneIndexDb();
  await pruneBuckets();
  await pruneCache();
  if (pruneLocalStorage) localStorage.clear();
  location.reload();
};

export const pruneIndexDb = async () => {
  const allIndexDbs = await indexedDB.databases();
  for (const db of allIndexDbs) {
    try { indexedDB.deleteDatabase(db.name ?? ""); } catch (e) { logger.error(e); }
  }
};

/**
 * Clear a single storage category by name (native only).
 * `database` clears IndexedDB and requires a reload to drop open connections —
 * the caller is responsible for reloading.
 */
export const pruneStorageCategory = async (category: string) => {
  if (!isNative) return;
  try {
    await (window as any).argonIpc.invoke("Storage", "clear", [category]);
  } catch (e) {
    logger.error(e);
  }
};

export const pruneCache = async () => {
  if (isNative) {
    try { await (window as any).argonIpc.invoke("CdnCache", "clear", []); } catch (e) { logger.error(e); }
  }
  // The web's equivalent of that on-disk cdn cache: a bucket the service worker owns, which the
  // page cannot reach directly.
  if (isWeb) {
    try { await clearMediaCache(); } catch (e) { logger.error(e); }
  }
  if ("caches" in window) {
    const allCaches = await window.caches.keys();
    for (const storage of allCaches) {
      try { await window.caches.delete(storage); } catch (e) { logger.error(e); }
    }
  }
};

export const pruneBuckets = async () => {
  if (!navigator.storageBuckets) return;
  const allStorages = await navigator.storageBuckets.keys();
  for (const storage of allStorages) {
    try { await navigator.storageBuckets.delete(storage); } catch (e) { logger.error(e); }
  }
};
