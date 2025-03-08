<template>
  <div style="display: contents;">
    <div class="header-list rounded-t-lg overflow-hidden bg-cover bg-no-repeat bg-center contrast-125"
      :style="{ backgroundImage: 'url(https://i.ppy.sh/f3bd9efc54c8464c7cfba57e7a8b8b6953444175/68747470733a2f2f612d7374617469632e62657374686477616c6c70617065722e636f6d2f6461726c696e672d64616e732d6c652d6672616e78782d7a65726f2d74776f2d666f6e642d642d656372616e2d32353630783936302d33333638395f38372e6a7067)' }"
      v-if="pool.selectedServer">

      <div class="relative p-4 flex justify-between items-center border-b " v-if="pool.selectedServer">
        <h2 class="text-lg font-bold relative z-10 text-white ">
          {{ pool.getSelectedServer?.Name }}
        </h2>
        <DropdownMenu :modal="serverDropdownIsActive">
          <DropdownMenuTrigger as-child class="backdrop-blur-md">
            <button v-show="isAdmin">
              <MoreVerticalIcon />
            </button>

          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem @click="openServerSettings">Server Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="addChannelOpened = true">Add Channel</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <div class="chat-list rounded-b-lg scroll-smooth">
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
                  <ContextMenuItem inset :disabled="!isAdmin" @click="channelDelete(channel.Id)">
                    Delete
                    <ContextMenuShortcut>⌘[</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem inset :disabled="!isAdmin">
                    Leave
                    <ContextMenuShortcut>⌘]</ContextMenuShortcut>
                  </ContextMenuItem>

                  <ContextMenuSeparator />
                  <ContextMenuCheckboxItem :disabled="!isAdmin">
                   Mute
                    <ContextMenuShortcut>⌘⇧B</ContextMenuShortcut>
                  </ContextMenuCheckboxItem>
                </ContextMenuContent>
              </ContextMenu>
            </div>
            <ul
              v-if="channel.ChannelType === 'Voice' && pool.realtimeChannelUsers.has(channel.Id) && pool.realtimeChannelUsers.get(channel.Id)?.Users.size != 0"
              class="ml-3 space-y-2 px-4 pb-2 cursor-pointer flex flex-col">
              <li v-for="user in pool.realtimeChannelUsers.get(channel.Id)!.Users.values()" :key="user.UserId"
                class="flex items-center mt-1 text-gray-400 hover:text-white">
                <ArgonAvatar :fallback="user.User.DisplayName" :fileId="user.User.AvatarFileId!" :userId="user.UserId"
                  :style="(user.isSpeaking ? 'outline: solid #45d110 2px; outline-offset: 2px; border-radius: 500px;' : '')"
                  class="w-7 h-7 rounded-full mr-3 transition" />
                <span>{{ user.User.DisplayName }}</span>
                <MicOffIcon v-if="user.isMuted" width="20" height="20" style="margin-left: auto;"/>
                <ScreenShare v-if="user.isScreenShare" width="20" height="20" style="margin-left: auto;"/>
              </li>
            </ul>


          </div>
        </div>
      </div>
    </div>

    <Dialog v-model:open="addChannelOpened">
      <DialogContent class="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add channel</DialogTitle>
        </DialogHeader>
        <div class="grid gap-4 py-4">
          <div class="grid grid-cols-4 items-center gap-4">
            <Label for="channel-name" class="text-right">
              Name
            </Label>
            <Input id="channel-name" v-model="channelName" class="col-span-3" />
          </div>
          <div class="grid grid-cols-4 items-center gap-4">
            <Label for="channel-type" class="text-right">
              Type
            </Label>
            <RadioGroup id="channel-type" v-model="channelType" :orientation="'vertical'">
              <div class="flex items-center space-x-2">
                <RadioGroupItem id="r1" value="Text" />
                <Label for="r1">
                  <Badge>Text</Badge>
                </Label>
              </div>
              <div class="flex items-center space-x-2">
                <RadioGroupItem id="r2" value="Voice" />
                <Label for="r2">
                  <Badge>Voice</Badge>
                </Label>
              </div>
              <div class="flex items-center space-x-2">
                <RadioGroupItem id="r3" value="Announcement" />
                <Label for="r3">
                  <Badge>Announcement</Badge>
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <DialogClose as-child>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" @click="addChannel">
            Create Channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>

</template>

<script setup lang="ts">
import { useServerStore } from '@/store/serverStore';
import {
  HashIcon, Volume2Icon, MoreVerticalIcon, AntennaIcon, MicOffIcon, ScreenShare
} from 'lucide-vue-next';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { computed, ref } from 'vue';
import { logger } from '@/lib/logger';
import { useWindow } from '@/store/windowStore';
import { usePoolStore } from '@/store/poolStore';
import { useVoice } from '@/store/voiceStore';
import ArgonAvatar from './ArgonAvatar.vue';
import { useMe } from '@/store/meStore';

const serverDropdownIsActive = ref(false);
const channelType = ref("" as "Text" | "Voice" | "Announcement");
const channelName = ref("");
const addChannelOpened = ref(false);
const addChannel_Loading = ref(false);
const servers = useServerStore();
const windows = useWindow();
const pool = usePoolStore();
const voice = useVoice();
const me = useMe();


const isAdmin = computed(() => true);


const addChannel = () => {
  addChannel_Loading.value = true;
  logger.info(`Creation channel: ${channelType.value}, ${channelName.value}`);
  servers.addChannelToServer(channelName.value, channelType.value);

  setTimeout(() => {
    addChannel_Loading.value = false;
    addChannelOpened.value = false;
  }, 1000);
};

async function channelSelect(channelId: string) {
  logger.info(`Do action for channel '${channelId}'`);
  const channel = await pool.getChannel(channelId);

  if (!channel) return;
  if (channel.ChannelType == "Voice") {
    await voice.connectToChannel(channelId);
  }
  /*const channel = servers.getDetailsOfChannel(channelId);

  if (!channel) return;
  if (channel.ChannelType == "Voice") {
    connectToChannel(channel.Id);
    return;
  }*/
}

async function openServerSettings() {
  serverDropdownIsActive.value = false;
  windows.serverSettingsOpen = true;
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
  background-color: #161616;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  margin-bottom: 10px;
  height: 95%;
}

.hover\:bg-gray-700:hover {
  border-radius: 5px;
}


</style>