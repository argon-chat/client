<script setup lang="ts">
import { usePoolStore } from '@/store/data/poolStore';
import ChannelChat from './ChannelChat.vue';
import LeftSideUserList from './LeftSideUserList.vue';
import SpaceSideShell from './SpaceSideShell.vue';

import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { XIcon } from 'lucide-vue-next';
import { getLastChannel } from '@/lib/recentSpaces';
import { useLocale } from '@/store/system/localeStore';
import { splitOpen, secondaryChannelId, secondarySpaceId, closeSplit, splitFeatureEnabled } from '@/composables/useSplitView';
import { useMemberList } from '@/composables/useMemberList';

const { t } = useLocale();
const { visible: memberListVisible, overlay: memberListOverlay } = useMemberList();
const splitActive = computed(() => splitFeatureEnabled.value && splitOpen.value);
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
    <div class="server-workspace relative flex flex-1 gap-4" v-if="selectedSpace">
        <SpaceSideShell v-model:selected-channel-id="selectedChannelId" v-model:selected-space="selectedSpace" />

        <!-- Primary pane -->
        <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
            <ChannelChat v-model:selected-channel-id="selectedChannelId" v-model:selected-space="selectedSpace" class="chat-container flex-1 min-w-0 flex-col overflow-hidden" />
        </div>

        <!-- Secondary pane (split view) -->
        <div v-if="splitActive && secondaryChannelId" class="split-pane flex-1 min-w-0 flex flex-col overflow-hidden relative">
            <button class="split-close icon-motion icon-motion--pop" @click="closeSplit" :title="t('close')">
                <XIcon class="w-4 h-4" />
            </button>
            <ChannelChat
                :selected-channel-id="secondaryChannelId"
                :selected-space="secondarySpaceId"
                class="chat-container flex-1 min-w-0 flex-col overflow-hidden"
            />
        </div>

        <!-- Beside the chat on a wide window; on a narrow one, over the chat's right edge when
             the header's toggle opens it (useMemberList). -->
        <LeftSideUserList
            v-if="!splitActive && memberListVisible"
            v-model:selected-space="selectedSpace"
            :class="{ 'member-list-overlay': memberListOverlay }"
        />
    </div>
</template>

<style lang="css" scoped>
.chat-container {
  border-radius: var(--radius);
}

.split-pane {
  border-left: 1px solid hsl(var(--border) / 0.5);
}

/* The member list over the chat: the chat keeps the whole width, and the list is opaque, since
   the chat's text would show through the card's translucent background. It starts below the
   chat's header (h-12), so the header's toggle that opened it stays in reach to close it. */
.server-workspace > .member-list-overlay {
  position: absolute;
  top: 3rem;
  right: 0;
  bottom: 0;
  z-index: 30;
  background-color: hsl(var(--card));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.split-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: hsl(var(--card) / 0.8);
  backdrop-filter: blur(4px);
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.split-close:hover {
  background: hsl(var(--destructive) / 0.15);
  color: hsl(var(--destructive));
}
</style>