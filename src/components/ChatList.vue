<template>
  <div class="chat-list rounded-xl scroll-smooth overflow-y-auto flex flex-col">
    <div class="py-2 overflow-x-hidden" style="text-overflow: ellipsis;">
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
        @switch-voice="switchVoiceChannel"
        @delete="channelDelete"
        @dragstart="onDragStart"
        @dragover="onDragOver"
        @drop="onDrop"
        @dragend="onDragEnd"
        @kick-member="kickMember"
      />
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
            @switch-voice="switchVoiceChannel"
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
} from '@argon/ui/context-menu';
import { logger } from '@argon/core';
import { ChannelType } from '@argon/glue';
import ChannelItem from './ChannelItem.vue';
import ChannelGroupHeader from './ChannelGroupHeader.vue';
import AddChannel from './modals/AddChannel.vue';
import { useChannelGroups } from '@/composables/useChannelGroups';
import { useChannelDragDrop } from '@/composables/useChannelDragDrop';
import type { Guid } from '@argon-chat/ion.webcore';
import type { IRealtimeChannel } from '@/store/realtimeStore';

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

const voiceChannelUsers = computed(() => {
  const result = new Map<Guid, IRealtimeChannel>();
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

const { sortedGroups, toggleGroup, updateGroups, sortByFractionalIndex } = useChannelGroups(selectedSpaceId);

watch(channelLists, () => {
  updateGroups();
}, { deep: true });

const sortedUngroupedChannels = computed(() => {
  const channels = channelLists.value.filter(c => c.groupId === null);
  return sortByFractionalIndex(channels);
});

const getGroupChannels = (groupId: Guid) => {
  const channels = channelLists.value.filter(c => c.groupId === groupId);
  return sortByFractionalIndex(channels);
};

// https://github.com/microsoft/microsoft-ui-xaml/issues/10576
const { dragOverChannel, onDragStart, onDragOver, onDrop, onDragEnd } = useChannelDragDrop(
  selectedSpaceId,
  sortedUngroupedChannels,
  getGroupChannels
);

const addChannelInGroupOpened = vueRef(false);
const selectedGroupId = vueRef<Guid | null>(null);

const openAddChannelForGroup = (groupId: Guid) => {
  selectedGroupId.value = groupId;
  addChannelInGroupOpened.value = true;
};

async function channelSelect(channelId: string) {
  logger.info(`Do action for channel '${channelId}'`);
  const channel = await pool.getChannel(channelId);

  if (!channel) {
    logger.warn('no found channel for ', channelId);
    return;
  }

  // Always update selected channel for view switching
  selectedChannelId.value = channelId;

  // Handle different channel types
  switch (channel.type) {
    case ChannelType.Text:
    case ChannelType.Announcement:
      // Text and Announcement channels just open the view
      pool.selectedTextChannel = channel.channelId;
      break;

    case ChannelType.Voice:
      // Voice channel: join only if not already connected to any voice channel
      if (!voice.isConnected) {
        await voice.joinVoiceChannel(channelId);
      }
      // If already connected, just switch the view (selectedChannelId already set above)
      break;
  }

  logger.info(`Channel selected`, channel);
}

async function switchVoiceChannel(channelId: string) {
  const channel = await pool.getChannel(channelId);
  
  if (!channel || channel.type !== ChannelType.Voice) {
    return;
  }

  // Only switch if it's a different voice channel
  if (voice.connectedVoiceChannelId === channelId) {
    return;
  }

  // Leave current voice channel and join the new one
  if (voice.isConnected) {
    await voice.leave();
  }
  
  selectedChannelId.value = channelId;
  await voice.joinVoiceChannel(channelId);
  
  logger.info(`Switched to voice channel`, channel);
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
  background-color: hsl(var(--card));
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