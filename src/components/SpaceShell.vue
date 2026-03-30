<script setup lang="ts">
import { usePoolStore } from '@/store/data/poolStore';
import ChannelChat from './ChannelChat.vue';
import LeftSideUserList from './LeftSideUserList.vue';
import SpaceSideShell from './SpaceSideShell.vue';
import { computed, watch } from 'vue';
import { logger } from '@argon/core';
import { useRoute, useRouter } from 'vue-router';
import { getLastChannel } from '@/lib/recentSpaces';

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

// Auto-select last visited channel (or first available) when navigating to a space without a channel
const channelList = pool.useActiveServerChannels(selectedSpace);

watch(
  [selectedSpace, channelList],
  ([spaceId, channels]) => {
    if (!spaceId || selectedChannelId.value || channels.length === 0) return;

    const lastId = getLastChannel(spaceId);
    if (lastId && channels.some(c => c.channelId === lastId)) {
      selectedChannelId.value = lastId;
    } else {
      selectedChannelId.value = channels[0].channelId;
    }
  },
  { immediate: true }
);
</script>

<template>
    <div class="server-workspace flex flex-1 gap-4" v-if="selectedSpace">
        <SpaceSideShell v-model:selected-channel-id="selectedChannelId" v-model:selected-space="selectedSpace" />
        <ChannelChat v-model:selected-channel-id="selectedChannelId" v-model:selected-space="selectedSpace" class="chat-container flex-1 min-w-0 flex-col overflow-hidden" />
        <LeftSideUserList v-model:selected-space="selectedSpace"/>
    </div>
</template>

<style lang="css" scoped>
.chat-container {
  background-color: transparent;
  border-radius: 15px;
}
</style>