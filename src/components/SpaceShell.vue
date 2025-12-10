<script setup lang="ts">
import { usePoolStore } from '@/store/poolStore';
import ChannelChat from './ChannelChat.vue';
import LeftSideUserList from './LeftSideUserList.vue';
import SpaceSideShell from './SpaceSideShell.vue';
import { computed, ref, watch } from 'vue';
import { logger } from '@/lib/logger';
import { useRoute } from 'vue-router';

const route = useRoute();
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

const selectedChannelId = ref('');

watch(selectedChannelId, (x) => {
  logger.warn("SpaceShell, selectedChannelId", x);
});

</script>

<template>
    <div class="server-workspace flex flex-1 gap-4" v-if="selectedSpace">
        <SpaceSideShell v-model:selected-channel-id="selectedChannelId" v-model:selected-space="selectedSpace" />
        <ChannelChat v-model:selected-channel-id="selectedChannelId" v-model:selected-space="selectedSpace" class="chat-container flex-1 flex-col rounded-xl shadow-md justify-between" />
        <LeftSideUserList v-model:selected-space="selectedSpace"/>
    </div>
</template>

<style lang="css" scoped>
.chat-container {
  background-color: #161616f5;
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style>