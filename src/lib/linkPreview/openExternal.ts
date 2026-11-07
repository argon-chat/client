import { logger } from "@argon/core";
import { openExternalUrl as openDesktopUrl } from "@/lib/shell/desktop";

/** Message links may open web addresses, never an executable or another protocol. */
export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  void openDesktopUrl(url).catch((error) => logger.warn("Failed to open external URL", error));
}
