import { logger } from "@/lib/logger";
import { defineStore } from "pinia";
import { Ref, ref } from "vue";
import { DBSchema, openDB } from "idb";

interface MyDB extends DBSchema {
  objects: {
    value: {
      originalFileId: string,
      bucketFilePath: string
    };
    key: string;
    indexes: { 
      'originalFileId': string,
      'bucketFilePath': string,
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

  async function initBucket(bucketName: string, ref: Ref<StorageBucket | null>) {
    if (!('storageBuckets' in navigator)) {
      logger.fatal('Storage Buckets API is not supported');
      throw new Error('Storage Buckets API is not supported');
    }
    try {
      ref.value = await navigator.storageBuckets.open(bucketName, {
        persisted: true,
      });
      const db = await openDB<MyDB>(bucketName, 1, {
        upgrade(db) {
          const store = db.createObjectStore("objects");
          store.createIndex("originalFileId", "originalFileId");
          store.createIndex("bucketFilePath", "bucketFilePath");
        },
      }); 


      db.close();
      if (!await ref.value.persisted())
        await ref.value.persist()
      logger.success(`Bucket "${bucketName}" success create.`);
    } catch (error) {
      logger.fatal('Storage Buckets API failed open bucket', error);
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
/*
  async function avatar(fileId: string) {
    const dir = await imagesBucket.value!.getDirectory();
    const index = await imagesBucket.value?.indexedDB.open("", 1);
    index?.transaction?.objectStore("ids").createIndex()
  }
*/

  return {
    initStorages
  }
});
