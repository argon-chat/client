import { logger } from "@argon/core";
import { openExternalUrl as openDesktopUrl } from "@/lib/shell/desktop";
import { handleInAppLink } from "@/lib/deeplink";

/** Message links may open web addresses, never an executable or another protocol. */
export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  void openDesktopUrl(url).catch((error) => logger.warn("Failed to open external URL", error));
}

/** A clicked link: argon.gl invites open in the app, anything else (or a modifier-click) outside it. */
export function openLink(url: string, event?: MouseEvent): void {
  const outside = !!event && (event.ctrlKey || event.metaKey || event.shiftKey);
  if (!outside && handleInAppLink(url)) return;
  openExternalUrl(url);
}
