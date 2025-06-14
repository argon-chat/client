<template>
  <keep-alive :max="10" :key="props.fileId!">
    <div class="relative h-24 w-full rounded-t-2xl overflow-hidden">
      <img v-if="props.fileId && loaded" :src="blobSrc" class="w-full h-full object-cover"
        alt="banner" />
      <div v-else class="w-full h-full bg-gradient-to-r from-gray-900 via-gray-900 to-gray-900" />
    </div>
  </keep-alive>

</template>

<script setup lang="ts">
import { onMounted, ref, watch, type HTMLAttributes } from "vue";
import { useFileStorage } from "@/store/fileStorage";
import { logger } from "@/lib/logger";
const loaded = ref(false);
const loading = ref(true);
const blobSrc = ref("");
const fileStorage = useFileStorage();
const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    fileId?: string;
    userId?: string;
  }>(),
  {},
);

watch(
  () => props.fileId,
  async () => {
    if (!props.userId) return;
    if (!props.fileId) return;

    blobSrc.value = await fileStorage.fetchUserAvatar(
      props.fileId,
      props.userId,
    );
    loaded.value = true;
  },
);

onMounted(async () => {
  if (props.userId) {
    if (!props.fileId) {
      loading.value = false;
      loaded.value = false;
      blobSrc.value = fileStorage.FAILED_ADDRESS;
      return;
    }

    blobSrc.value = await fileStorage.fetchUserAvatar(
      props.fileId,
      props.userId,
    );
    if (blobSrc.value === fileStorage.FAILED_ADDRESS) {
      loading.value = false;
      loaded.value = false;
    } else {
      loading.value = false;
      loaded.value = true;
    }
    return;
  }
  logger.error("no no no mister fish");
});
</script>
<style scoped></style>