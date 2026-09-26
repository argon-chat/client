<template>
  <div class="chat-list flex flex-col">
    <div ref="scrollEl" class="chat-list-scroll">
      <BroadcastConnectors :container="scrollEl" :links="broadcastLinks" :revision="layoutRevision" />
      <Transition name="panel-swap" mode="out-in">
      <!-- Loading skeletons -->
      <div v-if="channelsLoading && channelLists.length === 0" key="loading">
        <div v-for="i in 8" :key="`ch-sk-${i}`" class="channel-skeleton">
          <Skeleton class="h-4 w-4 rounded shrink-0" />
          <Skeleton class="h-3 rounded" :style="{ width: `${42 + (i * 13) % 44}%` }" />
        </div>
      </div>

      <!-- Empty state -->
      <div v-else-if="channelLists.length === 0" key="empty" class="empty-state">
        <EmptyStateArt name="no-channels" :size="132" />
        <p class="text-sm text-muted-foreground/60">{{ t("no_channels") }}</p>
        <button 
          v-if="pex.has('ManageChannels')"
          class="empty-state-btn icon-motion icon-motion--turn"
          @click="openAddChannelForGroup(null)"
        >
          <PlusIcon class="w-4 h-4" />
          {{ t("add_channel") }}
        </button>
      </div>

      <div v-else key="channels">
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
            :voice-channels="voiceChannels"
            :voice-drop="voiceDropStateOf(channel)"
            @select="channelSelect"
            @switch-voice="switchVoiceChannel"
            @dragstart="onDragStart"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
            @dragend="onDragEnd"
            @member-dragstart="onMemberDragStart"
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
            <!-- Everything on a group is space-level ManageChannels: without it there is no menu. -->
            <ContextMenuContent v-if="pex.has('ManageChannels')" class="w-64">
              <ContextMenuItem inset @click="openAddChannelForGroup(group.groupId)">
                {{ t("add_channel") }}
                <ContextMenuShortcut>⌘+</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem inset class="text-red-400" @click="deleteGroup(group.groupId, false)">
                {{ t("delete_group") }}
              </ContextMenuItem>
              <ContextMenuItem inset class="text-red-500" @click="deleteGroup(group.groupId, true)">
                {{ t("delete_group_with_channels") }}
              </ContextMenuItem>
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
                :voice-channels="voiceChannels"
                :voice-drop="voiceDropStateOf(channel)"
                @select="channelSelect"
                @open-split="openChannelInSplit"
                @switch-voice="switchVoiceChannel"
                @dragstart="onDragStart"
                @dragover="onDragOver"
                @dragleave="onDragLeave"
                @drop="onDrop"
                @dragend="onDragEnd"
                @member-dragstart="onMemberDragStart"
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
      </div>
      </Transition>
    </div>

    <AddChannel
      v-model:open="addChannelInGroupOpened"
      v-model:group-id="selectedGroupId"
      :selected-space="selectedSpaceId"
      @close="addChannelInGroupOpened = false; selectedGroupId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PlusIcon } from 'lucide-vue-next';
import EmptyStateArt from '@/components/shared/EmptyStateArt.vue';
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
import { useToast } from '@argon/ui/toast';
import ChannelItem from './ChannelItem.vue';
import ChannelGroupHeader from './ChannelGroupHeader.vue';
import BroadcastConnectors, { type BroadcastLink } from './channels/BroadcastConnectors.vue';
import AddChannel from './modals/AddChannel.vue';
import Skeleton from './shared/Skeleton.vue';
import { useChannelGroups } from '@/composables/useChannelGroups';
import { useListLoading } from '@/composables/useListLoading';
import { openInSplit } from '@/composables/useSplitView';
import { useChannelDragDrop } from '@/composables/useChannelDragDrop';
import { setLastChannel } from '@/lib/recentSpaces';
import { isVoiceLikeChannel } from '@/lib/voice/channels';
import { channelLayoutErrorKey, channelLayoutRefusal } from '@/lib/refusals';
import type { Guid } from '@argon-chat/ion.webcore';
import type { IRealtimeChannel } from '@/store/realtime/realtimeStore';

