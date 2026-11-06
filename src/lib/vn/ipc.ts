/**
 * `window.argonIpc` under vue-native: a no-op, never a bridge.
 *
 * The Electron preload's IPC is legacy, and vue-native has none. With the desktop identity
 * (identity.ts), the boot path still awaits it. `useConfigStore().load()` iterates
 * `HostProc.getConfig()`, and without an answer the init loop failed on "Loading configurations…"
 * until it gave up. The taskbar jump list, the thumbnail buttons and the theme sync call it as well.
 * An owner decision (vue-native m26, Phase 1) settled this: a minimal no-op, not an emulation.
 * Every call resolves to "nothing", with these exceptions:
 * - calls whose caller iterates the answer;
 * - the DevTools toggle, which opens vue-native's inspector;
 * - the host's own config and window material, which hostConfig.ts keeps as the Electron shell does.
 * Each other service.method is logged once, so the remaining callers stay visible.
 *
 * Installed by main.ts right after identity.ts, before @argon/glue looks for the bridge.
 */
import { isVn } from "./index";
import { applyAtLaunch, getConfig, setConfigValue, setWindowMaterial } from "./hostConfig";
import type { SetRequest } from "@argon/glue/ipc";

/** Answers a caller cannot do without. Everything else resolves to `undefined`. */
const ANSWERS: Record<string, unknown> = {
  // HotKeySettings tests `status !== null && !status.running`, and `null` is how hotkeys/host.ts
  // says "no hotkey host". `undefined` passed the null check and crashed the Hotkeys tab (vue-native
  // research/reports/m26/client-sweep-1.md #7).
  "HostProc.hotkeyStatus": null,
};

/**
 * The DevTools button (AppTitlebar, ApplicationSettings) and Ctrl+Shift+I (App.vue) call
 * `HostProc.toggleDevTools`: that opens vue-native's own inspector, or raises it when it is open.
 *
 * It calls the host function vue-native's `appDevtools.open()` wraps (vue-native's runtime.ts),
 * because this bundle cannot import "vue-native": its Vite build has no such module, the same reason
 * window.ts reads `__VN_WINDOW__`. It should become `appDevtools.open()` once the client can import
 * vue-native.
 */
function openDevtools(): void {
  const open = (globalThis as { __vn_devtools_open?: () => string }).__vn_devtools_open;
  if (typeof open !== "function") {
    console.warn("[vue-native] DevTools: this host has no inspector to open");
    return;
  }
  try {
    const out = JSON.parse(open()) as { opened?: boolean; error?: string };
    if (out.error) console.warn(`[vue-native] DevTools: no inspector was opened: ${out.error}`);
  } catch (e) {
    console.warn("[vue-native] DevTools: the host's answer could not be read", e);
  }
}

/** Calls this no-op does carry out, on vue-native's own terms. */
const ACTIONS: Record<string, (args: unknown[]) => unknown> = {
  "HostProc.getScreenSources": (args) => captureApi().getSources(args[0] as string[], args[1] as Record<string, unknown> | undefined),
  "HostProc.setPendingScreenSource": (args) => captureApi().setPendingSource(String(args[0]), !!args[1]),
  "HostProc.toggleDevTools": openDevtools,
  // configStore: the sections, and one key's new value (hostConfig.ts).
  "HostProc.getConfig": () => getConfig(),
  "HostProc.setConfigValue": (args) => setConfigValue(args[0] as SetRequest),
  // AppearanceSettings: the live backdrop switch it makes before it saves WindowMaterial.
  "HostProc.setWindowMaterial": (args) => setWindowMaterial(String(args[0])),
};

function captureApi() {
  const api = (globalThis as { __VN_CAPTURE__?: {
    getSources(types: string[], options?: Record<string, unknown>): Promise<unknown[]>;
    setPendingSource(sourceId: string, includeAudio: boolean): boolean;
  } }).__VN_CAPTURE__;
  if (!api) throw new Error("This vue-native host does not support desktop capture; rebuild the host and vendor bundle.");
  return api;
}

if (isVn && !("argonIpc" in window)) {
  // The Electron shell applies its saved Theme and WindowMaterial when it creates the window.
  applyAtLaunch();
  const seen = new Set<string>();
  (window as { argonIpc?: unknown }).argonIpc = {
    async invoke(service: string, method: string, args: unknown[] = []): Promise<unknown> {
      const key = `${service}.${method}`;
      if (key in ACTIONS) return ACTIONS[key](args);
      if (!seen.has(key)) {
        seen.add(key);
        console.info(`[vue-native] argonIpc ${key}: no Electron host here, answered by the no-op`);
      }
      return ANSWERS[key];
    },
    onEvent() {},
    onPinnedFn() {},
    onPresenceUpdate() {},
    async consumeCrashRecovery() {
      return false;
    },
  };
}
