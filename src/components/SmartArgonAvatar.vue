<template>
  <Avatar :class="props.class" :style="{
    width: size,
    height: size,
    ...avatarRootStyle
  }">
    <Skeleton v-if="loading" style="height: 100%; width: 100%; background-color: #494949;" :class="props.class" />

    <video v-else-if="!loading && loaded" playsinline autoplay muted loop :poster="blobSrc" :src="blobSrc"
      disablePictureInPicture controlslist="nodownload nofullscreen noremoteplayback" />

    <AvatarFallback v-else>
      {{ fallbackLetter }}
    </AvatarFallback>
  </Avatar>
</template>
<script setup lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { computed, ref, toRef, watch, type HTMLAttributes } from "vue";
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

const user = pool.getUserReactive(toRef(props, "userId"));


const isCallUser = computed(() =>
  props.userId.toLocaleUpperCase().startsWith("CFFFFFFF")
);

const avatarRootStyle = computed(() => {
  if (!isCallUser.value) return {};
  return {
    backgroundColor: "#ff8b00",
    color: "white",
  };
});

watch(
  () => user.value?.avatarFileId,
  async (fileId) => {
    loading.value = true;
    loaded.value = false;

    if (!fileId) {
      blobSrc.value = fileStorage.FAILED_ADDRESS;
      fallbackLetter.value =
        user.value?.displayName?.at(0)?.toUpperCase() ?? "?";
      loading.value = false;
      return;
    }

    try {
      fallbackLetter.value = isCallUser.value
        ? "📞"
        : (user.value?.displayName?.at(0)?.toUpperCase() ?? "?");

      const src = await fileStorage.fetchUserAvatar(fileId, props.userId);
      blobSrc.value = src;
      loaded.value = src !== fileStorage.FAILED_ADDRESS;
    } catch (e) {
      logger.error("Error loading avatar:", e);
      blobSrc.value = fileStorage.FAILED_ADDRESS;
      fallbackLetter.value = isCallUser.value ? "📞" : "?";
      loaded.value = false;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>
