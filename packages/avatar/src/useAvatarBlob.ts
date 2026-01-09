import { ref, watch, inject, type Ref } from "vue";
import { AvatarFileStorageKey, type IAvatarFileStorage } from "./types";

const avatarCache = new Map<string, string>();

type AvatarType = "user" | "server";

function makeCacheKey(
  type: AvatarType,
  fileId: string | null,
  ownerId: string | null | undefined,
) {
  return `${type}:${ownerId ?? "unknown"}:${fileId ?? "null"}`;
}

export function useAvatarBlob(
  fileId: Ref<string | null>,
  ownerId: Ref<string | null | undefined>,
  type: AvatarType | Ref<AvatarType>,
  fileStorage?: IAvatarFileStorage,
) {
  const loaded = ref(false);
  const loading = ref(true);
  const blobSrc = ref("");
  
  const injectedStorage = inject(AvatarFileStorageKey, null);
  const storage = fileStorage ?? injectedStorage;
  
  if (!storage) {
    throw new Error("[useAvatarBlob] No file storage provided. Either pass it as argument or provide via AvatarFileStorageKey injection.");
  }

  const avatarType = typeof type === 'string' ? ref(type) : type;

  const fetchAvatar = async () => {
    if (!ownerId.value || !fileId.value) {
      loading.value = false;
      loaded.value = false;
      blobSrc.value = storage.FAILED_ADDRESS;
      return;
    }

    const key = makeCacheKey(avatarType.value, fileId.value, ownerId.value);

    if (avatarCache.has(key)) {
      const cachedSrc = avatarCache.get(key);
      if (cachedSrc) {
        blobSrc.value = cachedSrc;
        loading.value = false;
        loaded.value = blobSrc.value !== storage.FAILED_ADDRESS;
        return;
      }
    }

    loading.value = true;
    let src: string;

    if (avatarType.value === "user") {
      src = await storage.fetchUserAvatar(fileId.value, ownerId.value);
    } else if (avatarType.value === "server") {
      src = await storage.fetchServerAvatar(fileId.value, ownerId.value);
    } else {
      throw new Error(`Unknown avatar type: ${avatarType.value}`);
    }

    avatarCache.set(key, src);
    blobSrc.value = src;
    loading.value = false;
    loaded.value = src !== storage.FAILED_ADDRESS;
  };

  watch([fileId, ownerId, avatarType], fetchAvatar, { immediate: true });

  return {
    loaded,
    loading,
    blobSrc,
  };
}
