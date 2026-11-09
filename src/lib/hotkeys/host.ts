/** UI hotkeys use an optional direct native service, never a pinned event bus. */
import { isVn } from "@/lib/vn";
import { shell, type NativeHotkeyStatus, type NativeHotkeyBinding } from "@/lib/shell/host";
import type { HotkeyChord } from "./chord";

export type HotkeyHostStatus = NativeHotkeyStatus;
export type HotkeyHostBinding = NativeHotkeyBinding;
export type HotkeyHostPhase = "down" | "up";
export type HotkeyCaptureFailure = "cancelled" | "timeout" | "superseded";
const service = () => isVn ? shell?.hotkeys : undefined;
export function captureFailureReason(err: unknown): HotkeyCaptureFailure | null {
  const message = err instanceof Error ? err.message : String(err);
  return /hotkey capture (cancelled|timeout|superseded)/.exec(message)?.[1] as HotkeyCaptureFailure | undefined ?? null;
}
export const hotkeyHost = {
  get available(): boolean { return !!service(); },
  async setBindings(bindings: HotkeyHostBinding[]): Promise<boolean> { return service()?.setBindings(bindings) ?? false; },
  async status(): Promise<HotkeyHostStatus | null> { return service()?.status() ?? null; },
  async restart(): Promise<boolean> { return service()?.restart() ?? false; },
  async captureOnce(): Promise<HotkeyChord> {
    const hotkeys = service();
    if (!hotkeys) throw new Error("Global key capture is unavailable");
    return hotkeys.captureOnce();
  },
  async cancelCapture(): Promise<void> { service()?.cancelCapture(); },
  onFired(callback: (id: string, phase: HotkeyHostPhase) => void): (() => void) | null {
    return service()?.onFired((event) => callback(event.id, event.phase)) ?? null;
  },
  async toggleMainWindow(): Promise<boolean> { return isVn ? shell.system.window.toggle() : false; },
  async showMainWindow(): Promise<boolean> { return isVn ? shell.system.window.show() : false; },
  async isAccessibilityGranted(): Promise<boolean> { return service()?.status().accessibilityGranted ?? false; },
  async requestAccessibility(): Promise<boolean> {
    const hotkeys = service();
    if (!hotkeys) return false;
    const granted = hotkeys.requestAccessibility();
    if (granted && !hotkeys.status().running) hotkeys.restart();
    return granted;
  },
};
