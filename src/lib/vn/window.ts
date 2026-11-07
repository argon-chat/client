/** The SDK's window object, used directly by application controls. */
export interface AppWindow extends EventTarget {
  minimize(): void; toggleMaximize(): void; close(): void; isMaximized(): boolean;
  readonly scaleFactor: number; theme: string;
}
export const appWindow = (globalThis as { __VN_WINDOW__?: { appWindow?: AppWindow } }).__VN_WINDOW__?.appWindow;
