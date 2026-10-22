import { argon } from "@argon/glue";
import { native } from "@argon/glue/native";
import { logger } from "@argon/core";

/**
 * Opens a web address in the system browser. Only http(s) — a card or a link in a message never
 * gets to launch anything else. Same route as UrlSegment: the Argon host intercepts window.open,
 * the Electron build goes through the host process.
 */
export function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (argon?.isArgonHost) {
    window.open(url, "_blank", "noopener");
    return;
  }
  if (window.argonIpc) {
    void native?.hostProc.openUrl(url).catch((error) => logger.warn("Failed to open external URL", error));
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
