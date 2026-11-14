/** Build target and explicit service capabilities, available before stores mount. */

/** Where the browser build sends people who want the parts it cannot offer. */
export const DOWNLOAD_URL = "https://argon.gl/download";

import { isSk } from "@/lib/sk";
import { shell } from "@/lib/shell/host";
import { hotkeyHost } from "@/lib/hotkeys/host";
const hasWindow = typeof window !== "undefined";

/** True for the native desktop build, false for the browser build. */
export const isDesktop: boolean = hasWindow && isSk;

/** True in a plain browser tab — the web build. */
export const isWeb: boolean = hasWindow && !isDesktop;

/**
 * Capabilities the desktop host provides and a browser tab cannot.
 *
 * `selfHosted` and `multiAccount` are not browser limitations — they are product decisions for the
 * web build (one origin, one session, the official instance), and they live here so the rest of the
 * app has one place to ask rather than two kinds of check.
 */
export type PlatformFeature =
  /** Rich presence: what game you are playing, published to your friends. */
  | "presence"
  /** The in-game voice overlay. */
  | "gameOverlay"
  /** System-wide push-to-talk and other hotkeys that work while Argon is not focused. */
  | "globalHotkeys"
  /** Launching with the OS. */
  | "autostart"
  /** Acrylic/mica window materials drawn by the OS. */
  | "windowMaterials"
  /** OS notifications routed through the host (web uses the Notification API instead). */
  | "nativeNotifications"
  /** The on-disk cache breakdown and per-category purge. */
  | "storageBreakdown"
  /** Update channels and in-app updates. */
  | "appUpdates"
  /** Signing in to a self-hosted or enterprise instance. */
  | "selfHosted"
  /** Holding several signed-in accounts and switching between them. */
  | "multiAccount";

const WEB_UNSUPPORTED: ReadonlySet<PlatformFeature> = new Set<PlatformFeature>([
  "presence",
  "gameOverlay",
  "globalHotkeys",
  "autostart",
  "windowMaterials",
  "nativeNotifications",
  "storageBreakdown",
  "appUpdates",
  "selfHosted",
  "multiAccount",
]);

/** Whether this build can do `feature` at all. */
export function supports(feature: PlatformFeature): boolean {
  if (isSk) {
    if (feature === "globalHotkeys") return hotkeyHost.available;
    if (feature === "nativeNotifications") return !!shell?.system.notifications;
    if (feature === "appUpdates") return !!shell?.system.updates;
    if (feature === "storageBreakdown") return !!shell?.system.storage;
    return true;
  }
  return !WEB_UNSUPPORTED.has(feature);
}

/** The inverse of `supports`, for the common `v-if` that shows the "get the desktop app" card. */
export function unsupported(feature: PlatformFeature): boolean {
  return !supports(feature);
}

/**
 * Whether the viewport is a phone-shaped one.
 *
 * Checked at boot to send phone browsers to the mobile app instead of a desktop layout squeezed
 * into 390 CSS pixels. A narrow *window* on a desktop is not a phone — hence the pointer test,
 * which asks about the input device rather than the width alone. `orientation` in the UA data is
 * the tiebreaker for tablets, which are coarse-pointered but wide enough for the real layout.
 */
export function isMobileLayout(): boolean {
  if (!hasWindow) return false;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const narrow = Math.min(window.innerWidth, window.innerHeight) < 700;
  const uaMobile = /Android|iPhone|iPod|Windows Phone/i.test(navigator.userAgent);
  // iPadOS reports itself as a Mac; a touch-capable "Mac" is an iPad.
  const iPadOS = navigator.userAgent.includes("Mac") && (navigator.maxTouchPoints ?? 0) > 1;
  if (iPadOS) return true;
  return uaMobile || (coarse && narrow);
}
