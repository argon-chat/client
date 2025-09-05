import { ObjectDirective } from "vue";
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
