export {};
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
  }

  interface StorageBucket extends StorageManager {
    readonly name: string;

    setExpires(expires: DOMHighResTimeStamp): Promise<void>;
    expires(): Promise<DOMHighResTimeStamp | null>;

    readonly indexedDB: IDBFactory;
    readonly caches: CacheStorage;

    getDirectory(): Promise<StorageManager>;
  }
}
