import { openDB, type IDBPDatabase } from "idb";

// The model is fetched once and kept in IndexedDB (as src/workers/predictor.webworker.ts does for
// its tfjs model), keyed by its checksum so a new model replaces the old one instead of piling up.

const DB_NAME = "argon-workbench-models";
const STORE = "models";

export interface ModelRef {
  name: string;
  path: string;
  sha256: string;
  bytes: number;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The whole body, reporting 0–1 as it arrives (against `expected` when there is no length). */
export async function fetchWithProgress(
  url: string,
  options: { expected?: number; onProgress?: (value: number) => void; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ArrayBuffer> {
  const response = await (options.fetchImpl ?? fetch)(url, { signal: options.signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const header = Number(response.headers.get("content-length"));
  const total = header > 0 ? header : (options.expected ?? 0);
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    options.onProgress?.(1);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) options.onProgress?.(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  options.onProgress?.(1);
  return out.buffer;
}

let db: Promise<IDBPDatabase> | null = null;

function openCache(): Promise<IDBPDatabase> {
  db ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    },
  });
  return db;
}

const keyOf = (model: ModelRef) => `${model.name}@${model.sha256}`;

async function readCached(model: ModelRef): Promise<ArrayBuffer | null> {
  try {
    const value = await (await openCache()).get(STORE, keyOf(model));
    return value instanceof ArrayBuffer ? value : null;
  } catch {
    return null;
  }
}

async function writeCached(model: ModelRef, bytes: ArrayBuffer): Promise<void> {
  try {
    const database = await openCache();
    const tx = database.transaction(STORE, "readwrite");
    for (const key of await tx.store.getAllKeys()) {
      if (typeof key === "string" && key.startsWith(`${model.name}@`) && key !== keyOf(model)) await tx.store.delete(key);
    }
    await tx.store.put(bytes, keyOf(model));
    await tx.done;
  } catch {
    // Private windows and full disks: the model still works, it is just fetched again next time.
  }
}

/**
 * The model's bytes, from IndexedDB or from `origin + model.path`; either way checked against
 * its SHA-256, so a truncated download or a stale cache entry is never handed to the runtime.
 */
export async function loadModel(
  model: ModelRef,
  options: { origin: string; onProgress?: (value: number) => void; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<{ bytes: ArrayBuffer; from: "cache" | "network" }> {
  const cached = await readCached(model);
  if (cached && (await sha256Hex(cached)) === model.sha256) {
    options.onProgress?.(1);
    return { bytes: cached, from: "cache" };
  }
  const bytes = await fetchWithProgress(new URL(model.path, options.origin).toString(), {
    expected: model.bytes,
    onProgress: options.onProgress,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
  const hash = await sha256Hex(bytes);
  if (hash !== model.sha256) throw new Error(`${model.name}: checksum mismatch (${hash})`);
  await writeCached(model, bytes);
  return { bytes, from: "network" };
}
