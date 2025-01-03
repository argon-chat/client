<template>
  <div class="chat-list min-w-[250px]">
    <div class="flex flex-col">
      <div class="p-4 border-b border-gray-700 flex justify-between items-center">
        <h2 class="text-lg font-bold">{{ servers.activeServer?.Name }}</h2>
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
              <Button type="submit" @click="addChannel" :disabled="addChannel_Loading">
                Create Channel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


      </div>

      <div class="flex-1 overflow-y-auto py-4 ">
        <div v-if="servers.activeServer" v-for="channel in servers.activeServer.Channels" :key="channel.Id"
          class="px-4 py-2 hover:bg-gray-700 cursor-pointer flex flex-col ">
          <div class="flex items-center justify-between group" v-on:click="channelSelect(channel.Id)">
            <div class="flex items-center space-x-2">
              <HashIcon v-if="channel.ChannelType === 'Text'" class="w-5 h-5 text-gray-400" />
              <Volume2Icon v-else-if="channel.ChannelType === 'Voice'" class="w-5 h-5 text-gray-400" />
              <span>{{ channel?.Name }}</span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button class="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity hover:text-white">
                  <MoreVerticalIcon class="w-5 h-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent class="w-56">
                <DropdownMenuLabel>Channel {{ channel.Name }}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <span style="color: cornflowerblue;">Mark As Read</span>
                    <DropdownMenuShortcut>
                      <CopyCheckIcon :size="18" />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <span>Copy Link</span>
                    <DropdownMenuShortcut>
                      <MessageSquareLock :size="18" />
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup v-if="false">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <span>Mute Channel</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem>
                          <span>Email</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <span>Message</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>
                          <span>More...</span>
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                  <DropdownMenuItem>
                    <span>New Team</span>
                    <DropdownMenuShortcut>⌘+T</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuItem @click="channelDelete(channel.Id)">
                  <span style="color: red;">Delete Channel</span>
                  <DropdownMenuShortcut>
                    <Trash2Icon :size="18" />
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <span>Edit Channel</span>
                  <DropdownMenuShortcut>
                    <Edit2Icon :size="18" />
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <ul v-if="channel.ChannelType === 'Voice' && servers.currentChannelUsers.length != 0" class="ml-7 space-y-1">
            <li v-for="user in servers.currentChannelUsers" :key="user.Id"
              class="flex items-center text-gray-400 hover:text-white">
              <img :src="user.AvatarFileId" alt="User Avatar" class="w-6 h-6 rounded-full mr-2" />
              <span>{{ user.DisplayName }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useServerStore } from '@/store/serverStore';
import {
  HashIcon, Volume2Icon, PlusIcon, MoreVerticalIcon, Edit2Icon, Trash2Icon,
  CopyCheckIcon, MessageSquareLock, CloverIcon
} from 'lucide-vue-next';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ref } from 'vue';
import { logger } from '@/lib/logger';
import { useWindow } from '@/store/windowStore';

const channelType = ref("" as "Text" | "Voice" | "Announcement");
const channelName = ref("");
const addChannelOpened = ref(false);
const addChannel_Loading = ref(false);
const servers = useServerStore();
const windows = useWindow();

const addChannel = () => {
  addChannel_Loading.value = true;
  logger.info(`Creation channel: ${channelType.value}, ${channelName.value}`);
  servers.addChannelToServer(channelName.value, channelType.value);

  setTimeout(() => {
    addChannel_Loading.value = false;
    addChannelOpened.value = false;
  }, 1000);
};

function channelSelect(channelId: string) {
  logger.info(`Do action for channel '${channelId}'`);
  const channel = servers.getDetailsOfChannel(channelId);

  if (!channel) return;
  if (channel.ChannelType == "Voice") {
    connectToChannel(channel.Id);
    return;
  }
}

function channelDelete(channelId: string) {
  servers.deleteChannel(channelId);
}


const connectToChannel = (channelId: string) => {
  servers.connectTo(channelId);
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