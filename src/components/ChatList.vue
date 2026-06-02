<template>
  <div class="chat-list flex flex-col">
    <div class="chat-list-scroll">
      <!-- Loading skeletons -->
      <template v-if="channelsLoading && channelLists.length === 0">
        <div v-for="i in 8" :key="`ch-sk-${i}`" class="channel-skeleton">
          <Skeleton class="h-4 w-4 rounded shrink-0" />
          <Skeleton class="h-3 rounded" :style="{ width: `${42 + (i * 13) % 44}%` }" />
        </div>
      </template>

      <!-- Empty state -->
      <div v-else-if="channelLists.length === 0" class="empty-state">
        <div class="empty-state-icon">
          <HashIcon class="w-8 h-8 text-muted-foreground/40" />
        </div>
        <p class="text-sm text-muted-foreground/60">{{ t("no_channels") || "No channels yet" }}</p>
        <button 
          v-if="pex.has('ManageChannels')"
          class="empty-state-btn"
          @click="openAddChannelForGroup(null)"
        >
          <PlusIcon class="w-4 h-4" />
          {{ t("add_channel") }}
        </button>
      </div>

      <template v-else>
        <!-- Ungrouped channels -->
        <TransitionGroup name="channel-list" tag="div">
          <ChannelItem
            v-for="(channel, index) in sortedUngroupedChannels"
            :key="channel.channelId"
            :channel="channel"
            :group-id="null"
            :index="index"
            :is-active="selectedChannelId === channel.channelId"
            :is-drag-over="dragOverChannel === channel.channelId"
            :drop-position="dragOverChannel === channel.channelId ? dropPosition : undefined"
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
        </TransitionGroup>

        <!-- Ungrouped tail drop zone -->
        <div
          v-if="draggedChannel && sortedUngroupedChannels.length > 0"
          class="tail-drop-zone"
          @dragover.prevent
          @drop="onTailDrop(null, $event)"
        />

        <!-- Groups -->
        <div v-for="group in sortedGroups" :key="group.groupId">
          <ContextMenu>
            <ContextMenuTrigger>
              <ChannelGroupHeader
                :group="group"
                :can-drag="canDrag()"
                :is-channel-drag-over="dragOverGroupId === group.groupId"
                :is-group-drag-over="dragOverGroupReorder === group.groupId"
                :group-drop-position="groupDropPosition"
                @toggle="toggleGroup"
                @dragstart="onGroupDragStart"
                @dragend="onDragEnd"
                @dragover="onHeaderDragOver"
                @dragleave="onHeaderDragLeave"
                @drop="onHeaderDrop"
              />
            </ContextMenuTrigger>
            <ContextMenuContent class="w-64">
              <ContextMenuItem inset :disabled="!pex.has('ManageChannels')" @click="openAddChannelForGroup(group.groupId)">
                {{ t("add_channel") }}
                <ContextMenuShortcut>⌘+</ContextMenuShortcut>
              </ContextMenuItem>
              <template v-if="pex.has('ManageChannels')">
                <ContextMenuSeparator />
                <ContextMenuItem inset class="text-red-400" @click="deleteGroup(group.groupId, false)">
                  {{ t("delete_group") || "Delete group" }}
                </ContextMenuItem>
                <ContextMenuItem inset class="text-red-500" @click="deleteGroup(group.groupId, true)">
                  {{ t("delete_group_with_channels") || "Delete group + channels" }}
                </ContextMenuItem>
              </template>
            </ContextMenuContent>
          </ContextMenu>
          
          <div v-if="!group.isCollapsed">
            <TransitionGroup name="channel-list" tag="div">
              <ChannelItem
                v-for="(channel, index) in getGroupChannels(group.groupId)"
                :key="channel.channelId"
                :channel="channel"
                :group-id="group.groupId"
                :index="index"
                :is-active="selectedChannelId === channel.channelId"
                :is-drag-over="dragOverChannel === channel.channelId"
                :drop-position="dragOverChannel === channel.channelId ? dropPosition : undefined"
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
            </TransitionGroup>

            <!-- Group tail drop zone -->
            <div
              v-if="draggedChannel && getGroupChannels(group.groupId).length > 0"
              class="tail-drop-zone"
              @dragover.prevent
              @drop="onTailDrop(group.groupId, $event)"
            />
          </div>
        </div>
      </template>
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
import { computed, ref } from 'vue';
import { HashIcon, PlusIcon } from 'lucide-vue-next';
import { useSpaceStore } from '@/store/data/serverStore';
import { usePoolStore } from '@/store/data/poolStore';
import { useLocale } from '@/store/system/localeStore';
import { usePexStore } from '@/store/data/permissionStore';
import { useApi } from '@/store/system/apiStore';
import { useUnifiedCall } from '@/store/media/unifiedCallStore';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@argon/ui/context-menu';
import { logger } from '@argon/core';
import { ChannelType } from '@argon/glue';
import ChannelItem from './ChannelItem.vue';
import ChannelGroupHeader from './ChannelGroupHeader.vue';
import AddChannel from './modals/AddChannel.vue';
import Skeleton from './shared/Skeleton.vue';
import { useChannelGroups } from '@/composables/useChannelGroups';
import { useListLoading } from '@/composables/useListLoading';
import { useChannelDragDrop } from '@/composables/useChannelDragDrop';
import { setLastChannel } from '@/lib/recentSpaces';
import type { Guid } from '@argon-chat/ion.webcore';
import type { IRealtimeChannel } from '@/store/realtime/realtimeStore';

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

