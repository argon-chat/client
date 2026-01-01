<template>
  <div
    :draggable="canManageChannels"
    @dragstart="emit('dragstart', channel, groupId, $event)"
    @dragover.prevent="emit('dragover', channel, groupId, index, $event)"
    @drop="emit('drop', channel, groupId, index, $event)"
    @dragend="emit('dragend')"
    :class="{ 
      'drag-over': isDragOver, 
      'channel-active': isActive 
    }"
    class="channel-item"
  >
    <div 
      class="px-2 mx-2 py-1.5 hover:bg-gray-700/30 cursor-pointer rounded-md transition-all duration-150"
      @click="emit('select', channel.channelId)"
    >
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
          <ContextMenuItem inset :disabled="!canManageChannels" @click="emit('delete', channel.channelId)">
            {{ t("delete") }}
            <ContextMenuShortcut>⌘[</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem inset :disabled="true">
            {{ t("leave") }}
            <ContextMenuShortcut>⌘]</ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuSeparator />
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
            <!-- @vue-ignore -->
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

          <ContextMenuSeparator v-show="user.userId != me.me?.userId" />
          <ContextMenuCheckboxItem :disabled="true">
            Ya ebal mamu
            <ContextMenuShortcut>⌘⇧B</ContextMenuShortcut>
          </ContextMenuCheckboxItem>
        </ContextMenuContent>
      </ContextMenu>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { HashIcon, Volume2Icon, AntennaIcon } from 'lucide-vue-next';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
  ContextMenuLabel,
} from '@/components/ui/context-menu';
import { ChannelType } from '@/lib/glue/argonChat';
import { usePexStore } from '@/store/permissionStore';
import { useLocale } from '@/store/localeStore';
import { useMe } from '@/store/meStore';
import { useUnifiedCall } from '@/store/unifiedCallStore';
import VoiceChannelUser from './VoiceChannelUser.vue';
import VolumeSlider from './VolumeSlider.vue';
import type { Guid } from '@argon-chat/ion.webcore';

const props = defineProps<{
  channel: any;
  groupId: Guid | null;
  index: number;
  isActive: boolean;
  isDragOver: boolean;
  voiceUsers?: any;
}>();

const emit = defineEmits<{
  select: [channelId: string];
  delete: [channelId: string];
  dragstart: [channel: any, groupId: Guid | null, event: DragEvent];
  dragover: [channel: any, groupId: Guid | null, index: number, event: DragEvent];
  drop: [channel: any, groupId: Guid | null, index: number, event: DragEvent];
  dragend: [];
  'kick-member': [userId: string, channelId: string, spaceId: string];
}>();

const pex = usePexStore();
const { t } = useLocale();
const me = useMe();
const voice = useUnifiedCall();

const canManageChannels = computed(() => pex.has('ManageChannels'));
</script>

<style scoped>
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
