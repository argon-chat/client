/** Above this the bytes are not hashed: the server never reads such an object back either (Dedup:MaxVerifyBytes). */
export const HASH_MAX_BYTES = 64 * 1024 * 1024;

/** SHA-256 of a file as lower-case hex, or null when it is too large to be worth it. */
export async function sha256Hex(blob: Blob): Promise<string | null> {
  if (blob.size > HASH_MAX_BYTES) return null;
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
