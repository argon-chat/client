/**
 * The desktop host's side of hotkeys, typed.
 *
 * The Electron main process installs the OS-level hook, matches chords and tells us when a binding
 * goes down or up (see ArgonApp/src/ipc/hotkey-manager.ts). Everything here goes over the generic
 * HostProc RPC; the methods beyond the ion contract (bindings as one list, status, cancel) are
 * plain RPC names the host registers, hence the cast rather than a regenerated contract.
 * On the web build every call is a no-op and `available` is false.
 */

import { argon, native } from "@argon/glue/native";
import { HotkeyPhase, type HotKeyTriggered, type PinnedFn } from "@argon/glue/ipc";
import { isDesktop } from "@/lib/platform";
import type { HotkeyChord } from "./chord";

export interface HotkeyHostStatus {
  /** Whether the OS hook is installed and delivering events. */
  running: boolean;
  /** Node's platform string: "win32", "darwin", … */
  platform: string;
  /** macOS: whether Accessibility is granted. Always true elsewhere. */
  accessibilityGranted: boolean;
  /** Why it is not running, when it is not. */
  error: string | null;
  /** Times the host re-installed a hook that went quiet. */
  restarts: number;
}

export interface HotkeyHostBinding {
  id: string;
  chord: HotkeyChord;
}

export type HotkeyHostPhase = "down" | "up";

export type HotkeyCaptureFailure = "cancelled" | "timeout" | "superseded";

interface HotkeyHostProc {
  hotkeySetBindings(bindings: HotkeyHostBinding[]): Promise<boolean>;
  hotkeyStatus(): Promise<HotkeyHostStatus>;
  hotkeyRestart(): Promise<boolean>;
  hotkeyCaptureOnce(): Promise<HotkeyChord>;
  hotkeyCancelCapture(): Promise<boolean>;
  hotkeyFired(fn: PinnedFn): Promise<boolean>;
  toggleMainWindow(): Promise<boolean>;
  showMainWindow(): Promise<boolean>;
  isPermissionGranted(permission: string): Promise<boolean>;
  requestPermission(permission: string): Promise<boolean>;
}

function proc(): HotkeyHostProc | null {
  if (!isDesktop || !native) return null;
  return native.hostProc as unknown as HotkeyHostProc;
}

/** Why a capture ended without a chord, read off the error the host's rejection turned into. */
export function captureFailureReason(err: unknown): HotkeyCaptureFailure | null {
  const message = err instanceof Error ? err.message : String(err);
  const match = /hotkey capture (cancelled|timeout|superseded)/.exec(message);
  return match ? (match[1] as HotkeyCaptureFailure) : null;
}

export const hotkeyHost = {
  /** False on the web build: nothing below does anything there. */
  get available(): boolean {
    return proc() !== null;
  },

  async setBindings(bindings: HotkeyHostBinding[]): Promise<boolean> {
    const p = proc();
    if (!p) return false;
    return p.hotkeySetBindings(bindings);
  },

  async status(): Promise<HotkeyHostStatus | null> {
    const p = proc();
    if (!p) return null;
    return p.hotkeyStatus();
  },

  async restart(): Promise<boolean> {
    const p = proc();
    if (!p) return false;
    return p.hotkeyRestart();
  },

  /** Resolves with the next key combination; rejects (see captureFailureReason) on Esc or timeout. */
  async captureOnce(): Promise<HotkeyChord> {
    const p = proc();
    if (!p) throw new Error("hotkey capture is available only in the desktop app");
    return p.hotkeyCaptureOnce();
  },

  async cancelCapture(): Promise<void> {
    const p = proc();
    if (!p) return;
    await p.hotkeyCancelCapture();
  },

  /**
   * Subscribes to bindings going down and up. Returns the pinned handler (pass it to `argon.off`
   * to drop it), or null on the web.
   */
  onFired(callback: (id: string, phase: HotkeyHostPhase) => void): PinnedFn | null {
    const p = proc();
    if (!p || !argon) return null;
    const fn = argon.on<HotKeyTriggered>("HotKeyTriggered", (event) => {
      callback(event.hotkeyId, event.phase === HotkeyPhase.Ended ? "up" : "down");
    });
    void p.hotkeyFired(fn);
    return fn;
  },

  async toggleMainWindow(): Promise<boolean> {
    const p = proc();
    if (!p) return false;
    return p.toggleMainWindow();
  },

  async showMainWindow(): Promise<boolean> {
    const p = proc();
    if (!p) return false;
    return p.showMainWindow();
  },

  /** macOS Accessibility, which the hook needs. Read-only; true where no permission exists. */
  async isAccessibilityGranted(): Promise<boolean> {
    const p = proc();
    if (!p) return true;
    return p.isPermissionGranted("accessibility");
  },

  /** Asks macOS for Accessibility (opens the system prompt or pane). Returns the new state. */
  async requestAccessibility(): Promise<boolean> {
    const p = proc();
    if (!p) return true;
    return p.requestPermission("accessibility");
  },
};
