/** The SDK's window object, used directly by application controls. */
export interface AppWindow extends EventTarget {
  minimize(): void; toggleMaximize(): void; close(): void; isMaximized(): boolean; isFullscreen(): boolean;
  /** Shows and raises the window, including one an autostart left hidden. */
  show(): void;
  readonly scaleFactor: number; theme: string;
}
export const appWindow = (globalThis as { __VN_WINDOW__?: { appWindow?: AppWindow } }).__VN_WINDOW__?.appWindow;
