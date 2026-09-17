/**
 * A signing key this browser cannot give away.
 *
 * **What it is for.** A session cookie is a bearer thing: whoever holds the bytes is the session,
 * wherever they are. Device Bound Session Credentials fix that by making renewal require a
 * signature from a key held by the platform — but DBSC is Chromium-only, and Firefox and Safari
 * have no equivalent. This is the same shape, built from what every browser does have.
 *
 * **The one primitive that matters** is `extractable: false`. A key generated that way can be
 * stored, structured-cloned into IndexedDB and used to sign, but `exportKey` on it throws and there
 * is no other route from a `CryptoKey` to its bytes. So a script — ours, or one that should not be
 * running — can sign *here*, and cannot produce anything that would let it sign somewhere else.
 * That is what turns a stolen cookie from a portable credential into one that expires in minutes.
 *
 * **What it does not do**, and the reason DBSC exists anyway: the key lives in the browser profile,
 * on disk, under the browser's protection rather than the TPM's. Malware reading that profile takes
 * it along with everything else. This closes the remote half of the problem — exfiltration through
 * a page, a log, a proxy — and not the local half.
 *
 * The wire format is DBSC's own, so the server verifies these proofs with the same code that
 * verifies Chromium's: a JWS with `typ: "dbsc+jwt"`, the challenge in `jti`, ES256 over P-256. That
 * is not a coincidence worth losing — WebCrypto's ECDSA output is raw `r || s`, which is precisely
 * what JWS ES256 specifies, so no conversion sits between the two.
 */
import { logger } from "@argon/core";

/** The JWS `typ` the server requires; a token without it is not accepted as a device proof. */
const PROOF_TYPE = "dbsc+jwt";

const DB_NAME = "argon-device-binding";
const DB_VERSION = 1;
const STORE = "keys";

/** One key per browser profile, under a fixed name: the session is bound to the browser, not the tab. */
const KEY_ID = "session-binding";

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNING = { name: "ECDSA", hash: "SHA-256" } as const;

/** The members the server hashes for a thumbprint, and nothing else. */
export interface DeviceJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

// ── encoding ──────────────────────────────────────────────────────────────────────────────────

const base64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  // Chunked: String.fromCharCode(...view) blows the argument limit on anything sizeable, and while
  // a signature never is, this also encodes the header and payload.
  for (let i = 0; i < view.length; i += 0x8000)
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const encodeJson = (value: unknown): string => base64url(new TextEncoder().encode(JSON.stringify(value)));

// ── the proof ─────────────────────────────────────────────────────────────────────────────────

/**
 * Signs one challenge.
 *
 * @param jwk Sent in the header on registration, where the key is new and the server has no copy;
 *            omitted on refresh, where including it would invite the server to trust the key the
 *            caller presents rather than the one it stored.
 */
export async function signProof(
  key: CryptoKeyPair,
  challenge: string,
  jwk?: DeviceJwk,
): Promise<string> {
  const header = encodeJson(jwk ? { alg: "ES256", typ: PROOF_TYPE, jwk } : { alg: "ES256", typ: PROOF_TYPE });
  const payload = encodeJson({ jti: challenge });
  const signed = `${header}.${payload}`;

  const signature = await crypto.subtle.sign(SIGNING, key.privateKey, new TextEncoder().encode(signed));

  // Raw r||s, which is what JWS ES256 is. No DER unwrapping: WebCrypto does not produce DER here.
  return `${signed}.${base64url(signature)}`;
}

/** The public half, trimmed to the members the server canonicalises over. */
export async function publicJwk(key: CryptoKeyPair): Promise<DeviceJwk> {
  const exported = await crypto.subtle.exportKey("jwk", key.publicKey);

  return { kty: "EC", crv: "P-256", x: exported.x!, y: exported.y! };
}

// ── storage ───────────────────────────────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * The key this browser signs with, made on first use.
 *
 * @returns null where there is nothing to build on — no IndexedDB, no WebCrypto, or a private mode
 *          that refuses storage. The caller carries on unbound rather than failing a sign-in over a
 *          hardening measure.
 */
export async function deviceKey(): Promise<CryptoKeyPair | null> {
  if (typeof indexedDB === "undefined" || typeof crypto?.subtle === "undefined") {
    logger.warn("[device-key] this browser has no IndexedDB or WebCrypto; the session cannot be bound");
    return null;
  }

  try {
    const db = await openDb();

    const stored = await transact<CryptoKeyPair | undefined>(db, "readonly", (s) => s.get(KEY_ID));

    // A stored pair whose private half is extractable was written by something other than this code
    // and is not worth the name — regenerate rather than bind to a key that can be copied.
    if (stored?.privateKey && !stored.privateKey.extractable) return stored;

    const generated = await crypto.subtle.generateKey(ALGORITHM, false, ["sign", "verify"]);

    await transact(db, "readwrite", (s) => s.put(generated, KEY_ID));

    return generated;
  } catch (e) {
    logger.warn("[device-key] could not open or create the device key; the session stays unbound", e);
    return null;
  }
}

/** Drops the key, so the next sign-in binds to a new one. Part of signing out. */
export async function forgetDeviceKey(): Promise<void> {
  if (typeof indexedDB === "undefined") return;

  try {
    const db = await openDb();
    await transact(db, "readwrite", (s) => s.delete(KEY_ID));
  } catch (e) {
    logger.warn("[device-key] could not drop the device key", e);
  }
}
