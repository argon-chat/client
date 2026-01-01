<template>
  <div class="chat-list rounded-xl scroll-smooth overflow-y-auto flex flex-col">
    <div class="py-2 overflow-x-hidden" style="text-overflow: ellipsis;">
      <!-- Channels without group -->
        <div v-for="(channel, index) in sortedUngroupedChannels" :key="channel.channelId"
          :draggable="pex.has('ManageChannels')"
          @dragstart="onDragStart(channel, null, $event)"
          @dragover.prevent="onDragOver(channel, null, index, $event)"
          @drop="onDrop(channel, null, index, $event)"
          @dragend="onDragEnd"
          :class="{ 'drag-over': dragOverChannel === channel.channelId, 'channel-active': selectedChannelId === channel.channelId }"
          class="channel-item">
          <div class="px-2 mx-2 py-1.5 hover:bg-gray-700/30 cursor-pointer rounded-md transition-all duration-150"
            v-on:click="channelSelect(channel.channelId)">
            <ContextMenu>
              <ContextMenuTrigger>
                <div class="flex items-center space-x-2">
                  <HashIcon v-if="channel.type === ChannelType.Text" class="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <Volume2Icon v-else-if="channel.type === ChannelType.Voice" class="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <AntennaIcon v-else-if="channel.type === ChannelType.Announcement" class="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <span class="text-gray-300 font-medium truncate">{{ channel?.name }}</span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-64">
                <ContextMenuItem inset :disabled="!pex.has('ManageChannels')" @click="channelDelete(channel.channelId)">
                  {{ t("delete") }}
                  <ContextMenuShortcut>⌘[</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem inset :disabled="true">
                  {{ t("leave") }}
                  <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                </ContextMenuItem>

                <ContextMenuSeparator />
                <ContextMenuCheckboxItem :disabled="!pex.has('MuteMember')">
                  {{t("mute")}}
                  <ContextMenuShortcut>⌘⇧B</ContextMenuShortcut>
                </ContextMenuCheckboxItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
          <ul
            v-if="channel.type === ChannelType.Voice && voiceChannelUsers.has(channel.channelId)"
            class="ml-3  space-y-2 px-4 pb-2 cursor-pointer flex flex-col">
            <ContextMenu v-for="user in voiceChannelUsers.get(channel.channelId)!.Users.values()"
              :key="user.userId">
              <ContextMenuTrigger :disabled="!voice.isConnected">
                <li class="flex items-center mt-1 text-gray-400 hover:text-white">
                  <ArgonAvatar :fallback="user.User.displayName" :fileId="user.User.avatarFileId" :userId="user.userId"
                    :style="(user.isSpeaking ? 'outline: solid #45d110 2px; outline-offset: 2px; border-radius: 500px;' : '')"
                    class="w-7 h-7 rounded-full mr-3 transition" />
                  <span>{{ user.User.displayName }}</span>
                  <div class="flex items-center gap-1" style="margin-left: auto;">
                    <MicOffIcon v-if="isMuted(user.userId)" width="16" height="16" />
                    <HeadphoneOffIcon v-if="isHeadphoneMuted(user.userId)" width="16" height="16" />
                    <ScreenShare v-if="user.isScreenShare" width="16" height="16" />
                    <RadiusIcon v-if="user.isRecording" width="16" height="16" style="color: red;" />
                  </div>
                </li>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-64">
                <ContextMenuLabel v-show="user.userId != me.me?.userId">
                  <!-- @vue-ignore -->
                  <VolumeSlider :user="user"/>
                </ContextMenuLabel>
                <ContextMenuItem inset :disabled="!pex.has('KickMember')"
                  @click="kickMember(user.userId, channel.channelId, channel.spaceId)">
                  {{t("kick")}}
                  <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                </ContextMenuItem>

                <ContextMenuSeparator v-show="user.userId != me.me?.userId" />
                <ContextMenuCheckboxItem :disabled="true">
                  Ya ebal mamu
                  <ContextMenuShortcut>⌘⇧B</ContextMenuShortcut>
                </ContextMenuCheckboxItem>
              </ContextMenuContent>
            </ContextMenu>
          </ul>
        </div>

        <!-- Channel groups with channels -->
        <div v-for="group in sortedGroups" :key="group.groupId">
          <ContextMenu>
            <ContextMenuTrigger>
              <div class="relative px-2 py-1 cursor-pointer group">
                <!-- Divider line -->
                <div class="absolute left-0 right-0 top-1/2 h-px bg-gray-700/50"></div>
                
                <!-- Text and icon on top of divider -->
                <div class="relative inline-flex items-center gap-1.5 px-2 bg-[#161616f5] text-xs font-semibold text-gray-500 uppercase hover:text-gray-300 transition-colors duration-150"
                  @click="toggleGroup(group.groupId)">
                  <ChevronRightIcon v-if="group.isCollapsed" class="w-3 h-3 transition-transform duration-150" />
                  <ChevronDownIcon v-else class="w-3 h-3 transition-transform duration-150" />
                  <span class="tracking-wide">{{ group.name }}</span>
                </div>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent class="w-64">
              <ContextMenuItem inset :disabled="!pex.has('ManageChannels')" @click="openAddChannelForGroup(group.groupId)">
                {{ t("add_channel") }}
                <ContextMenuShortcut>⌘+</ContextMenuShortcut>
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <div v-if="!group.isCollapsed">
            <div v-for="(channel, index) in getGroupChannels(group.groupId)" :key="channel.channelId"
              :draggable="pex.has('ManageChannels')"
              @dragstart="onDragStart(channel, group.groupId, $event)"
              @dragover.prevent="onDragOver(channel, group.groupId, index, $event)"
              @drop="onDrop(channel, group.groupId, index, $event)"
              @dragend="onDragEnd"
              :class="{ 'drag-over': dragOverChannel === channel.channelId, 'channel-active': selectedChannelId === channel.channelId }"
              class="channel-item">
              <div class="px-2 mx-2 py-1.5 hover:bg-gray-700/30 cursor-pointer rounded-md transition-all duration-150"
                v-on:click="channelSelect(channel.channelId)">
                <ContextMenu>
                  <ContextMenuTrigger>
                    <div class="flex items-center space-x-2">
                      <HashIcon v-if="channel.type === ChannelType.Text" class="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <Volume2Icon v-else-if="channel.type === ChannelType.Voice" class="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <AntennaIcon v-else-if="channel.type === ChannelType.Announcement" class="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <span class="text-gray-300 font-medium truncate">{{ channel?.name }}</span>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent class="w-64">
                    <ContextMenuItem inset :disabled="!pex.has('ManageChannels')" @click="channelDelete(channel.channelId)">
                      {{ t("delete") }}
                      <ContextMenuShortcut>⌘[</ContextMenuShortcut>
                    </ContextMenuItem>
                    <ContextMenuItem inset :disabled="true">
                      {{ t("leave") }}
                      <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                    </ContextMenuItem>

                    <ContextMenuSeparator />
                    <ContextMenuCheckboxItem :disabled="!pex.has('MuteMember')">
                      {{t("mute")}}
                      <ContextMenuShortcut>⌘⇧B</ContextMenuShortcut>
                    </ContextMenuCheckboxItem>
                  </ContextMenuContent>
                </ContextMenu>
              </div>
              <ul
                v-if="channel.type === ChannelType.Voice && voiceChannelUsers.has(channel.channelId)"
                class="ml-3 space-y-2 px-4 pb-2 cursor-pointer flex flex-col">
                <ContextMenu v-for="user in voiceChannelUsers.get(channel.channelId)!.Users.values()"
                  :key="user.userId">
                  <ContextMenuTrigger :disabled="!voice.isConnected">
                    <li class="flex items-center mt-1 text-gray-400 hover:text-white">
                      <ArgonAvatar :fallback="user.User.displayName" :fileId="user.User.avatarFileId" :userId="user.userId"
                        :style="(user.isSpeaking ? 'outline: solid #45d110 2px; outline-offset: 2px; border-radius: 500px;' : '')"
                        class="w-7 h-7 rounded-full mr-3 transition" />
                      <span>{{ user.User.displayName }}</span>
                      <div class="flex items-center gap-1" style="margin-left: auto;">
                        <MicOffIcon v-if="isMuted(user.userId)" width="16" height="16" />
                        <HeadphoneOffIcon v-if="isHeadphoneMuted(user.userId)" width="16" height="16" />
                        <ScreenShare v-if="user.isScreenShare" width="16" height="16" />
                        <RadiusIcon v-if="user.isRecording" width="16" height="16" style="color: red;" />
                      </div>
                    </li>
                  </ContextMenuTrigger>
                  <ContextMenuContent class="w-64">
                    <ContextMenuLabel v-show="user.userId != me.me?.userId">
                      <!-- @vue-ignore -->
                      <VolumeSlider :user="user"/>
                    </ContextMenuLabel>
                    <ContextMenuItem inset :disabled="!pex.has('KickMember')"
                      @click="kickMember(user.userId, channel.channelId, channel.spaceId)">
                      {{t("kick")}}
                      <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                    </ContextMenuItem>

                    <ContextMenuSeparator v-show="user.userId != me.me?.userId" />
                    <ContextMenuCheckboxItem :disabled="true">
                      Ya ebal mamu
                      <ContextMenuShortcut>⌘⇧B</ContextMenuShortcut>
                    </ContextMenuCheckboxItem>
                  </ContextMenuContent>
                </ContextMenu>
              </ul>
            </div>
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
import { useSpaceStore } from "@/store/serverStore";
import {
  HashIcon,
  Volume2Icon,
  AntennaIcon,
  MicOffIcon,
  HeadphoneOffIcon,
  ScreenShare,
  RadiusIcon,
  FolderIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ChevronDown,
} from "lucide-vue-next";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  ContextMenuLabel,
} from "@/components/ui/context-menu";
import { Slider } from "@/components/ui/slider";
import { logger } from "@/lib/logger";
import { usePoolStore } from "@/store/poolStore";
import { useLocale } from "@/store/localeStore";
import ArgonAvatar from "./ArgonAvatar.vue";
import { useMe } from "@/store/meStore";
import { usePexStore } from "@/store/permissionStore";
import { useApi } from "@/store/apiStore";
import { ChannelType, type ChannelGroup } from "@/lib/glue/argonChat";
import VolumeSlider from "./VolumeSlider.vue";
import AddChannel from "./modals/AddChannel.vue";
import { watch, computed, ref as vueRef, onUnmounted } from "vue";
import { useUnifiedCall } from "@/store/unifiedCallStore";
import { useSystemStore } from "@/store/systemStore";
import type { Guid } from "@argon-chat/ion.webcore";

const servers = useSpaceStore();
const pool = usePoolStore();
const voice = useUnifiedCall();
const sys = useSystemStore();
const me = useMe();
const pex = usePexStore();
const api = useApi();
const { t } = useLocale();

const localUserId = computed<Guid | null>(() => {
  const r = voice.room;
  return r?.localParticipant?.identity ?? null;
});

const isMuted = (uid: Guid) => {
  const localId = localUserId.value;
  if (localId && uid === localId) return sys.microphoneMuted;
  const participant = voice.participants.get(uid);
  return participant?.muted ?? false;
};

const isHeadphoneMuted = (uid: Guid) => {
  const localId = localUserId.value;
  if (localId && uid === localId) return sys.headphoneMuted;
  const participant = voice.participants.get(uid);
  return participant?.mutedAll ?? false;
};

const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
})
const selectedChannelId = defineModel<string>('selectedChannelId', {
    type: String, required: true
})

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

