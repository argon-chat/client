import type { IHostProc, IOverlayController } from "./argon.ipc";

// Electron-specific extensions to IHostProc (not in auto-generated .ion types)
declare module "./argon.ipc" {
  interface IHostProc {
    getScreenSources(types: string[]): Promise<ScreenSourceInfo[]>;
    setPendingScreenSource(sourceId: string, includeAudio: boolean): Promise<boolean>;
  }
}

export interface ScreenSourceInfo {
  id: string;
  name: string;
  thumbnailDataUrl: string;
  appIconDataUrl: string | null;
  displayId: string;
}

interface ArgonIpcBridge {
  invoke(service: string, method: string, args: any[]): Promise<any>;
  onEvent(callback: (event: any) => void): void;
  onPinnedFn(callback: (fnId: number, data: any) => void): void;
}

declare global {
  interface Window {
    argonIpc: ArgonIpcBridge;
  }
}


function createServiceProxy<T>(serviceName: string): T {
  return new Proxy({} as any, {
    get(_target, methodName) {
      if (typeof methodName !== "string") return undefined;
      return (...args: any[]) =>
        window.argonIpc.invoke(serviceName, methodName, JSON.parse(JSON.stringify(args)));
    },
  }) as T;
}

export interface NativeEventPayload {
  type: "AudioPlaying" | "AudioPlayingEnd" | "ProcessPlaying" | "ProcessEnd"
    | "ActivityLog" | "HotKeyTriggered" | "OverlayStarted" | "OverlayEnded";
  [key: string]: any;
}

type PinnedFnCallback = (data: any) => void;
const pinnedFnCallbacks = new Map<number, PinnedFnCallback>();

export interface ElectronClient {
  HostProc: IHostProc;
  OverlayController: IOverlayController;
  onNativeEvent(callback: (event: NativeEventPayload) => void): void;
  registerPinnedCallback(fnId: number, callback: PinnedFnCallback): void;
}

let pinnedFnListenerSetup = false;

export function createElectronClient(): ElectronClient {
  if (!pinnedFnListenerSetup && window.argonIpc) {
    pinnedFnListenerSetup = true;
    window.argonIpc.onPinnedFn((fnId, data) => {
      const cb = pinnedFnCallbacks.get(fnId);
      if (cb) cb(data);
    });
  }

  return {
    HostProc: createServiceProxy<IHostProc>("HostProc"),
    OverlayController: createServiceProxy<IOverlayController>("OverlayController"),

    onNativeEvent(callback: (event: NativeEventPayload) => void): void {
      window.argonIpc?.onEvent(callback);
    },

    registerPinnedCallback(fnId: number, callback: PinnedFnCallback): void {
      pinnedFnCallbacks.set(fnId, callback);
    },
  };
}
