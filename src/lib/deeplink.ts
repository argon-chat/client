import { logger } from "@argon/core";
import { useWindow } from "@/store/ui/windowStore";
import { isSk } from "@/lib/sk";
import { shell } from "@/lib/shell/host";
import { forwardLaunchLinks } from "@/lib/sk/launch";

/**
 * Routes an `argon://` deep link to an in-app action.
 *
 * Supported routes:
 *  - `argon://invite/{code}` → opens the invite preview modal.
 *  - `argon://i/{code}`, `argon://v/{code}` → the same, spelled like the web links they came from.
 *  - `argon://connections/linked?provider=…` → the settings on Connections, once a sign-in returns.
 *  - `argon://connections/complete?h=…&k=…` → finishes a sign-in started from this desktop.
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

    // The provider's sign-in finished in the browser. `complete` carries the handshake this app
    // finishes as its own account; `linked` only brings the settings into view.
    case "connections": {
      useWindow().openSettings("connections");
      const query = new URLSearchParams(s.split("?")[1]?.split("#")[0] ?? "");
      const handshakeId = query.get("h");
      const key = query.get("k");
      void import("@/store/features/connectionsStore").then((m) => {
        const store = m.useConnectionsStore();
        if ((segments[0] ?? "").toLowerCase() === "complete" && handshakeId && key) void store.complete(handshakeId, key);
        else void store.load();
      });
      return true;
    }
  }

  logger.warn?.(`[deeplink] unhandled argon:// url: ${rawUrl}`);
  return false;
}

const INVITE_HOSTS = new Set(["argon.gl", "www.argon.gl"]);

/** `https://argon.gl/i/{code}` or `/v/{code}` as the matching `argon://` link; null for anything else. */
export function inviteDeepLink(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL((url ?? "").trim()); } catch { return null; }
  if (!/^https?:$/.test(parsed.protocol) || !INVITE_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const [route, code, ...rest] = parsed.pathname.split("/").filter(Boolean);
  if (!code || rest.length || !/^[iv]$/i.test(route)) return null;
  return `argon://${route.toLowerCase()}/${code}`;
}

/** Opens an argon.gl invite link inside the app. Returns false for any other address. */
export function handleInAppLink(url: string): boolean {
  const link = inviteDeepLink(url);
  return !!link && handleDeepLink(link);
}

let initialized = false;

/** Delivers OS launch URLs through the SDK and browser-local app events. */
export function initDeepLinks() {
  if (initialized) return;
  initialized = true;

  (window as any).argonHandleDeepLink = handleDeepLink;

  window.addEventListener("argon:deeplink", (e: Event) => {
    const detail = (e as CustomEvent<string>).detail;
    if (typeof detail === "string") handleDeepLink(detail);
  });

  // Skathi has no preload bridge: its links come through `launchQueue` (lib/sk/launch.ts).
  // Skathi's client-gap.md §4, "launchQueue URLs → handleDeepLink" (A-webapi #94).
  if (isSk) {
    forwardLaunchLinks(handleDeepLink);
    if (shell?.launch) {
      shell.launch.onOpenUrl(handleDeepLink);
      for (const url of shell.launch.pending()) handleDeepLink(url);
    }
  }


}
