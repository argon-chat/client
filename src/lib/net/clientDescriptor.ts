/**
 * The `X-Argon-Client` header: what this client is, so the server can name the session.
 *
 * Until this existed the server knew a session by its User-Agent alone, which for the desktop app is
 * Chromium's string with an `ArgonChat/1.4.0` token buried in it and for a browser says nothing
 * about the computer. The devices screen showed "Unknown device". Now the desktop host says what it
 * is — platform, OS, version, hostname — and the web build says it is a browser and lets the server
 * read the rest off the User-Agent as before.
 *
 * Format: semicolon-separated `key=value` pairs, values percent-encoded, so a hostname with a space
 * or a non-ASCII letter survives the header. Built once per page load and reused; nothing in it
 * changes while the app runs.
 *
 * Display text only. The server trims, caps and strips it and shows it back to the account's owner;
 * it authorises nothing on it.
 */

import { isDesktop } from "@/lib/platform";

export const CLIENT_DESCRIPTOR_HEADER = "X-Argon-Client";

/** What the Electron host reports through the `argonHostInfo` bridge. */
interface HostInfo {
  platform: string;
  arch: string;
  osName: string;
  osVersion: string;
  hostname: string;
  appVersion: string;
}

const MAX_VALUE_LENGTH = 64;

let cached: Promise<string> | null = null;

/** The header value for this client. Never rejects: a client that cannot describe itself sends the little it knows. */
export function clientDescriptorHeader(): Promise<string> {
  cached ??= build().catch(() => encode(fromNavigator()));
  return cached;
}

async function build(): Promise<string> {
  if (!isDesktop) return encode(fromNavigator());

  const bridge = (window as any).argonHostInfo as { get(): Promise<HostInfo> } | undefined;
  const info = await bridge?.get?.();

  if (info) {
    return encode({
      platform: platformOf(info.platform),
      os: info.osName,
      osv: info.osVersion,
      app: info.appVersion,
      device: info.hostname,
      arch: info.arch,
    });
  }

  // An older host without the bridge still exposes its version, and the platform can be read off
  // the User-Agent the same way the server would.
  return encode({
    platform: fromNavigator().platform,
    app: ((window as any).argon_host_version_full as string | undefined) ?? "",
  });
}

/** What a browser tab can say about itself: that it is a browser, and which OS family it runs on. */
function fromNavigator(): Record<string, string> {
  const uaPlatform = (navigator as any).userAgentData?.platform as string | undefined;
  return {
    web: isDesktop ? "" : "1",
    platform: platformOf(uaPlatform ?? navigator.userAgent),
  };
}

/** Node's `process.platform`, a UA-CH platform name or a raw User-Agent, to the server's vocabulary. */
function platformOf(source: string | undefined): string {
  const s = (source ?? "").toLowerCase();
  // Phones first: an Android agent also says "Linux" and an iPhone agent also says "Mac OS X".
  if (s.includes("android")) return "android";
  if (s.includes("iphone") || s.includes("ipad") || s === "ios") return "ios";
  if (s === "win32" || s.includes("windows")) return "windows";
  if (s === "darwin" || s.includes("mac")) return "macos";
  if (s.includes("linux") || s.includes("x11") || s.includes("cros")) return "linux";
  return "";
}

function encode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .filter(([, value]) => value && value.trim().length > 0)
    .map(([key, value]) => `${key}=${encodeURIComponent(value.trim().slice(0, MAX_VALUE_LENGTH))}`)
    .join("; ");
}