const channelsLoading = useListLoading(
  computed(() => channelLists.value.length),
  selectedSpaceId,
);

const voiceChannelUsers = computed(() => {
  const result = new Map<Guid, IRealtimeChannel>();
  for (const channel of channelLists.value) {
    if (channel.type === ChannelType.Voice) {
      const realtimeChannel = pool.realtimeChannelUsers.get(channel.channelId);
      if (realtimeChannel && (realtimeChannel.Users.size > 0 || realtimeChannel.meetingInfo)) {
        result.set(channel.channelId, realtimeChannel);
      }
    }
  }
  return result;
});

const { sortedGroups, toggleGroup, sortByFractionalIndex } = useChannelGroups(selectedSpaceId);

const sortedUngroupedChannels = computed(() => {
  const channels = channelLists.value.filter(c => c.groupId === null);
  return sortByFractionalIndex(channels);
});

const getGroupChannels = (groupId: Guid) => {
  const channels = channelLists.value.filter(c => c.groupId === groupId);
  return sortByFractionalIndex(channels);
};

const {
  canDrag,
  draggedChannel,
  dragOverChannel,
  dropPosition,
  dragOverGroupId,
  dragOverGroupReorder,
  groupDropPosition,
  onDragStart,
  onDragOver,
  onDrop,
  onTailDrop,
  onGroupDragStart,
  onHeaderDragOver,
  onHeaderDragLeave,
  onHeaderDrop,
  onDragEnd
} = useChannelDragDrop(
  selectedSpaceId,
  sortedUngroupedChannels,
  getGroupChannels,
  sortedGroups
);

async function deleteGroup(groupId: Guid, deleteChannels: boolean) {
  try {
    // Service ctx is (spaceId, channelId); the group id doubles as the context id.
    await api.channelInteraction.DeleteChannelGroup(
      selectedSpaceId.value, groupId, groupId, deleteChannels,
    );
  } catch (error) {
    logger.error('Failed to delete channel group', error);
  }
}

const addChannelInGroupOpened = ref(false);
const selectedGroupId = ref<Guid | null>(null);

const openAddChannelForGroup = (groupId: Guid | null) => {
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

  // Remember last visited channel for this space
  if (selectedSpaceId.value) {
    setLastChannel(selectedSpaceId.value, channelId);
  }

  // Handle different channel types
  switch (channel.type) {
    case ChannelType.Text:
    case ChannelType.Announcement:
      pool.selectedTextChannel = channel.channelId;
      break;

    case ChannelType.Voice:
      if (!voice.isConnected) {
        await voice.joinVoiceChannel(channelId);
      }
      break;
  }

  logger.info(`Channel selected`, channel);
}

async function switchVoiceChannel(channelId: string) {
  const channel = await pool.getChannel(channelId);
  
  if (!channel || channel.type !== ChannelType.Voice) {
    return;
  }

  if (voice.connectedVoiceChannelId === channelId) {
    return;
  }

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
  /* Chrome (bg/border/radius) is owned by the parent .channel-panel. */
  background-color: transparent;
  overflow: hidden;
  min-height: 0;
}

/* Scrollbar fully hidden — no arrows, no reserved pixels, no layout jitter. */
.chat-list-scroll {
  overflow-y: auto;
  overflow-x: hidden;
  height: 100%;
  padding: 6px 0;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* legacy Edge */
}

.chat-list-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

/* Loading skeletons */
.channel-skeleton {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  gap: 12px;
  height: 100%;
  min-height: 120px;
}

.empty-state-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background-color: hsl(var(--muted) / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--primary));
  background-color: hsl(var(--primary) / 0.1);
  border: none;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.empty-state-btn:hover {
  background-color: hsl(var(--primary) / 0.2);
}

/* Tail drop zone — invisible target at end of each list */
.tail-drop-zone {
  height: 24px;
  margin: 0 8px;
  border-radius: 6px;
  border: 2px dashed transparent;
  transition: border-color 150ms ease, background-color 150ms ease;
}

.tail-drop-zone:hover {
  border-color: hsl(var(--primary) / 0.4);
  background-color: hsl(var(--primary) / 0.05);
}

/* Channel list TransitionGroup animations */
.channel-list-enter-active {
  transition: all 200ms ease-out;
}

.channel-list-leave-active {
  transition: all 150ms ease-in;
}

.channel-list-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.channel-list-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.channel-list-move {
  transition: transform 250ms ease;
}
</style>