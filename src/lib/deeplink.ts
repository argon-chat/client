import { logger } from "@argon/core";
import { useWindow } from "@/store/ui/windowStore";

/**
 * Routes an `argon://` deep link to an in-app action.
 *
 * Supported routes:
 *  - `argon://invite/{code}` → opens the invite preview modal.
 *  - `argon://i/{code}`, `argon://v/{code}` → the same, spelled like the web links they came from.
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
    // One case, four spellings. The card endpoint hands out `argon://invite/{code}`, but the links
    // people copy are argon.gl/i/{code} for a space and argon.gl/v/{code} for a voice room, and
    // anything that mirrors a web path into the scheme lands here as `i` or `v`. Accepting them
    // costs two labels; refusing them is a link that silently does nothing. Which kind of invite it
    // is does not come from the route in any case — only the preview knows.
    case "invite":
    case "i":
    case "v":
    case "voice": {
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
 * Wires up deep-link delivery, from all three directions the host can arrive from:
 *
 *  - `window.argonDeepLink.onOpen(cb)` — the Electron preload bridge, which is how a real
 *    `argon://` activation actually reaches the renderer: the launcher hands the URL to the main
 *    process, which sends `deeplink:open` over IPC. Without this subscription that IPC message has
 *    no listener, and every link opened from the web lands in an app that does nothing.
 *  - `window.argonHandleDeepLink(url)` — a direct call, for hosts with no IPC of their own.
 *  - an `argon:deeplink` CustomEvent — the same, for anything that can only dispatch events.
 */
export function initDeepLinks() {
  if (initialized) return;
  initialized = true;

  (window as any).argonHandleDeepLink = handleDeepLink;

  window.addEventListener("argon:deeplink", (e: Event) => {
    const detail = (e as CustomEvent<string>).detail;
    if (typeof detail === "string") handleDeepLink(detail);
  });

  const bridge = (window as any).argonDeepLink;
  if (typeof bridge?.onOpen === "function") {
    try {
      bridge.onOpen((url: string) => handleDeepLink(url));
    } catch (e) {
      logger.warn?.(`[deeplink] native bridge refused a subscription: ${e}`);
    }
  }
}
