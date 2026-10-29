/**
 * `window.argonIpc` under vue-native: a no-op, never a bridge.
 *
 * The Electron preload's IPC is legacy, and vue-native has none. With the desktop identity
 * (identity.ts), the boot path still awaits it. `useConfigStore().load()` iterates
 * `HostProc.getConfig()`, and without an answer the init loop failed on "Loading configurations…"
 * until it gave up. The taskbar jump list, the thumbnail buttons and the theme sync call it as well.
 * An owner decision (vue-native m26, Phase 1) settled this: a minimal no-op, not an emulation.
 * Every call resolves to "nothing", except where the caller iterates the answer, and each
 * service.method is logged once so the remaining callers stay visible.
 *
 * Installed by main.ts right after identity.ts, before @argon/glue looks for the bridge.
 */
import { isVn } from "./index";

/** Answers a caller cannot do without. Everything else resolves to `undefined`. */
const ANSWERS: Record<string, unknown> = {
  // configStore.load(): a list of sections. None, because the host has no config of its own.
  "HostProc.getConfig": [],
};

if (isVn && !("argonIpc" in window)) {
  const seen = new Set<string>();
  (window as { argonIpc?: unknown }).argonIpc = {
    async invoke(service: string, method: string): Promise<unknown> {
      const key = `${service}.${method}`;
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