// Load channel groups reactively
const channelGroups = vueRef<ChannelGroup[]>([]);

// Watch for changes in channelGroups table
const updateGroups = async () => {
  if (!selectedSpaceId.value) {
    channelGroups.value = [];
    return;
  }
  const groups = await pool.db.channelGroups
    .where("spaceId")
    .equals(selectedSpaceId.value)
    .toArray();
  channelGroups.value = groups;
};

watch(selectedSpaceId, updateGroups, { immediate: true });

// Watch for channel list changes which might indicate group updates
watch(channelLists, () => {
  updateGroups();
}, { deep: true });

// Track collapsed state of groups
const collapsedGroups = vueRef<Set<Guid>>(new Set());

// Add channel to group state
const addChannelInGroupOpened = vueRef(false);
const selectedGroupId = vueRef<Guid | null>(null);

const openAddChannelForGroup = (groupId: Guid) => {
  selectedGroupId.value = groupId;
  addChannelInGroupOpened.value = true;
};

// Sort by fractional index
const sortByFractionalIndex = <T extends { fractionalIndex: string | null }>(items: T[]): T[] => {
  return [...items].sort((a, b) => {
    if (a.fractionalIndex === null && b.fractionalIndex === null) return 0;
    if (a.fractionalIndex === null) return 1;
    if (b.fractionalIndex === null) return -1;
    return a.fractionalIndex.localeCompare(b.fractionalIndex);
  });
};

