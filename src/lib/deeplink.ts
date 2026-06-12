import { logger } from "@argon/core";
import { useWindow } from "@/store/ui/windowStore";

/**
 * Routes an `argon://` deep link to an in-app action.
 *
 * Supported routes:
 *  - `argon://invite/{code}` → opens the invite preview modal.
 *
 * Returns true if the URL was recognised and handled.
 */
export function handleDeepLink(rawUrl: string): boolean {
  if (!rawUrl) return false;

  const s = rawUrl.trim();
  if (!s.toLowerCase().startsWith("argon://")) return false;

  // Custom (non-special) schemes parse inconsistently through `new URL`, so we
  // split the path manually after stripping the scheme + any leading slashes.
  const rest = s.slice("argon://".length).replace(/^\/+/, "");
  const [route, ...segments] = rest.split(/[/?#]/).filter(Boolean);

  switch ((route ?? "").toLowerCase()) {
    case "invite": {
      const code = (segments[0] ?? "").trim();
      if (!code) break;
      useWindow().openInvitePreview(decodeURIComponent(code));
      return true;
    }
  }

  logger.warn?.(`[deeplink] unhandled argon:// url: ${rawUrl}`);
  return false;
}

let initialized = false;

/**
 * Wires up deep-link delivery. The native host forwards `argon://` activations
 * either by calling `window.argonHandleDeepLink(url)` or by dispatching an
 * `argon:deeplink` CustomEvent — both are supported here.
 */
export function initDeepLinks() {
  if (initialized) return;
  initialized = true;

  (window as any).argonHandleDeepLink = handleDeepLink;

  window.addEventListener("argon:deeplink", (e: Event) => {
    const detail = (e as CustomEvent<string>).detail;
    if (typeof detail === "string") handleDeepLink(detail);
  });
}
