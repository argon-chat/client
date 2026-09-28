import type { Guid } from "@argon-chat/ion.webcore";
import { logger } from "@argon/core";
import { currentDbName, db, type StoredUpload } from "@/store/db/dexie";

/**
 * What this account has already put on the server, by the hash of the bytes. The same file picked,
 * dropped or pasted again is then sent as a copy of that upload — `AttachExistingFile` — rather than
 * as bytes, which is the whole difference between pasting one screenshot into five channels and
 * storing it five times.
 *
 * A device-local memory, on purpose: it answers without a round trip, and it never says anything
 * about files the account did not upload itself. Entries age out, and an entry the server no longer
 * honours is dropped the moment it says so.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 2000;
const PRUNE_EVERY = 50;

const memory = new Map<string, StoredUpload>();
let writesSincePrune = 0;

export type UploadRecord = Omit<StoredUpload, "uploadedAt">;

export async function findUpload(sha256: string): Promise<StoredUpload | null> {
  const key = memoryKey(sha256);
  const cached = memory.get(key);
  if (cached) return fresh(cached) ? cached : (memory.delete(key), null);

  try {
    const row = await db.uploadedFiles.get(sha256);
    if (!row) return null;
    if (!fresh(row)) {
      await db.uploadedFiles.delete(sha256);
      return null;
    }
    memory.set(key, row);
    return row;
  } catch (e) {
    logger.debug("upload pool unavailable", e);
    return null;
  }
}

export async function rememberUpload(record: UploadRecord): Promise<void> {
  const row: StoredUpload = { ...record, uploadedAt: Date.now() };
  memory.set(memoryKey(record.sha256), row);

  try {
    await db.uploadedFiles.put(row);
    if (++writesSincePrune >= PRUNE_EVERY) {
      writesSincePrune = 0;
      await prune();
    }
  } catch (e) {
    logger.debug("upload pool write failed", e);
  }
}

export async function forgetUpload(sha256: string): Promise<void> {
  memory.delete(memoryKey(sha256));
  try {
    await db.uploadedFiles.delete(sha256);
  } catch {
    /* memory is already clean */
  }
}

/** For tests and account switches: the in-memory half only; the database is the account's own. */
export function resetUploadPoolMemory(): void {
  memory.clear();
  writesSincePrune = 0;
}

async function prune(): Promise<void> {
  const cutoff = Date.now() - TTL_MS;
  await db.uploadedFiles.where("uploadedAt").below(cutoff).delete();

  const excess = (await db.uploadedFiles.count()) - MAX_ROWS;
  if (excess > 0) {
    const oldest = await db.uploadedFiles.orderBy("uploadedAt").limit(excess).primaryKeys();
    await db.uploadedFiles.bulkDelete(oldest);
  }
}

function fresh(row: StoredUpload): boolean {
  return Date.now() - row.uploadedAt < TTL_MS;
}

// The memory half is keyed by database too, so a switch of account never answers from the last one's.
function memoryKey(sha256: string): string {
  return `${currentDbName()}|${sha256}`;
}

export type { Guid };
