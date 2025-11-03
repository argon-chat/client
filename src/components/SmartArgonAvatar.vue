<template>
  <keep-alive :max="10" :key="props.userId">
    <Avatar :class="props.class" :style="{ width: size, height: size }">
      <Skeleton v-if="loading" style="height: 100%; width: 100%; background-color: #494949;" :class="props.class" />
      <video playsinline autoplay muted loop v-else-if="!loading && loaded" :poster="blobSrc" :src="blobSrc"
        disablePictureInPicture controlslist="nodownload nofullscreen noremoteplayback" />
      <AvatarFallback v-if="!loading && !loaded">{{ fallbackLetter }}</AvatarFallback>
    </Avatar>
  </keep-alive>
</template>

<script setup lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { computed, ref, watch, type HTMLAttributes } from "vue";
import { useFileStorage } from "@/store/fileStorage";
import { usePoolStore } from "@/store/poolStore";
import { logger } from "@/lib/logger";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    userId: string;
    overridedSize?: number | 'auto';
  }>(),
  {
    overridedSize: undefined,
  },
);

const pool = usePoolStore();
const fileStorage = useFileStorage();

const loading = ref(true);
const loaded = ref(false);
const blobSrc = ref("");
const fallbackLetter = ref("?");

const size = computed(() =>
  props.overridedSize ? (props.overridedSize == 'auto' ? 'auto' : `${props.overridedSize}px`) : null,
);

const user = pool.getUserReactive(props.userId);

watch(
  () => user.value?.avatarFileId,
  async (fileId) => {
    loading.value = true;
    loaded.value = false;

    if (!fileId) {
      logger.warn("User has no avatar fileId");
      blobSrc.value = fileStorage.FAILED_ADDRESS;
      fallbackLetter.value =
        user.value?.displayName?.at(0)?.toUpperCase() ?? "?";
      loading.value = false;
      return;
    }

    try {
      fallbackLetter.value =
        user.value?.displayName?.at(0)?.toUpperCase() ?? "?";

      const src = await fileStorage.fetchUserAvatar(fileId, props.userId);
      blobSrc.value = src;
      loaded.value = src !== fileStorage.FAILED_ADDRESS;
    } catch (e) {
      logger.error("Error loading avatar:", e);
      blobSrc.value = fileStorage.FAILED_ADDRESS;
      fallbackLetter.value = "?";
      loaded.value = false;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>
