/**
 * UI hotkeys use Skathi's `appHotkeys`, never a pinned event bus. It is read off the "vue"
 * namespace, as ../sk/tray.ts reads `appTray`: the Vite build has no Skathi module, and the
 * lookup is dead code there behind `import.meta.env.SK`.
 */
import * as vue from "vue";
import { isSk } from "@/lib/sk";
import { shell } from "@/lib/shell/host";
import type { HotkeyChord } from "./chord";

export interface HotkeyHostStatus { running: boolean; platform: string; accessibilityGranted: boolean; error: string | null; restarts: number }
export interface HotkeyHostBinding { id: string; chord: { buttons: { device: number; code: number }[] } }
export type HotkeyHostPhase = "down" | "up";
export type HotkeyCaptureFailure = "cancelled" | "timeout" | "superseded";
interface AppHotkeys {
  setBindings(bindings: HotkeyHostBinding[]): boolean; status(): HotkeyHostStatus; restart(): boolean; requestAccessibility(): boolean;
  captureOnce(): Promise<HotkeyChord>; cancelCapture(): void;
  onFired(fn: (event: { id: string; phase: HotkeyHostPhase }) => void): () => void;
}
const service = (): AppHotkeys | undefined =>
  import.meta.env.SK && isSk ? (Reflect.get(vue, "appHotkeys") as AppHotkeys | undefined) : undefined;
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
  async toggleMainWindow(): Promise<boolean> { return isSk ? shell.system.window.toggle() : false; },
  async showMainWindow(): Promise<boolean> { return isSk ? shell.system.window.show() : false; },
  async isAccessibilityGranted(): Promise<boolean> { return service()?.status().accessibilityGranted ?? false; },
  async requestAccessibility(): Promise<boolean> {
    const hotkeys = service();
    if (!hotkeys) return false;
    const granted = hotkeys.requestAccessibility();
    if (granted && !hotkeys.status().running) hotkeys.restart();
    return granted;
  },
};
