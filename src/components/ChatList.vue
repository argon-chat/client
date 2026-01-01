<template>
  <div class="chat-list rounded-xl scroll-smooth overflow-y-auto flex flex-col">
    <div class="py-2 overflow-x-hidden" style="text-overflow: ellipsis;">
      <!-- Channels without group -->
      <ChannelItem
        v-for="(channel, index) in sortedUngroupedChannels"
        :key="channel.channelId"
        :channel="channel"
        :group-id="null"
        :index="index"
        :is-active="selectedChannelId === channel.channelId"
        :is-drag-over="dragOverChannel === channel.channelId"
        :voice-users="voiceChannelUsers.get(channel.channelId)"
        @select="channelSelect"
        @delete="channelDelete"
        @dragstart="onDragStart"
        @dragover="onDragOver"
        @drop="onDrop"
        @dragend="onDragEnd"
        @kick-member="kickMember"
      />

      <!-- Channel groups with channels -->
      <div v-for="group in sortedGroups" :key="group.groupId">
        <ContextMenu>
          <ContextMenuTrigger>
            <ChannelGroupHeader 
              :group="group" 
              @toggle="toggleGroup"
            />
          </ContextMenuTrigger>
          <ContextMenuContent class="w-64">
            <ContextMenuItem inset :disabled="!pex.has('ManageChannels')" @click="openAddChannelForGroup(group.groupId)">
              {{ t("add_channel") }}
              <ContextMenuShortcut>⌘+</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        
        <div v-if="!group.isCollapsed">
          <ChannelItem
            v-for="(channel, index) in getGroupChannels(group.groupId)"
            :key="channel.channelId"
            :channel="channel"
            :group-id="group.groupId"
            :index="index"
            :is-active="selectedChannelId === channel.channelId"
            :is-drag-over="dragOverChannel === channel.channelId"
            :voice-users="voiceChannelUsers.get(channel.channelId)"
            @select="channelSelect"
            @delete="channelDelete"
            @dragstart="onDragStart"
            @dragover="onDragOver"
            @drop="onDrop"
            @dragend="onDragEnd"
            @kick-member="kickMember"
          />
        </div>
      </div>
    </div>
  </div>

  <AddChannel
    v-model:open="addChannelInGroupOpened"
    v-model:group-id="selectedGroupId"
    :selected-space="selectedSpaceId"
    @close="addChannelInGroupOpened = false; selectedGroupId = null"
  />
</template>

<script setup lang="ts">
import { computed, ref as vueRef, watch } from 'vue';
import { useSpaceStore } from '@/store/serverStore';
import { usePoolStore } from '@/store/poolStore';
import { useLocale } from '@/store/localeStore';
import { usePexStore } from '@/store/permissionStore';
import { useApi } from '@/store/apiStore';
import { useUnifiedCall } from '@/store/unifiedCallStore';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { logger } from '@/lib/logger';
import { ChannelType } from '@/lib/glue/argonChat';
import ChannelItem from './ChannelItem.vue';
import ChannelGroupHeader from './ChannelGroupHeader.vue';
import AddChannel from './modals/AddChannel.vue';
import { useChannelGroups } from '@/composables/useChannelGroups';
import { useChannelDragDrop } from '@/composables/useChannelDragDrop';
import type { Guid } from '@argon-chat/ion.webcore';

const servers = useSpaceStore();
const pool = usePoolStore();
const voice = useUnifiedCall();
const pex = usePexStore();
const api = useApi();
const { t } = useLocale();

const selectedSpaceId = defineModel<string>('selectedSpace', {
  type: String, 
  required: true
});

const selectedChannelId = defineModel<string>('selectedChannelId', {
  type: String, 
  required: true
});

const channelLists = pool.useActiveServerChannels(selectedSpaceId);

// Computed для кеширования информации о голосовых каналах
const voiceChannelUsers = computed(() => {
  const result = new Map();
  for (const channel of channelLists.value) {
    if (channel.type === ChannelType.Voice) {
      const realtimeChannel = pool.realtimeChannelUsers.get(channel.channelId);
      if (realtimeChannel && realtimeChannel.Users.size > 0) {
        result.set(channel.channelId, realtimeChannel);
      }
    }
  }
  return result;
});

// Use channel groups composable
const { sortedGroups, toggleGroup, updateGroups, sortByFractionalIndex } = useChannelGroups(selectedSpaceId);

// Watch for channel list changes which might indicate group updates
watch(channelLists, () => {
  updateGroups();
}, { deep: true });

// Get channels without group (groupId is null)
const sortedUngroupedChannels = computed(() => {
  const channels = channelLists.value.filter(c => c.groupId === null);
  return sortByFractionalIndex(channels);
});

// Get channels for specific group
const getGroupChannels = (groupId: Guid) => {
  const channels = channelLists.value.filter(c => c.groupId === groupId);
  return sortByFractionalIndex(channels);
};

// Use drag and drop composable
const { dragOverChannel, onDragStart, onDragOver, onDrop, onDragEnd } = useChannelDragDrop(
  selectedSpaceId,
  sortedUngroupedChannels,
  getGroupChannels
);

// Add channel to group state
const addChannelInGroupOpened = vueRef(false);
const selectedGroupId = vueRef<Guid | null>(null);

const openAddChannelForGroup = (groupId: Guid) => {
  selectedGroupId.value = groupId;
  addChannelInGroupOpened.value = true;
};

async function channelSelect(channelId: string) {
  logger.info(`Do action for channel '${channelId}'`);
  const channel = await pool.getChannel(channelId);

  if (channel && channel.type !== ChannelType.Voice) {
    pool.selectedTextChannel = channel.channelId;
  } else {
    logger.warn('no found channel for ', channelId, channel);
  }
  selectedChannelId.value = channelId;
  logger.info(`Do action for channel`, channel);

  if (voice.isConnected) {
    return;
  }

  if (!channel) {
    logger.warn('no found channel for ', channelId);
    return;
  }
  if (channel.type === ChannelType.Voice) {
    await voice.joinVoiceChannel(channelId);
  }
}

async function channelDelete(channelId: string) {
  await servers.deleteChannel(channelId);
}

const kickMember = async (userId: string, channelId: string, spaceId: string) => {
  await api.channelInteraction.KickMemberFromChannel(spaceId, channelId, userId);
};
</script>

<style scoped>
.chat-list {
  background-color: #161616f5;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  height: 100%;
}

/* Chrome, Edge, Safari */
.chat-list::-webkit-scrollbar {
  width: 4px !important;
}

.chat-list::-webkit-scrollbar-track {
  background: transparent;
}

.chat-list::-webkit-scrollbar-thumb {
  background: #3d3d3d;
  border-radius: 8px;
}

.chat-list::-webkit-scrollbar-thumb:active {
  background: #555;
}

/* Firefox */
.chat-list {
  scrollbar-width: thin;
  scrollbar-color: #3d3d3d transparent;
}
</style>