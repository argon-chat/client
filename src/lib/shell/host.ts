/** Direct JSC API owned by the Argon application, independent of Electron IPC. */
export interface MediaActivity { sessionId: string; title: string; author: string; isPlaying: boolean }
export interface Activity { pid: number; name: string; kind: 0 | 1; detectedAt: number; path: string }
export interface MonitorTarget {
  monitorIndex: number; x: number; y: number; w: number; h: number;
  scaleFactor?: number;
}
export interface ActivityWindow extends MonitorTarget {
  pid: number; hwnd: string; foreground: boolean; exclusiveFullscreen?: boolean;
}
export interface Presence { kind: number; titleName: string; gameId?: string; path?: string }
export interface SystemInfo {
  platform: string; osVersion: string; osArchitecture: string; hostname: string; appVersion: string; osName?: string;
}
export interface AutostartStatus { supported: boolean; enabled: boolean }
export interface ActivityConfig {
  systemDirectories?: string[]; blackListApp?: string[]; gameDlls?: string[];
  allowCheckSteamAcfManifest?: boolean; allowCheckEpicManifest?: boolean; pollIntervalMs?: number;
  software?: { queries?: { name?: string; CN?: string; nearbyFiles?: string[]; pathContains?: string[]; ignoredVariants?: string[] }[] };
}
type Unsubscribe = () => void;
export interface NativeHotkeyStatus { running: boolean; platform: string; accessibilityGranted: boolean; error: string | null; restarts: number }
export interface NativeHotkeyBinding { id: string; chord: { buttons: { device: number; code: number }[] } }
export interface NativeHotkeys {
  setBindings(bindings: NativeHotkeyBinding[]): boolean; status(): NativeHotkeyStatus; restart(): boolean;
  captureOnce(): Promise<{ buttons: { device: number; code: number }[] }>; cancelCapture(): void;
  onFired(fn: (event: { id: string; phase: "down" | "up" }) => void): Unsubscribe;
}
export interface ArgonShell {
  hotkeys?: NativeHotkeys;
  launch?: { pending(): string[]; onOpenUrl(fn: (url: string) => void): Unsubscribe };
  idle: { getTime(): { idleMs: number } };
  media: { current(): MediaActivity | null; onChanged(fn: (track: MediaActivity) => void): Unsubscribe };
  activity: {
    list(): Activity[]; configure(config: ActivityConfig): void; window(): ActivityWindow | null;
    icon?(path: string): string | null | Promise<string | null>;
    onStarted(fn: (activity: Activity) => void): Unsubscribe;
    onStopped(fn: (activity: Activity) => void): Unsubscribe;
    onWindowChanged(fn: (window: ActivityWindow | null) => void): Unsubscribe;
  };
  presence: { onChanged(fn: (presence: Presence | null) => void): Unsubscribe };
  capture: { target(sourceId: string): MonitorTarget | null };
  system: {
    info(): SystemInfo;
    window: { toggle(): boolean; show(): boolean };
    openUrl(url: string): boolean | Promise<boolean>;
    autostart: { get(): AutostartStatus; set(enabled: boolean): AutostartStatus };
    consumeCrashRecovery?(): boolean;
    updates?: { getChannel(): "live" | "beta" | "canary"; setChannel(channel: "live" | "beta" | "canary"): void };
    notifications?: { setUnread(state: { unread: boolean; count: number }): void; requestAttention(): void };
    storage?: {
      usage(): { categories: { name: string; bytes: number }[]; totalBytes: number };
      clear(category: string): Promise<void>;
      diskSpace(): { totalBytes: number; freeBytes: number };
    };
  };
  security?: { deviceProof(): Promise<string | null> };
}
/** Bound by the embedding application's native setup before client modules run. No RPC proxy. */
export const shell = (globalThis as unknown as { argon: ArgonShell }).argon;