// Get sorted groups with collapse state
const sortedGroups = computed(() => {
  const groups = channelGroups.value;
  const sorted = sortByFractionalIndex(groups);
  return sorted.map(group => ({
    ...group,
    isCollapsed: group.isCollapsed || collapsedGroups.value.has(group.groupId)
  }));
});

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

// Toggle group collapse state
const toggleGroup = (groupId: Guid) => {
  if (collapsedGroups.value.has(groupId)) {
    collapsedGroups.value.delete(groupId);
  } else {
    collapsedGroups.value.add(groupId);
  }
};

// Drag and drop state
const draggedChannel = vueRef<{ channelId: Guid; groupId: Guid | null } | null>(null);
const dragOverChannel = vueRef<Guid | null>(null);

const onDragStart = (channel: any, groupId: Guid | null, event: DragEvent) => {
  if (!pex.has('ManageChannels')) {
    event.preventDefault();
    return;
  }
  draggedChannel.value = { channelId: channel.channelId, groupId };
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', channel.channelId);
  }
};

const onDragOver = (channel: any, groupId: Guid | null, index: number, event: DragEvent) => {
  if (!draggedChannel.value || !pex.has('ManageChannels')) return;
  dragOverChannel.value = channel.channelId;
};

const onDrop = async (targetChannel: any, targetGroupId: Guid | null, index: number, event: DragEvent) => {
  event.preventDefault();
  dragOverChannel.value = null;
  
  if (!draggedChannel.value || !pex.has('ManageChannels')) return;
  if (!selectedSpaceId.value) return;
  
  const sourceChannelId = draggedChannel.value.channelId;
  const sourceGroupId = draggedChannel.value.groupId;
  
  // Don't move if dropping on itself
  if (sourceChannelId === targetChannel.channelId) return;
  
  try {
    // Get the list of channels in the target group/ungrouped
    const targetChannels = targetGroupId === null 
      ? sortedUngroupedChannels.value 
      : getGroupChannels(targetGroupId);
    
    const targetIndex = targetChannels.findIndex(c => c.channelId === targetChannel.channelId);
    
    // Determine afterChannelId and beforeChannelId
    let afterChannelId: Guid | null = null;
    let beforeChannelId: Guid | null = null;
    
    // Insert before target
    if (targetIndex > 0) {
      afterChannelId = targetChannels[targetIndex - 1].channelId;
    }
    beforeChannelId = targetChannel.channelId;
    
    logger.info('Moving channel', {
      sourceChannelId,
      targetGroupId,
      afterChannelId,
      beforeChannelId
    });
    
    await api.channelInteraction.MoveChannel(
      selectedSpaceId.value,
      sourceChannelId,
      targetGroupId,
      afterChannelId,
      beforeChannelId
    );
    
    // Event will update the database automatically
  } catch (error) {
    logger.error('Failed to move channel', error);
  } finally {
    draggedChannel.value = null;
  }
};

