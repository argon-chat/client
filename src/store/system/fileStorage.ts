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

export function cdnUrl(fileId: string): string {
  if (isNative) return `app://cdn/${fileId}`;
  return `https://cdn.argon.gl/${fileId}`;
}

export async function getStorageUsageReport(): Promise<StorageUsageReport> {
  let quota: number | null = null;
  let storageUsed: number | null = null;

  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quota = typeof est.quota === "number" ? est.quota : null;
      storageUsed = typeof est.usage === "number" ? est.usage : null;
    }
  } catch {}

  const groupEntries: Array<{ name: string; usedBytes: number }> = [];

  if (isNative) {
    try {
      const stats = await (window as any).argonIpc.invoke("CdnCache", "stats", []);
      groupEntries.push({ name: "cdnCache", usedBytes: stats?.totalSize ?? 0 });
    } catch {}
  }

  const groupsTotalUsed = groupEntries.reduce((s, g) => s + g.usedBytes, 0);

  const groups: GroupReport[] = groupEntries.map((g) => ({
    name: g.name,
    usedBytes: g.usedBytes,
    percentOfQuota:
      quota && quota > 0 ? round2((g.usedBytes / quota) * 100) : null,
    percentOfGroupsTotal:
      groupsTotalUsed > 0 ? round2((g.usedBytes / groupsTotalUsed) * 100) : 0,
  }));

  const totalFree =
    quota != null
      ? Math.max(0, quota - (storageUsed != null ? storageUsed : groupsTotalUsed))
      : null;

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
