/**
 * Which Argon this build is running as, and what that build is allowed to do.
 *
 * The same sources build two products: the Electron desktop app, which owns the machine (global
 * hotkeys, the in-game overlay, rich presence, autostart, native window materials), and the browser
 * app, which owns a tab. Every place that used to ask `argon.isArgonHost` and then guess what that
 * implied now asks a named question instead, so a feature that is absent on the web is absent for a
 * stated reason and can be shown to the user as such rather than silently doing nothing.
 *
 * Deliberately free of Vue and of every store: this is read during boot, before pinia exists, and
 * from the pre-mount gate that decides whether the app starts at all.
 */

/** Where the browser build sends people who want the parts it cannot offer. */
export const DOWNLOAD_URL = "https://argon.gl/download";

const hasWindow = typeof window !== "undefined";

/** True inside the Electron host (desktop app), false in a plain browser tab. */
export const isDesktop: boolean = hasWindow && !!(globalThis as any).argon?.isArgonHost;

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
  if (isDesktop) return true;
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
