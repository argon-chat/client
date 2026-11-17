/** Application operations use the SDK and the native modules of the Argon executable. */
import * as vue from "vue";
import { isSk } from "@/lib/sk";
import { available as nativeSystem, consumeCrashRecovery as takeCrashRecovery, idleMs, openUrl } from "native:system";
import { getConfig, setConfigValue, setWindowMaterial as applyMaterial } from "./config";
import type { ConfigUpdate } from "./configTypes";
import type { ScreenSource } from "@/composables/useScreenShareSources";

interface CaptureApi {
  getSources(types: string[], options?: Record<string, unknown>): Promise<ScreenSource[]>;
  setPendingSource(sourceId: string, includeAudio: boolean): boolean;
  /** Absent on hosts older than the macOS screen-recording gate. */
  requestPermission?(source: "camera" | "screen_share"): Promise<string>;
}
const capture = () => {
  const api = (globalThis as { __SK_CAPTURE__?: CaptureApi }).__SK_CAPTURE__;
  if (!api) throw new Error("This host does not support desktop capture");
  return api;
};
export const desktopConfig = {
  async read() { return getConfig(); },
  async update(request: ConfigUpdate) { return setConfigValue(request); },
};
export async function idleSeconds(): Promise<number> {
  return Math.floor(idleMs() / 1000);
}
export function openDevtools(): void {
  if (!import.meta.env.SK || !isSk) return;
  const devtools = Reflect.get(vue, "appDevtools") as { open(): boolean } | undefined;
  devtools?.open();
}
export async function setWindowMaterial(material: string): Promise<boolean> { return applyMaterial(material); }
export async function screenSources(types: string[], options?: Record<string, unknown>): Promise<ScreenSource[]> {
  return capture().getSources(types, options);
}
/**
 * Asks for screen recording (macOS shows its prompt once, then opens the Settings pane); resolves
 * to the permission state. Hosts without a gate answer "granted" so the caller simply retries.
 */
export async function requestScreenCapture(): Promise<string> {
  const api = capture();
  return api.requestPermission ? api.requestPermission("screen_share") : "granted";
}
export async function selectCaptureSource(sourceId: string, includeAudio: boolean): Promise<void> {
  if (!isSk) return; // The browser's display-media picker selects its own source.
  if (!capture().setPendingSource(sourceId, includeAudio)) throw new Error("The capture source is invalid");
}
export async function consumeCrashRecovery(): Promise<boolean> {
  return nativeSystem ? takeCrashRecovery() : false;
}
export async function openExternalUrl(url: string): Promise<void> {
  if (isSk) { await openUrl(url); return; }
  window.open(url, "_blank", "noopener,noreferrer");
}
