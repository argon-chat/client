<template>
  <div
    :draggable="canManageChannels"
    @dragstart="emit('dragstart', channel, groupId, $event)"
    @dragover.prevent="emit('dragover', channel, groupId, index, $event)"
    @drop="emit('drop', channel, groupId, index, $event)"
    @dragend="emit('dragend')"
    :data-active="isActive || undefined"
    :data-connected="isConnectedVoiceChannel || undefined"
    :data-drop-position="isDragOver ? dropPosition : undefined"
    class="channel-item"
  >
    <div 
      class="channel-inner"
      @click="emit('select', channel.channelId)"
      @contextmenu.prevent="onContextMenu"
    >
      <div class="flex items-center space-x-2">
        <VideoIcon 
          v-if="channelMeetingInfo" 
          class="w-4 h-4 text-blue-400 flex-shrink-0 cursor-pointer hover:text-blue-300 transition-colors" 
          @click.stop="openMeetingDetails"
        />
        <HashIcon v-if="channel.type === ChannelType.Text" class="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <Volume2Icon v-else-if="channel.type === ChannelType.Voice" :class="['w-5 h-5 flex-shrink-0', isConnectedVoiceChannel ? 'text-green-400' : 'text-muted-foreground']" />
        <AntennaIcon v-else-if="channel.type === ChannelType.Announcement" class="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <span :class="['text-muted-foreground font-medium truncate', channelUnread && 'text-foreground font-semibold']" :title="channel?.name">{{ channel?.name }}</span>
        <span v-if="channelMentions > 0" class="ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex-shrink-0">
          {{ channelMentions }}
        </span>
        <span v-else-if="channelUnread" class="ml-auto w-2 h-2 rounded-full bg-white flex-shrink-0" />
        <span v-if="isConnectedVoiceChannel" class="text-xs text-green-400 ml-auto">●</span>
      </div>
    </div>

    <!-- Voice channel users -->
    <TransitionGroup
      v-if="channel.type === ChannelType.Voice && voiceUsers && voiceUsers.Users.size > 0"
      tag="ul"
      name="voice-user"
      class="voice-user-list"
    >
      <li v-for="user in voiceUsers.Users.values()" :key="user.userId">
        <ContextMenu>
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
      </li>
    </TransitionGroup>

    <MeetingDetailsModal
      v-model:open="meetingDetailsOpened"
      :meeting-info="currentMeetingInfo || channelMeetingInfo"
      :space-id="channel.spaceId"
      :channel-id="channel.channelId"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref as vueRef, TransitionGroup } from 'vue';
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
import { useNotificationStore } from '@/store/data/notificationStore';
import { MuteLevelType } from '@argon/glue';
import VoiceChannelUser from './channels/VoiceChannelUser.vue';
import VolumeSlider from './audio/VolumeSlider.vue';
import MeetingDetailsModal from './modals/MeetingDetailsModal.vue';
import { useApi } from '@/store/system/apiStore';
import type { DropPosition } from '@/composables/useChannelDragDrop';
import type { Guid } from '@argon-chat/ion.webcore';
import type { ArgonChannel } from '@argon/glue';
import type { IRealtimeChannel } from '@/store/realtime/realtimeStore';

const props = defineProps<{
  channel: ArgonChannel;
  groupId: Guid | null;
  index: number;
  isActive: boolean;
  isDragOver: boolean;
  dropPosition?: DropPosition;
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
const ntf = useNotificationStore();

const channelUnread = computed(() => {
  const mute = ntf.effectiveMuteLevel(props.channel.channelId, props.channel.spaceId);
  if (mute === MuteLevelType.All) return false;
  if (mute === MuteLevelType.OnlyMentions) return false;
  return ntf.isChannelUnread(props.channel.channelId, props.channel.lastMessageId);
});

const channelMentions = computed(() => {
  const mute = ntf.effectiveMuteLevel(props.channel.channelId, props.channel.spaceId);
  if (mute === MuteLevelType.All) return 0;
  return ntf.channelMentionCount(props.channel.channelId);
});

const channelMuted = computed(() => ntf.isTargetMuted(props.channel.channelId) || ntf.isTargetMuted(props.channel.spaceId));

const canManageChannels = computed(() => pex.has('ManageChannels'));
const isConnectedVoiceChannel = computed(() => 
  props.channel.type === ChannelType.Voice && 
  voice.connectedVoiceChannelId === props.channel.channelId
);

const meetingDetailsOpened = vueRef(false);
const currentMeetingInfo = vueRef<any>(null);
const channelMeetingInfo = computed(() => props.voiceUsers?.meetingInfo);

const contextMenuOpen = vueRef(false);
const contextMenuStyle = vueRef<Record<string, string>>({});

const onContextMenu = (e: MouseEvent) => {
  contextMenuStyle.value = {
    '--radix-context-menu-content-transform-origin': `${e.clientX}px ${e.clientY}px`,
  };
  contextMenuOpen.value = true;
};

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

.channel-inner {
  padding: 6px 8px;
  margin: 0 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.channel-inner:hover {
  background-color: hsl(var(--foreground) / 0.06);
}

.channel-item[data-active] .channel-inner {
  background-color: hsl(var(--primary) / 0.1);
  color: hsl(var(--foreground));
}

.channel-item[data-connected] .channel-inner {
  background-color: hsl(142 71% 45% / 0.08);
  border-left: 2px solid hsl(142 71% 45%);
}

/* Drop indicators */
.channel-item[data-drop-position]::before,
.channel-item[data-drop-position]::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  height: 2px;
  background: hsl(var(--primary));
  border-radius: 1px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 100ms ease;
}

.channel-item[data-drop-position]::before {
  top: 0;
}

.channel-item[data-drop-position]::after {
  bottom: 0;
}

.channel-item[data-drop-position="before"]::before {
  opacity: 1;
}

.channel-item[data-drop-position="after"]::after {
  opacity: 1;
}

.channel-item[draggable="true"] {
  cursor: grab;
}

.channel-item[draggable="true"]:active {
  opacity: 0.5;
  cursor: grabbing;
}

/* Voice user list */
.voice-user-list {
  margin-left: 12px;
  padding: 0 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  list-style: none;
}

/* Voice user enter/leave transitions */
.voice-user-enter-active {
  transition: all 200ms ease-out;
}

.voice-user-leave-active {
  transition: all 150ms ease-in;
}

.voice-user-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}

.voice-user-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.voice-user-move {
  transition: transform 200ms ease;
}
</style>
