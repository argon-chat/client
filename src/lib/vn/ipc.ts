/**
 * `window.argonIpc` under vue-native: a no-op, never a bridge.
 *
 * The Electron preload's IPC is legacy, and vue-native has none. With the desktop identity
 * (identity.ts), the boot path still awaits it. `useConfigStore().load()` iterates
 * `HostProc.getConfig()`, and without an answer the init loop failed on "Loading configurations…"
 * until it gave up. The taskbar jump list, the thumbnail buttons and the theme sync call it as well.
 * An owner decision (vue-native m26, Phase 1) settled this: a minimal no-op, not an emulation.
 * Every call resolves to "nothing", except where the caller iterates the answer and the DevTools
 * toggle, which opens vue-native's inspector. Each other service.method is logged once so the
 * remaining callers stay visible.
 *
 * Installed by main.ts right after identity.ts, before @argon/glue looks for the bridge.
 */
import { isVn } from "./index";

/** Answers a caller cannot do without. Everything else resolves to `undefined`. */
const ANSWERS: Record<string, unknown> = {
  // configStore.load(): a list of sections. None, because the host has no config of its own.
  "HostProc.getConfig": [],
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
const ACTIONS: Record<string, () => unknown> = {
  "HostProc.toggleDevTools": openDevtools,
};

if (isVn && !("argonIpc" in window)) {
  const seen = new Set<string>();
  (window as { argonIpc?: unknown }).argonIpc = {
    async invoke(service: string, method: string): Promise<unknown> {
      const key = `${service}.${method}`;
      if (key in ACTIONS) return ACTIONS[key]();
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
