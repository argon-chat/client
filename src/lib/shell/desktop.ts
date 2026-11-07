/** Application operations use the SDK and the direct native namespace. */
import { isVn } from "@/lib/vn";
import { shell } from "./host";
import { getConfig, setConfigValue, setWindowMaterial as applyMaterial } from "./config";
import type { ConfigUpdate } from "./configTypes";
import type { ScreenSource } from "@/composables/useScreenShareSources";

interface CaptureApi {
  getSources(types: string[], options?: Record<string, unknown>): Promise<ScreenSource[]>;
  setPendingSource(sourceId: string, includeAudio: boolean): boolean;
}
const capture = () => {
  const api = (globalThis as { __VN_CAPTURE__?: CaptureApi }).__VN_CAPTURE__;
  if (!api) throw new Error("This host does not support desktop capture");
  return api;
};
export const desktopConfig = {
  async read() { return getConfig(); },
  async update(request: ConfigUpdate) { return setConfigValue(request); },
};
export async function idleSeconds(): Promise<number> {
  return Math.floor(shell.idle.getTime().idleMs / 1000);
}
export function openDevtools(): void {
  const open = (globalThis as { __vn_devtools_open?: () => string }).__vn_devtools_open;
  if (!open) return;
  const result = JSON.parse(open()) as { error?: string };
  if (result.error) console.warn("[devtools]", result.error);
}
export async function setWindowMaterial(material: string): Promise<boolean> { return applyMaterial(material); }
export async function screenSources(types: string[], options?: Record<string, unknown>): Promise<ScreenSource[]> {
  return capture().getSources(types, options);
}
export async function selectCaptureSource(sourceId: string, includeAudio: boolean): Promise<void> {
  if (!isVn) return; // The browser's display-media picker selects its own source.
  if (!capture().setPendingSource(sourceId, includeAudio)) throw new Error("The capture source is invalid");
}
export async function consumeCrashRecovery(): Promise<boolean> {
  return isVn ? shell.system.consumeCrashRecovery?.() ?? false : false;
}
export async function openExternalUrl(url: string): Promise<void> {
  if (isVn) { await shell.system.openUrl(url); return; }
  window.open(url, "_blank", "noopener,noreferrer");
}
