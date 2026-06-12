import { Guid } from "@argon-chat/ion.webcore";
import { logger } from "@argon/core";

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

export function cdnUrl(fileId: string, spaceId: Guid | null = null): string {
  if (isNative) {
    if (spaceId )
      return `app://cdn/s/${spaceId}/banner/${fileId}`;
    else 
      return `app://cdn/${fileId}`;
  }
  return `https://cdn.argon.gl/${fileId}`;
}

/**
 * Resolve URL for message attachments.
 * Uses server-provided downloadUrl when available; falls back to legacy cdnUrl(fileId).
 * In native (Electron), routes geo-CDN URLs through app://cdn-proxy/ for local caching.
 */
export function resolveAttachmentUrl(fileId: string, downloadUrl: string | null | undefined): string {
  if (downloadUrl) {
    if (isNative) return `app://cdn-proxy/${encodeURIComponent(downloadUrl)}`;
    return downloadUrl;
  }
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

  let quota: number | null = null;
  let storageUsed: number | null = null;

  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quota = typeof est.quota === "number" ? est.quota : null;
      storageUsed = typeof est.usage === "number" ? est.usage : null;
    }
  } catch {}

  const totalFree =
    quota != null && storageUsed != null ? Math.max(0, quota - storageUsed) : null;

  return { quotaBytes: quota, storageUsedBytes: storageUsed, totalFreeBytes: totalFree, groups: [] };
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
