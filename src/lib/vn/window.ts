/**
 * `window.windowManagement`, the Electron preload's window bridge, answered by vue-native's own
 * `appWindow` (vue-native docs/WINDOWING.md §3). AppTitlebar's minimize, maximize and close buttons
 * and its maximize icon go through this. Without it the frameless window's only chrome would be
 * dead buttons. client-gap/C-host-cookie.md, the frameless-window row.
 *
 * Electron's `maximize()` toggles, and AppTitlebar reads `isMaximized()` right after it, so it maps
 * onto `toggleMaximize()`. `setZoom` has no vue-native counterpart yet. It is a logged no-op.
 */
import { isVn } from "./index";

interface AppWindowLike extends EventTarget {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): boolean;
}

// The public spelling is `import { appWindow } from "vue-native"`. The window prelude's own global is
// read instead, so this file still resolves in the Vite build, where there is no "vue-native".
const appWindow = (globalThis as { __VN_WINDOW__?: { appWindow?: AppWindowLike } }).__VN_WINDOW__?.appWindow;

if (isVn && appWindow && !("windowManagement" in window)) {
  let zoomWarned = false;
  (window as { windowManagement?: unknown }).windowManagement = {
    minimize: () => appWindow.minimize(),
    maximize: () => appWindow.toggleMaximize(),
    close: () => appWindow.close(),
    isMaximized: async () => appWindow.isMaximized(),
    onMaximizeChange(callback: (isMaximized: boolean) => void): () => void {
      const on = () => callback(true);
      const off = () => callback(false);
      appWindow.addEventListener("maximize", on);
      appWindow.addEventListener("unmaximize", off);
      return () => {
        appWindow.removeEventListener("maximize", on);
        appWindow.removeEventListener("unmaximize", off);
      };
    },
    setZoom(_factor: number): void {
      if (zoomWarned) return;
      zoomWarned = true;
      console.warn("[vue-native] windowManagement.setZoom: page zoom is not available here; ignored");
    },
  };
}
