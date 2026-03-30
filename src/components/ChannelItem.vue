<template>
  <div
    :draggable="canManageChannels"
    @dragstart="emit('dragstart', channel, groupId, $event)"
    @dragover.prevent="emit('dragover', channel, groupId, index, $event)"
    @drop="emit('drop', channel, groupId, index, $event)"
    @dragend="emit('dragend')"
    :class="{ 
      'drag-over': isDragOver, 
      'channel-active': isActive,
      'channel-connected': isConnectedVoiceChannel
    }"
    class="channel-item"
  >
    <div 
      class="px-2 mx-2 py-1.5 hover:bg-foreground/[0.06] cursor-pointer rounded-lg transition-all duration-150"
      @click="emit('select', channel.channelId)"
      @dblclick="emit('switch-voice', channel.channelId)"
    >
      <ContextMenu>
        <ContextMenuTrigger>
          <div class="flex items-center space-x-2">
            <VideoIcon 
              v-if="channelMeetingInfo" 
              class="w-4 h-4 text-blue-400 flex-shrink-0 cursor-pointer hover:text-blue-300 transition-colors" 
              @click.stop="openMeetingDetails"
            />
            <HashIcon v-if="channel.type === ChannelType.Text" class="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <Volume2Icon v-else-if="channel.type === ChannelType.Voice" :class="['w-5 h-5 flex-shrink-0', isConnectedVoiceChannel ? 'text-green-400' : 'text-muted-foreground']" />
            <AntennaIcon v-else-if="channel.type === ChannelType.Announcement" class="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <span class="text-muted-foreground font-medium truncate">{{ channel?.name }}</span>
            <span v-if="isConnectedVoiceChannel" class="text-xs text-green-400 ml-auto">●</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-64">
          <ContextMenuItem inset :disabled="!canManageChannels" @click="emit('delete', channel.channelId)">
            {{ t("delete") }}
            <ContextMenuShortcut>⌘[</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem inset :disabled="true">
            {{ t("leave") }}
            <ContextMenuShortcut>⌘]</ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuSeparator />
          
          <ContextMenuItem 
            v-if="channel.type === ChannelType.Voice && !channelMeetingInfo"
            inset 
            :disabled="!canManageChannels" 
            @click="createMeeting"
          >
            {{ t("create_meeting") }}
            <ContextMenuShortcut>⌘M</ContextMenuShortcut>
          </ContextMenuItem>
          
          <ContextMenuItem 
            v-if="channel.type === ChannelType.Voice && channelMeetingInfo"
            inset 
            @click="openMeetingDetails"
          >
            {{ t("meeting_details") }}
            <ContextMenuShortcut>⌘I</ContextMenuShortcut>
          </ContextMenuItem>
          
          <ContextMenuSeparator v-if="channel.type === ChannelType.Voice" />
          
          <ContextMenuCheckboxItem :disabled="!pex.has('MuteMember')">
            {{ t("mute") }}
            <ContextMenuShortcut>⌘⇧B</ContextMenuShortcut>
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>

    <!-- Voice channel users -->
    <ul
      v-if="channel.type === ChannelType.Voice && voiceUsers && voiceUsers.Users.size > 0"
      class="ml-3 space-y-2 px-4 pb-2 cursor-pointer flex flex-col"
    >
      <ContextMenu 
        v-for="user in voiceUsers.Users.values()"
        :key="user.userId"
      >
        <ContextMenuTrigger :disabled="!voice.isConnected">
          <VoiceChannelUser :user="user" />
        </ContextMenuTrigger>
        <ContextMenuContent class="w-64">
          <ContextMenuLabel v-show="user.userId != me.me?.userId">
            <VolumeSlider :user="user"/>
          </ContextMenuLabel>
          <ContextMenuItem 
            inset 
            :disabled="!pex.has('KickMember')"
            @click="emit('kick-member', user.userId, channel.channelId, channel.spaceId)"
          >
            {{ t("kick") }}
            <ContextMenuShortcut>⌘]</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </ul>
  </div>

  <MeetingDetailsModal
    v-model:open="meetingDetailsOpened"
    :meeting-info="currentMeetingInfo || channelMeetingInfo"
    :space-id="channel.spaceId"
    :channel-id="channel.channelId"
  />
</template>

<script setup lang="ts">
import { computed, ref as vueRef } from 'vue';
import { HashIcon, Volume2Icon, AntennaIcon, VideoIcon } from 'lucide-vue-next';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  ContextMenuLabel,
} from '@argon/ui/context-menu';
import { ChannelType } from '@argon/glue';
import { usePexStore } from '@/store/data/permissionStore';
import { useLocale } from '@/store/system/localeStore';
import { useMe } from '@/store/auth/meStore';
import { useUnifiedCall } from '@/store/media/unifiedCallStore';
import VoiceChannelUser from './channels/VoiceChannelUser.vue';
import VolumeSlider from './audio/VolumeSlider.vue';
import MeetingDetailsModal from './modals/MeetingDetailsModal.vue';
import { useApi } from '@/store/system/apiStore';
import type { Guid } from '@argon-chat/ion.webcore';
import type { ArgonChannel } from '@argon/glue';
import type { IRealtimeChannel } from '@/store/realtime/realtimeStore';

const props = defineProps<{
  channel: ArgonChannel;
  groupId: Guid | null;
  index: number;
  isActive: boolean;
  isDragOver: boolean;
  voiceUsers?: IRealtimeChannel;
}>();

const emit = defineEmits<{
  select: [channelId: string];
  'switch-voice': [channelId: string];
  delete: [channelId: string];
  dragstart: [channel: ArgonChannel, groupId: Guid | null, event: DragEvent];
  dragover: [channel: ArgonChannel, groupId: Guid | null, index: number, event: DragEvent];
  drop: [channel: ArgonChannel, groupId: Guid | null, index: number, event: DragEvent];
  dragend: [];
  'kick-member': [userId: string, channelId: string, spaceId: string];
}>();

const pex = usePexStore();
const { t } = useLocale();
const me = useMe();
const voice = useUnifiedCall();
const api = useApi();

const canManageChannels = computed(() => pex.has('ManageChannels'));
const isConnectedVoiceChannel = computed(() => 
  props.channel.type === ChannelType.Voice && 
  voice.connectedVoiceChannelId === props.channel.channelId
);

const meetingDetailsOpened = vueRef(false);
const currentMeetingInfo = vueRef<any>(null);
const channelMeetingInfo = computed(() => props.voiceUsers?.meetingInfo);

const createMeeting = async () => {
  try {
    const meetingInfo = await api.channelInteraction.CreateLinkedMeeting(props.channel.spaceId, props.channel.channelId);
    currentMeetingInfo.value = meetingInfo;
    meetingDetailsOpened.value = true;
  } catch (error) {
    console.error('Failed to create meeting', error);
  }
};

const openMeetingDetails = () => {
  if (channelMeetingInfo.value) {
    currentMeetingInfo.value = channelMeetingInfo.value;
    meetingDetailsOpened.value = true;
  }
};
</script>

<style scoped>
.channel-item {
  position: relative;
  margin-bottom: 1px;
}

.channel-active > div {
  background-color: hsl(var(--primary) / 0.1) !important;
  color: hsl(var(--foreground));
}

.channel-connected > div {
  background-color: hsl(142 71% 45% / 0.08) !important;
  border-left: 2px solid hsl(142 71% 45%);
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
  background: hsl(var(--primary));
  border-radius: 1px;
}

.channel-item[draggable="true"]:active {
  opacity: 0.8;
  cursor: grabbing;
}
</style>
