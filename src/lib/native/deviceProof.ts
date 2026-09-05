/**
 * A fresh proof that this request is being made from this machine.
 *
 * The desktop host holds a key in the TPM (see `Argon.Security`, the `sec` plugin). Asked, it signs
 * `{now}|{machineId}` and hands back `publicKey.issuedAt.signature`, which travels as the
 * `Sec-Proof` header on the handful of calls that mint or refresh a session. The server accepts a
 * proof for one minute and only once, so one is made per call rather than once at launch — which is
 * exactly the bug the launch-time copy in the cookie had.
 *
 * Every failure is null: no TPM, a Mac, a Linux desktop, a browser, an older host without the
 * export, a plugin that did not load. Those sign in as they always did, bound to the machine id and
 * nothing more. A proof is a strengthening, never a precondition.
 */

import { logger } from "@argon/core";
import { isDesktop } from "@/lib/platform";
import { SecNative } from "@/lib/native/argon-native.g";

/** A TPM that has stopped answering must not hold sign-in hostage. */
const PROOF_TIMEOUT_MS = 5_000;

export async function makeDeviceProof(): Promise<string | null> {
  if (!isDesktop) return null;

  try {
    const proof = await Promise.race([
      SecNative.makeDeviceProof(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PROOF_TIMEOUT_MS)),
    ]);

    return typeof proof === "string" && proof.length > 0 ? proof : null;
  } catch (e) {
    logger.debug("device proof unavailable on this host", e);
    return null;
  }
}
