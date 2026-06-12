import { native } from "@argon/glue/native";
import { logger } from "@argon/core";

export type MediaPermission = "microphone" | "camera";

/**
 * True only on the macOS native host, where the OS (TCC) gates mic/camera access and a
 * silent `NotAllowedError` is the default failure. On Windows, Linux and in the browser
 * `getUserMedia` drives its own permission flow, so the gate is unnecessary.
 */
export function needsMediaPermissionGate(): boolean {
  return argon.isArgonHost_MacOs && !!native;
}

/**
 * Whether the OS has already granted this permission. Read-only — never prompts.
 * Resolves to `true` on platforms that don't need the gate.
 */
export async function isMediaPermissionGranted(
  permission: MediaPermission,
): Promise<boolean> {
  if (!needsMediaPermissionGate()) return true;
  try {
    return await native!.hostProc.isPermissionGranted(permission);
  } catch (e) {
    logger.warn(`[media] status check failed for ${permission}`, e);
    return true;
  }
}

/**
 * Ensure the OS-level (TCC) permission is granted, prompting the user if it hasn't been
 * decided yet. macOS only shows the system prompt while undecided; once denied it instead
 * deep-links the user to the relevant Privacy pane (it never re-prompts). On platforms
 * that don't need the gate this is a no-op that resolves to `true`.
 *
 * Returns whether access is (now) granted.
 */
export async function ensureMediaPermission(
  permission: MediaPermission,
): Promise<boolean> {
  if (!needsMediaPermissionGate()) return true;
  try {
    if (await native!.hostProc.isPermissionGranted(permission)) return true;
    return await native!.hostProc.requestPermission(permission);
  } catch (e) {
    // Don't block media capture on an IPC hiccup — fall through to getUserMedia,
    // which will surface its own error if access really is unavailable.
    logger.warn(`[media] permission request failed for ${permission}`, e);
    return true;
  }
}
