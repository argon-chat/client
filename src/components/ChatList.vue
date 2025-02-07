<template>
  <div class="chat-list min-w-[250px]">
    <div class="flex flex-col">
      <div class="p-4 border-b border-gray-700 flex justify-between items-center" v-if="pool.selectedServer">
        <h2 class="text-lg font-bold">{{ pool.getSelectedServer?.Name }}</h2>
        <button class="text-gray-400 hover:text-white" @click="windows.serverSettingsOpen = true">
          <CloverIcon class="w-5 h-5" />
        </button>

        <Dialog v-model:open="addChannelOpened">
          <DialogTrigger as-child>
            <button v-pex="'ManageBehaviour'" class="text-gray-400 hover:text-white">
              <PlusIcon class="w-5 h-5" />
            </button>
          </DialogTrigger>
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

      <div class="flex-1 overflow-y-auto py-4 ">



        <div v-if="pool.selectedServer" v-for="channel in pool.activeServerChannels.value" :key="channel.Id"
          class="px-4 py-2 hover:bg-gray-700 cursor-pointer flex flex-col " v-on:click="channelSelect(channel.Id)">

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
              <ul
                v-if="channel.ChannelType === 'Voice' && pool.realtimeChannelUsers.has(channel.Id) && pool.realtimeChannelUsers.get(channel.Id)?.Users.size != 0"
                class="ml-3 mt-2 space-y-2">
                <li v-for="user in pool.realtimeChannelUsers.get(channel.Id)!.Users.values()" :key="user.UserId"
                  class="flex items-center mt-1 text-gray-400 hover:text-white">
                  <ArgonAvatar :fallback="user.User.DisplayName" :fileId="user.User.AvatarFileId!" :userId="user.UserId"
                    :style="(user.isSpeaking ? 'outline: solid #45d110 2px; outline-offset: 4px; border-radius: 500px;' : '')"
                    class="w-7 h-7 rounded-full mr-3" />
                  <span>{{ user.User.DisplayName }}</span>
                </li>
              </ul>

            </ContextMenuTrigger>
            <ContextMenuContent class="w-64">
              <ContextMenuItem inset>
                Back
                <ContextMenuShortcut>⌘[</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem inset disabled>
                Forward
                <ContextMenuShortcut>⌘]</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem inset>
                Reload
                <ContextMenuShortcut>⌘R</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger inset>
                  More Tools
                </ContextMenuSubTrigger>
                <ContextMenuSubContent class="w-48">
                  <ContextMenuItem>
                    Save Page As...
                    <ContextMenuShortcut>⇧⌘S</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem>Create Shortcut...</ContextMenuItem>
                  <ContextMenuItem>Name Window...</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem>Developer Tools</ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuCheckboxItem checked>
                Show Bookmarks Bar
                <ContextMenuShortcut>⌘⇧B</ContextMenuShortcut>
              </ContextMenuCheckboxItem>
              <ContextMenuCheckboxItem>Show Full URLs</ContextMenuCheckboxItem>
              <ContextMenuSeparator />
              <ContextMenuRadioGroup model-value="pedro">
                <ContextMenuLabel inset>
                  People
                </ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuRadioItem value="pedro">
                  Pedro Duarte
                </ContextMenuRadioItem>
                <ContextMenuRadioItem value="colm">
                  Colm Tuite
                </ContextMenuRadioItem>
              </ContextMenuRadioGroup>
            </ContextMenuContent>
          </ContextMenu>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useServerStore } from '@/store/serverStore';
import {
  HashIcon, Volume2Icon, PlusIcon, MoreVerticalIcon, Edit2Icon, Trash2Icon,
  CopyCheckIcon, MessageSquareLock, CloverIcon, AntennaIcon
} from 'lucide-vue-next';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ref } from 'vue';
import { logger } from '@/lib/logger';
import { useWindow } from '@/store/windowStore';
import { usePoolStore } from '@/store/poolStore';
import { useVoice } from '@/store/voiceStore';
import ArgonAvatar from './ArgonAvatar.vue';

const channelType = ref("" as "Text" | "Voice" | "Announcement");
const channelName = ref("");
const addChannelOpened = ref(false);
const addChannel_Loading = ref(false);
const servers = useServerStore();
const windows = useWindow();
const pool = usePoolStore();
const voice = useVoice();


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

async function channelDelete(channelId: string) {
  await servers.deleteChannel(channelId);
}


const connectToChannel = (channelId: string) => {
  //servers.connectTo(channelId);
};
</script>

<style scoped>
.chat-list {
  background-color: #2f3136;
  padding: 10px;
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  margin-bottom: 10px;
  height: 95%;
}

.hover\:bg-gray-700:hover {
  border-radius: 5px;
}
</style>