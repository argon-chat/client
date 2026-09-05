/**
 * Hands a freshly made device proof to the one request that asked for it.
 *
 * Only the calls that mint or refresh a session want proof of possession, and making one costs a
 * TPM signature — so it cannot ride on every request. `withDeviceProof` places the proof here and
 * the api store's `DeviceProofInterceptor` takes it on the first request that goes out: taken, not
 * read, because the server accepts each proof exactly once, and a proof that leaked onto an
 * unrelated request in flight would be spent by the time the intended call presented it.
 *
 * Kept apart from the api store so the stores that sign in can import it without importing the
 * store — which the tests replace wholesale with a stub that knows nothing of proofs.
 */

import { makeDeviceProof } from "@/lib/native/deviceProof";

export const DEVICE_PROOF_HEADER = "Sec-Proof";

export const deviceProof = { pending: null as string | null };

/**
 * Runs one API call with a freshly made device proof attached.
 *
 * Wraps sign-in, registration, password reset, the QR sign-in request and the token refresh — the
 * calls after which the server mints or re-issues a session. On a desktop with a TPM the session
 * comes back bound to that chip; everywhere else `makeDeviceProof` yields null and the call goes
 * out exactly as it always has.
 */
export async function withDeviceProof<T>(call: () => Promise<T>): Promise<T> {
  deviceProof.pending = await makeDeviceProof();
  try {
    return await call();
  } finally {
    deviceProof.pending = null;
  }
}
