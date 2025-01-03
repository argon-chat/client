import { logger } from "@/lib/logger";
import { defineStore } from "pinia";
import { Ref, ref } from "vue";
import { DBSchema, openDB } from "idb";

interface MyDB extends DBSchema {
  objects: {
    value: {
      originalFileId: string;
      bucketFilePath: string;
      insertTime: number;
    };
    key: string;
    indexes: {
      originalFileId: string;
      bucketFilePath: string;
    };
  };
}

export const useFileStorage = defineStore("files", () => {
  const imagesBucket = ref(null as null | StorageBucket);
  const stickersBucket = ref(null as null | StorageBucket);
  const voicesBucket = ref(null as null | StorageBucket);
  const gifsBucket = ref(null as null | StorageBucket);
  const videosBucket = ref(null as null | StorageBucket);
  const filesBucket = ref(null as null | StorageBucket);

  async function initBucket(
    bucketName: string,
    ref: Ref<StorageBucket | null>
  ) {
    if (!("storageBuckets" in navigator)) {
      logger.fatal("Storage Buckets API is not supported");
      throw new Error("Storage Buckets API is not supported");
    }
    try {
      ref.value = await navigator.storageBuckets.open(bucketName, {
        persisted: true,
      });
      const db = await openDB<MyDB>(bucketName, 1, {
        upgrade(db) {
          const store = db.createObjectStore("objects", {
            keyPath: "originalFileId",
          });
          store.createIndex("originalFileId", "originalFileId");
          store.createIndex("bucketFilePath", "bucketFilePath");
        },
      });

      db.close();
      if (!(await ref.value.persisted())) await ref.value.persist();
      logger.success(`Bucket "${bucketName}" success create.`);
    } catch (error) {
      logger.fatal("Storage Buckets API failed open bucket", error);
    }
  }

  async function initStorages() {
    await initBucket("images", imagesBucket);
    await initBucket("stickers", stickersBucket);
    await initBucket("voices", voicesBucket);
    await initBucket("gifs", gifsBucket);
    await initBucket("videos", videosBucket);
    await initBucket("files", filesBucket);
  }


  const FAILED_ADDRESS = "https://none/none.png";
  async function fetchUserAvatar(fileId: string, userId: string) {
    return fetchByFileId({ fileId, bucket: imagesBucket.value!, fileUrlBuilder: (x) => `https://eu.argon.zone/user/${unwrap(userId)}/${x}`, allowFallback: false })
  }
  async function fetchServerAvatar(fileId: string, serverId: string) {
    return fetchByFileId({ fileId, bucket: imagesBucket.value!, fileUrlBuilder: (x) => `https://eu.argon.zone/server/${unwrap(serverId)}/${x}`, allowFallback: false })
  }


  function unwrap(s: string) {
    return s.replaceAll("-", "");
  }

  async function fetchByFileId({
    fileId,
    bucket,
    fileUrlBuilder,
    allowFallback
  }: {
    fileId: string;
    bucket: StorageBucket;
    fileUrlBuilder: (fileId: string) => string;
    allowFallback: boolean
  }): Promise<string> {
    if (!bucket) {
      logger.error(new Error("Bucket is not initialized"));
      if (allowFallback) 
        return fileUrlBuilder(fileId);

      return FAILED_ADDRESS;
    }
  
    const db = await openDB<MyDB>(bucket.name, 1);
  
    try {
      const record = await db.getFromIndex("objects", "originalFileId", fileId);
      if (record) {
        const directory = await bucket.getDirectory();
        const fileHandle = await directory.getFileHandle(record.bucketFilePath);
        const file = await fileHandle.getFile();
        return URL.createObjectURL(file);
      }
  
      const fileUrl = fileUrlBuilder(fileId);
  
      const response = await fetch(fileUrl);
      if (!response.ok) {
        logger.error(new Error(`Failed to fetch file from ${fileUrl}`));
        if (allowFallback) 
          return fileUrlBuilder(fileId);
        return FAILED_ADDRESS;
      }
  
      const blob = await response.blob();
      const filePath = fileId;
  
      const directory = await bucket.getDirectory();
      const fileHandle = await directory.getFileHandle(filePath, { create: true });
      const writable = await fileHandle.createWritable();
  
      await writable.write(blob);
      await writable.close();

      await db.add("objects", {
        originalFileId: fileId,
        bucketFilePath: filePath,
        insertTime: Math.floor(Date.now() / 1000)
      });
  
      return URL.createObjectURL(blob);
    } 
    catch(e) {
      logger.error(e);
      if (allowFallback) 
        return fileUrlBuilder(fileId);
      return FAILED_ADDRESS;
    }
    finally {
      db.close();
    }
  }
  

  return {
    initStorages,
    fetchServerAvatar,
    fetchUserAvatar,
    FAILED_ADDRESS
  };
});
