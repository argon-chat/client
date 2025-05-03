export {};

declare global {
  interface WebSocketConnection<
    T extends Uint8Array | string = Uint8Array | string,
  > {
    readable: ReadableStream<T>;
    writable: WritableStream<T>;
    protocol: string;
    extensions: string;
  }
  interface WebSocketCloseInfo {
    closeCode?: number;
    reason?: string;
  }
  interface WebSocketStreamOptions {
    protocols?: string[];
    signal?: AbortSignal;
  }

  declare class WebSocketStream<
    T extends Uint8Array | string = Uint8Array | string,
  > {
    readonly url: string;
    readonly opened: Promise<WebSocketConnection<T>>;
    readonly closed: Promise<WebSocketCloseInfo>;
    readonly close: (closeInfo?: WebSocketCloseInfo) => void;
    constructor(url: string, options?: WebSocketStreamOptions);
  }

  interface Window {
    ui_version: string;
    ui_buildtime: string;
    ui_fullversion: string;
    ui_branch: string;
  }
}
