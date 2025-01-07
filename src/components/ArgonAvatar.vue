<template>
  <Avatar :class="props.class">
    <Skeleton style="height: 100%; width: 100%; background-color: #494949;" v-if="loading" :class="props.class" />
    <AvatarImage v-if="!loading && loaded" :src="blobSrc" />
    <AvatarFallback v-if="!loading && !loaded">{{ props.fallback }}</AvatarFallback>
  </Avatar>
</template>

<script setup lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { onMounted, ref, type HTMLAttributes } from 'vue'
import { useFileStorage } from "@/store/fileStorage";
import { logger } from '@/lib/logger';
const loaded = ref(false);
const loading = ref(true);
const blobSrc = ref("");
const fileStorage = useFileStorage();
const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class'],
  fileId: string | null,
  fallback: string,
  serverId?: string,
  userId?: string
}>(), {});


onMounted(async () => {
  if (props.userId) {
    if(!props.fileId) {
      loading.value = false;
      loaded.value = false;
      blobSrc.value = fileStorage.FAILED_ADDRESS;
      return;
    }

    blobSrc.value = await fileStorage.fetchUserAvatar(props.fileId, props.userId);
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