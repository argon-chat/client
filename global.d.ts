import { ObjectDirective } from "vue";
import type { IonDateTime } from "@argon-chat/ion.webcore";
export {};
type ArgonEntitlementUnion = 
  | 'None'
  | 'ViewChannel'
  | 'ReadHistory'
  | 'JoinToVoice'
  | 'Base'
  | 'SendMessages'
  | 'SendVoice'
  | 'AttachFiles'
  | 'AddReactions'
  | 'AnyMentions'
  | 'MentionEveryone'
  | 'ExternalEmoji'
  | 'ExternalStickers'
  | 'UseCommands'
  | 'PostEmbeddedLinks'
  | 'BaseChat'
  | 'Connect'
  | 'Speak'
  | 'Video'
  | 'Stream'
  | 'BaseMedia'
  | 'BaseMember'
  | 'UseASIO'
  | 'AdditionalStreams'
  | 'BaseExtended'
  | 'DisconnectMember'
  | 'MoveMember'
  | 'BanMember'
  | 'MuteMember'
  | 'KickMember'
  | 'ModerateMembers'
  | 'ManageChannels'
  | 'ManageArchetype'
  | 'ManageBots'
  | 'ManageEvents'
  | 'ManageBehaviour'
  | 'ManageServer'
  | 'ControlServer'
  | 'Administrator';

declare module '@vue/runtime-core' {
    interface GlobalDirectives {
        vPex: Directive<HTMLElement, ArgonEntitlementUnion>;
    }
}

declare module '@vue/reactivity' {
    // `UnwrapRef` rewrites every class instance it reaches into a plain mapped type of its
    // public members. `IonDateTime` has a private `localTicks` getter, so the rewritten shape
    // is no longer assignable back to `IonDateTime` and every `ref`/`reactive`/`computed`
    // holding an Ion payload starts failing at the first function that expects the real type.
    // It is an immutable value object with no nested refs, so there is nothing to unwrap —
    // bail it out, which is exactly what this interface exists for.
    interface RefUnwrapBailTypes {
        ionValueTypes: IonDateTime;
    }
}
declare global {
  interface NavigatorStorageBuckets {
    readonly storageBuckets: StorageBucketManager;
  }

  interface WorkerNavigatorStorageBuckets {
    readonly storageBuckets: StorageBucketManager;
  }

  interface Navigator extends NavigatorStorageBuckets {}
  interface WorkerNavigator extends WorkerNavigatorStorageBuckets {}

  interface StorageBucketManager {
    open(name: string, options?: StorageBucketOptions): Promise<StorageBucket>;
    keys(): Promise<string[]>;
    delete(name: string): Promise<void>;
  }

  interface StorageBucketOptions {
    persisted?: boolean;
    quota?: number;
    expires?: DOMHighResTimeStamp;
    durability:? 'relaxed'
  }

  interface ExtendedStorageManager extends StorageBucket {
    getFileHandle(name: string, opt?: any): Promise<FileSystemHandle>; 
  }

  interface StorageBucket extends StorageManager {
    readonly name: string;

    setExpires(expires: DOMHighResTimeStamp): Promise<void>;
    expires(): Promise<DOMHighResTimeStamp | null>;

    readonly indexedDB: IDBFactory;
    readonly caches: CacheStorage;

    getDirectory(): Promise<FileSystemDirectoryHandle>;
  }
}

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

declare global {
  /**
   * What this build is, inlined by vite — see `scripts/buildInfo.ts`.
   *
   * A compile-time constant rather than a module, so it costs nothing at runtime and cannot be out
   * of date: whatever produced the bundle is what is in it.
   *
   * Inside `declare global` because this file carries top-level imports, which makes it a module —
   * a bare `declare const` here would be visible to nothing.
   */
  const __ARGON_BUILD__: {
    readonly version: string;
    readonly fullVersion: string;
    readonly branch: string;
    readonly commit: string;
    readonly builtAt: string;
    readonly dirty: boolean;
  };
}
