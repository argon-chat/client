/**
 * Microphone and camera permission as the desktop host keeps it (vue-native PERMISSIONS.md §5.1).
 *
 * Capture asks the user itself, but only from `prompt`: after a Block it refuses for good, and only
 * an explicit request (the settings banner's button) asks again. So nothing here prompts on its
 * own; the settings banners read the state and the button calls `requestMediaPermission`.
 * The browser build and hosts without `__VN_CAPTURE__.permission` report granted: there the
 * browser's getUserMedia drives its own prompt and there is nothing to gate.
 */
import { logger } from "@argon/core";

export type MediaPermission = "microphone" | "camera";
export type MediaPermissionState = "granted" | "denied" | "prompt" | "unsupported";
export interface MediaPermissionStatus {
  state: MediaPermissionState;
  /** Whether `requestMediaPermission` can do anything (false for granted and unsupported). */
  canRequest: boolean;
  /** A denial by the OS's own privacy settings rather than the user's Block in the app's prompt. */
  deniedBySystem: boolean;
}

interface PermissionApi {
  /** Synchronous, never prompts. Absent on hosts older than the permission API. */
  permission?(source: MediaPermission): MediaPermissionStatus;
  requestPermission?(source: MediaPermission): Promise<string>;
}

const GRANTED: MediaPermissionStatus = { state: "granted", canRequest: false, deniedBySystem: false };
const STATES = new Set<string>(["granted", "denied", "prompt", "unsupported"]);

const api = () => (globalThis as { __VN_CAPTURE__?: PermissionApi }).__VN_CAPTURE__;

/** True only when the host exposes the permission API, i.e. when there is a state to show. */
export function needsMediaPermissionGate(): boolean {
  return typeof api()?.permission === "function";
}

/** The current status, without prompting. Granted wherever the host has no permission API. */
export function readMediaPermission(permission: MediaPermission): MediaPermissionStatus {
  const host = api();
  if (typeof host?.permission !== "function") return GRANTED;
  try {
    const status = host.permission(permission);
    if (!status || !STATES.has(status.state)) return GRANTED;
    return { state: status.state, canRequest: !!status.canRequest, deniedBySystem: !!status.deniedBySystem };
  } catch (e) {
    logger.warn(`[permissions] ${permission} status unavailable:`, e);
    return GRANTED;
  }
}

/** Capture works without asking. `unsupported` (no backend to ask, e.g. the camera on macOS) counts. */
export function isPermissionGranted(status: MediaPermissionStatus): boolean {
  return status.state === "granted" || status.state === "unsupported";
}

/** Whether the settings banner shows: the user has something to do before capture works. */
export function needsPermissionBanner(status: MediaPermissionStatus): boolean {
  return status.state === "denied" || status.state === "prompt";
}

export async function isMediaPermissionGranted(permission: MediaPermission): Promise<boolean> {
  return isPermissionGranted(readMediaPermission(permission));
}

/**
 * Whether capture may proceed. A pure read: capture prompts by itself from `prompt`, and asking
 * here too would show a second prompt right after a dismissal; a Block is only lifted by the
 * explicit request.
 */
export async function ensureMediaPermission(permission: MediaPermission): Promise<boolean> {
  return readMediaPermission(permission).state !== "denied";
}

/**
 * The banner's button: shows the app's prompt (again, after a Block), or the OS settings page for a
 * system denial, which can wait minutes for the user. Resolves with the status read afterwards.
 */
export async function requestMediaPermission(permission: MediaPermission): Promise<MediaPermissionStatus> {
  const request = api()?.requestPermission;
  if (typeof request === "function") {
    try {
      await request.call(api(), permission);
    } catch (e) {
      logger.warn(`[permissions] ${permission} request failed:`, e);
    }
  }
  return readMediaPermission(permission);
}

/**
 * Calls back with a fresh status whenever the permission changes (an answer to the prompt, a
 * reset, an OS toggle). Best effort: where the Permissions API can't query it, nothing fires.
 */
export function watchMediaPermission(
  permission: MediaPermission,
  callback: (status: MediaPermissionStatus) => void,
): () => void {
  let disposed = false;
  let release: (() => void) | null = null;
  const permissions = (globalThis as { navigator?: Navigator }).navigator?.permissions;
  if (typeof permissions?.query !== "function") return () => {};
  try {
    permissions.query({ name: permission as PermissionName }).then((status) => {
      if (disposed) return;
      const onChange = () => callback(readMediaPermission(permission));
      status.addEventListener("change", onChange);
      release = () => status.removeEventListener("change", onChange);
    }, () => {});
  } catch { /* a name this engine can't query */ }
  return () => {
    disposed = true;
    release?.();
    release = null;
  };
}