const onDragEnd = () => {
  draggedChannel.value = null;
  dragOverChannel.value = null;
};

async function channelSelect(channelId: string) {
  logger.info(`Do action for channel '${channelId}'`);
  const channel = await pool.getChannel(channelId);

  if (channel && channel.type !== ChannelType.Voice) {
    pool.selectedTextChannel = channel.channelId;
  } else {
    logger.warn("no found channel for ", channelId, channel);
  }
  selectedChannelId.value = channelId;
  logger.info(`Do action for channel`, channel);

  if (voice.isConnected) {
    return;
  }
  
  if (!channel) {
    logger.warn("no found channel for ", channelId);
    return;
  }
  if (channel.type === ChannelType.Voice) {
    await voice.joinVoiceChannel(channelId);
  }
}

async function channelDelete(channelId: string) {
  await servers.deleteChannel(channelId);
}

const connectToChannel = (channelId: string) => {
  //servers.connectTo(channelId);
};

const kickMember = async (userId: string, channelId: string, spaceId: string) => {
  await api.channelInteraction.KickMemberFromChannel(spaceId, channelId, userId);
}
</script>

<style scoped>
.controls-list {
  background-color: #161616;
  align-items: center;
  justify-content: space-between;
  position: relative;
}

.control-bar {
  justify-content: center;
  display: flex;
  gap: 10px;
  flex: auto;
}

.controls button {
  background: none;
  border: none;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  margin-left: 5px;
  transition: color 0.3s;
  margin: 5px;
}

.header-list {
  background-color: #161616;
  padding-top: 10px;
}

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

.hover\:bg-gray-700:hover {
  border-radius: 5px;
}

.channel-item {
  position: relative;
  margin-bottom: 1px;
}

.channel-active > div {
  background-color: rgba(88, 101, 242, 0.1) !important;
  color: white;
}

.drag-over {
  position: relative;
}

.drag-over::before {
  content: '';
  position: absolute;
  top: 0;
  left: 8px;
  right: 8px;
  height: 2px;
  background: #5865f2;
  border-radius: 1px;
}

.channel-item[draggable="true"]:active {
  opacity: 0.8;
  cursor: grabbing;
}
</style>