<template>
  <div class="chat-list rounded-xl scroll-smooth">
    <div class="flex flex-col">
      <div class="flex-1 overflow-y-auto py-4 overflow-x-hidden" style="text-overflow: ellipsis;">
        <!-- Channels without group -->
        <div v-for="(channel, index) in sortedUngroupedChannels" :key="channel.channelId"
          draggable="true"
          @dragstart="onDragStart(channel, null, $event)"
          @dragover.prevent="onDragOver(channel, null, index, $event)"
          @drop="onDrop(channel, null, index, $event)"
          @dragend="onDragEnd"
          :class="{ 'drag-over': dragOverChannel === channel.channelId }">
          <div class="px-4 py-2 hover:bg-gray-700/50 cursor-move flex flex-col"
            v-on:click="channelSelect(channel.channelId)">
            <ContextMenu>
              <ContextMenuTrigger>
                <div class="flex items-center justify-between group">
                  <div class="flex items-center space-x-2">
                    <HashIcon v-if="channel.type === ChannelType.Text" class="w-5 h-5 text-gray-400" />
                    <Volume2Icon v-else-if="channel.type === ChannelType.Voice" class="w-5 h-5 text-gray-400" />
                    <AntennaIcon v-else-if="channel.type === ChannelType.Announcement" class="w-5 h-5 text-gray-400" />
                    <span>{{ channel?.name }}</span>
                  </div>
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
            v-if="channel.type === ChannelType.Voice && pool.realtimeChannelUsers.has(channel.channelId) && pool.realtimeChannelUsers.get(channel.channelId)?.Users.size != 0"
            class="ml-3 space-y-2 px-4 pb-2 cursor-pointer flex flex-col">
            <ContextMenu v-for="user in pool.realtimeChannelUsers.get(channel.channelId)!.Users.values()"
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
        <div v-for="group in sortedGroups" :key="group.groupId" class="mb-2">
          <div class="px-4 py-1 text-xs font-semibold text-gray-400 uppercase cursor-pointer hover:text-gray-300"
            @click="toggleGroup(group.groupId)">
            <span>{{ group.isCollapsed ? '▶' : '▼' }} {{ group.name }}</span>
          </div>
          <div v-if="!group.isCollapsed">
            <div v-for="(channel, index) in getGroupChannels(group.groupId)" :key="channel.channelId"
              draggable="true"
              @dragstart="onDragStart(channel, group.groupId, $event)"
              @dragover.prevent="onDragOver(channel, group.groupId, index, $event)"
              @drop="onDrop(channel, group.groupId, index, $event)"
              @dragend="onDragEnd"
              :class="{ 'drag-over': dragOverChannel === channel.channelId }">
              <div class="px-4 py-2 hover:bg-gray-700/50 cursor-move flex flex-col"
                v-on:click="channelSelect(channel.channelId)">
                <ContextMenu>
                  <ContextMenuTrigger>
                    <div class="flex items-center justify-between group">
                      <div class="flex items-center space-x-2">
                        <HashIcon v-if="channel.type === ChannelType.Text" class="w-5 h-5 text-gray-400" />
                        <Volume2Icon v-else-if="channel.type === ChannelType.Voice" class="w-5 h-5 text-gray-400" />
                        <AntennaIcon v-else-if="channel.type === ChannelType.Announcement" class="w-5 h-5 text-gray-400" />
                        <span>{{ channel?.name }}</span>
                      </div>
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
                v-if="channel.type === ChannelType.Voice && pool.realtimeChannelUsers.has(channel.channelId) && pool.realtimeChannelUsers.get(channel.channelId)?.Users.size != 0"
                class="ml-3 space-y-2 px-4 pb-2 cursor-pointer flex flex-col">
                <ContextMenu v-for="user in pool.realtimeChannelUsers.get(channel.channelId)!.Users.values()"
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
  </div>
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
import { watch, computed, ref as vueRef } from "vue";
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

// Load channel groups reactively
const channelGroups = vueRef<ChannelGroup[]>([]);

watch(selectedSpaceId, (spaceId) => {
  if (!spaceId) {
    channelGroups.value = [];
    return;
  }
  pool.db.channelGroups
    .where("spaceId")
    .equals(spaceId)
    .toArray()
    .then(groups => {
      channelGroups.value = groups;
    });
}, { immediate: true });

// Track collapsed state of groups
const collapsedGroups = vueRef<Set<Guid>>(new Set());

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

.hover\:bg-gray-700:hover {
  border-radius: 5px;
}

.drag-over {
  border-top: 2px solid #4f46e5;
  opacity: 0.7;
}

.cursor-move {
  cursor: move;
}

[draggable="true"] {
  user-select: none;
}

[draggable="true"]:active {
  opacity: 0.5;
}
</style>