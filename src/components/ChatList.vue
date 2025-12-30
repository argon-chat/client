<template>
  <div class="chat-list rounded-xl scroll-smooth">
    <div class="flex flex-col">
      <div class="flex-1 overflow-y-auto py-4 overflow-x-hidden" style="text-overflow: ellipsis;">
        <div v-for="channel in channelLists" :key="channel.channelId">
          <div class="px-4 py-2 hover:bg-gray-700/50 cursor-pointer flex flex-col"
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
                  <MicOffIcon v-if="user.isMuted" width="20" height="20" style="margin-left: auto;" />
                  <ScreenShare v-if="user.isScreenShare" width="20" height="20" style="margin-left: auto;" />
                  <RadiusIcon v-if="user.isRecording" width="20" height="20" style="margin-left: auto; color: red;" />
                </li>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-64">
                <ContextMenuLabel v-show="user.userId != me.me?.userId">
                  <!-- @vue-ignore -->
                  <VolumeSlider :user="user"/>
                </ContextMenuLabel>
                <!-- <ContextMenuItem inset @click="voice.muteForMeUser(user.UserId)">
                    Mute
                    <ContextMenuShortcut>⌘[</ContextMenuShortcut>
                  </ContextMenuItem>-->
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
</template>

<script setup lang="ts">
import { useSpaceStore } from "@/store/serverStore";
import {
  HashIcon,
  Volume2Icon,
  AntennaIcon,
  MicOffIcon,
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
import { ChannelType } from "@/lib/glue/argonChat";
import VolumeSlider from "./VolumeSlider.vue";
import { watch } from "vue";
import { useUnifiedCall } from "@/store/unifiedCallStore";

const servers = useSpaceStore();
const pool = usePoolStore();
const voice = useUnifiedCall();
const me = useMe();
const pex = usePexStore();
const api = useApi();
const { t } = useLocale();

const selectedSpaceId = defineModel<string>('selectedSpace', {
    type: String, required: true
})
const selectedChannelId = defineModel<string>('selectedChannelId', {
    type: String, required: true
})

const channelLists = pool.useActiveServerChannels(selectedSpaceId);

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
  /*const channel = servers.getDetailsOfChannel(channelId);

  if (!channel) return;
  if (channel.ChannelType == "Voice") {
    connectToChannel(channel.Id);
    return;
  }*/
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
</style>