const pool = usePoolStore();
const voice = useUnifiedCall();
const pex = usePexStore();
const api = useApi();
const { t } = useLocale();
const { toast } = useToast();

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
    if (isVoiceLikeChannel(channel.type)) {
      const realtimeChannel = pool.realtimeChannelUsers.get(channel.channelId);
      if (realtimeChannel && realtimeChannel.Users.size > 0) {
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

// In sidebar order, for the "Move to" menu.
const voiceChannels = computed(() =>
  [
    ...sortedUngroupedChannels.value,
    ...sortedGroups.value.flatMap(g => getGroupChannels(g.groupId)),
  ].filter(c => isVoiceLikeChannel(c.type)),
);

// ── Broadcast connectors: each broadcast channel to the rows that hear it ──

const scrollEl = ref<HTMLElement | null>(null);

const broadcastLinks = computed<BroadcastLink[]>(() =>
  voiceChannels.value
    .filter(c => c.broadcast !== null && c.broadcast.targets.length > 0)
    .map(c => ({ from: c.channelId, to: c.broadcast!.targets })),
);

// Rows move when the list changes, a group folds or a member list grows; the overlay re-measures.
// (Each of these is replaced wholesale on change, so a shallow watch sees it.)
const layoutRevision = ref(0);
watch([channelLists, sortedGroups, voiceChannelUsers], () => layoutRevision.value++);

const {
  canDrag,
  draggedChannel,
  dragOverChannel,
  dropPosition,
  dragOverGroupId,
  dragOverGroupReorder,
  groupDropPosition,
  voiceDropStateOf,
  onDragStart,
  onMemberDragStart,
  onDragOver,
  onDragLeave,
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

function openChannelInSplit(channelId: string) {
  openInSplit(channelId, selectedSpaceId.value ?? null);
}

async function deleteGroup(groupId: Guid, deleteChannels: boolean) {
  try {
    // Service ctx is (spaceId, channelId); the group id doubles as the context id.
    const refused = channelLayoutRefusal(await api.channelInteraction.DeleteChannelGroup(
      selectedSpaceId.value, groupId, groupId, deleteChannels,
    ));
    if (refused !== null) {
      toast({ title: t('channel_group_delete_failed'), description: t(channelLayoutErrorKey(refused)), variant: 'destructive' });
    }
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

  // The row refuses the click already; this keeps any other caller from asking the server anyway.
  if (isVoiceLikeChannel(channel.type) && !pex.hasIn(channelId, 'Connect', channel.spaceId)) return;

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

    default:
      if (isVoiceLikeChannel(channel.type) && !voice.isConnected) {
        await voice.joinVoiceChannel(channelId);
      }
      break;
  }

  logger.info(`Channel selected`, channel);
}

async function switchVoiceChannel(channelId: string) {
  const channel = await pool.getChannel(channelId);

  if (!channel || !isVoiceLikeChannel(channel.type)) {
    return;
  }

  if (!pex.hasIn(channelId, 'Connect', channel.spaceId)) return;

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

const kickMember = async (userId: string, channelId: string, spaceId: string) => {
  if (!pex.hasIn(channelId, 'KickMember', spaceId)) return;
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
  position: relative; /* the broadcast connector overlay is laid over the content */
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

/* Skeletons -> content. The two states are the same panel at two moments, so they hand over
   rather than cut: the placeholder fades out, the real list fades in a few pixels lower. Sequential
   (`out-in`) because both live in the same scroll flow — crossfading them would need one taken out
   of flow, and the panel would jump by whatever the other one measured. */
.panel-swap-enter-active {
  transition: opacity 220ms ease-out, transform 220ms ease-out;
}

.panel-swap-leave-active {
  transition: opacity 140ms ease-in;
}

.panel-swap-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.panel-swap-leave-to {
  opacity: 0;
}

</style>