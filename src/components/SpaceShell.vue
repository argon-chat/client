<script setup lang="ts">
import { usePoolStore } from '@/store/poolStore';
import ChannelChat from './ChannelChat.vue';
import LeftSideUserList from './LeftSideUserList.vue';
import SpaceSideShell from './SpaceSideShell.vue';
import { computed, watch } from 'vue';
import { logger } from '@/lib/logger';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const pool = usePoolStore();

const selectedSpace = computed(() => {
  const id = route.params.id as string | undefined;
  return id ?? null;
});

watch(
  selectedSpace,
  (id) => {
    pool.selectedServer = id;
  },
  { immediate: true }
);

const selectedChannelId = computed({
  get: () => (route.params.channelId as string) || '',
  set: (channelId: string) => {
    if (channelId && selectedSpace.value) {
      router.push({
        name: 'SpaceChannel',
        params: {
          id: selectedSpace.value,
          channelId
        }
      });
    }
  }
});

watch(selectedChannelId, (x) => {
  logger.warn("SpaceShell, selectedChannelId", x);
});

</script>

<template>
    <div class="server-workspace flex flex-1 gap-4" v-if="selectedSpace">
        <SpaceSideShell v-model:selected-channel-id="selectedChannelId" v-model:selected-space="selectedSpace" />
        <ChannelChat v-model:selected-channel-id="selectedChannelId" v-model:selected-space="selectedSpace" class="chat-container flex-1 min-w-0 flex-col rounded-xl shadow-md justify-between overflow-hidden" />
        <LeftSideUserList v-model:selected-space="selectedSpace"/>
    </div>
</template>

<style lang="css" scoped>
.chat-container {
  background-color: transparent;
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style>