import { argon } from "@argon/glue";
import { native } from "@argon/glue/native";

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
  native?.hostProc.openUrl(url);
}
