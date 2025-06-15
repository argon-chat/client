<template>
  <div class="chat-list rounded-xl scroll-smooth">
    <div class="flex flex-col">
      <div class="flex-1 overflow-y-auto py-4 overflow-x-hidden" style="text-overflow: ellipsis;">
        <div v-if="pool.selectedServer" v-for="channel in pool.activeServerChannels.value" :key="channel.Id">
          <div class="px-4 py-2 hover:bg-gray-700/50 cursor-pointer flex flex-col"
            v-on:click="channelSelect(channel.Id)">
            <ContextMenu>
              <ContextMenuTrigger>
                <div class="flex items-center justify-between group">
                  <div class="flex items-center space-x-2">
                    <HashIcon v-if="channel.ChannelType === 'Text'" class="w-5 h-5 text-gray-400" />
                    <Volume2Icon v-else-if="channel.ChannelType === 'Voice'" class="w-5 h-5 text-gray-400" />
                    <AntennaIcon v-else-if="channel.ChannelType === 'Announcement'" class="w-5 h-5 text-gray-400" />
                    <span>{{ channel?.Name }}</span>
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-64">
                <ContextMenuItem inset :disabled="!pex.has('ManageChannels')" @click="channelDelete(channel.Id)">
                  Delete
                  <ContextMenuShortcut>⌘[</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem inset :disabled="true">
                  Leave
                  <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                </ContextMenuItem>

                <ContextMenuSeparator />
                <ContextMenuCheckboxItem :disabled="!pex.has('MuteMember')">
                  Mute
                  <ContextMenuShortcut>⌘⇧B</ContextMenuShortcut>
                </ContextMenuCheckboxItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
          <ul
            v-if="channel.ChannelType === 'Voice' && pool.realtimeChannelUsers.has(channel.Id) && pool.realtimeChannelUsers.get(channel.Id)?.Users.size != 0"
            class="ml-3 space-y-2 px-4 pb-2 cursor-pointer flex flex-col">
            <ContextMenu v-for="user in pool.realtimeChannelUsers.get(channel.Id)!.Users.values()" :key="user.UserId">
              <ContextMenuTrigger :disabled="!voice.activeChannel">
                <li class="flex items-center mt-1 text-gray-400 hover:text-white">
                  <ArgonAvatar :fallback="user.User.DisplayName" :fileId="user.User.AvatarFileId!" :userId="user.UserId"
                    :style="(user.isSpeaking ? 'outline: solid #45d110 2px; outline-offset: 2px; border-radius: 500px;' : '')"
                    class="w-7 h-7 rounded-full mr-3 transition" />
                  <span>{{ user.User.DisplayName }}</span>
                  <MicOffIcon v-if="user.isMuted" width="20" height="20" style="margin-left: auto;" />
                  <ScreenShare v-if="user.isScreenShare" width="20" height="20" style="margin-left: auto;" />
                </li>
              </ContextMenuTrigger>
              <ContextMenuContent class="w-64">
                <ContextMenuLabel v-show="user.UserId != me.me?.Id">
                  <Slider :max="200" :step="1" v-model="user.volume"
                    v-on:update:model-value="(val) => { voice.setUserVolume(user.UserId, val![0]); }" />
                </ContextMenuLabel>
                <!-- <ContextMenuItem inset @click="voice.muteForMeUser(user.UserId)">
                    Mute
                    <ContextMenuShortcut>⌘[</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem inset :disabled="true">
                    Kick
                    <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                  </ContextMenuItem> -->

                <ContextMenuSeparator v-show="user.UserId != me.me?.Id" />
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
import { useServerStore } from "@/store/serverStore";
import {
  HashIcon,
  Volume2Icon,
  AntennaIcon,
  MicOffIcon,
  ScreenShare,
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
import { useVoice } from "@/store/voiceStore";
import ArgonAvatar from "./ArgonAvatar.vue";
import { useMe } from "@/store/meStore";
import delay from "@/lib/delay";
import { onMounted } from "vue";
import { usePexStore } from "@/store/permissionStore";

const servers = useServerStore();
const pool = usePoolStore();
const voice = useVoice();
const me = useMe();
const pex = usePexStore();
//

onMounted(async () => {
  await delay(1000);
});

async function channelSelect(channelId: string) {
  logger.info(`Do action for channel '${channelId}'`);
  const channel = await pool.getChannel(channelId);

  if (channel && channel.ChannelType !== "Voice") {
    pool.selectedTextChannel = channel.Id;
  }

  if (voice.activeChannel) {
    return;
  }

  if (!channel) return;
  if (channel.ChannelType === "Voice") {
    await voice.connectToChannel(channelId);
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