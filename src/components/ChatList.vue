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
              <Button type="submit" @click="addChannel" :disabled="addChannel_Loading">
                Create Channel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


      </div>

      <div class="flex-1 overflow-y-auto py-4 ">
        <div v-if="pool.selectedServer" v-for="channel in pool.activeServerChannels.value" :key="channel.Id"
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
          <ul v-if="channel.ChannelType === 'Voice' && pool.realtimeChannelUsers.has(channel.Id) &&  pool.realtimeChannelUsers.get(channel.Id)?.Users.size != 0"
            class="ml-10 mt-2 space-y-2">
            <li v-for="user in pool.realtimeChannelUsers.get(channel.Id)!.Users.values()" :key="user.UserId"
              class="flex items-center mt-1 text-gray-400 hover:text-white">
              <ArgonAvatar :fallback="user.User.DisplayName" :fileId="user.User.AvatarFileId!" :userId="user.UserId"
                class="w-7 h-7 rounded-full mr-3" />
              <span>{{ user.User.DisplayName }}</span>
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
import { usePoolStore } from '@/store/poolStore';
import { useVoice } from '@/store/voiceStore';
import ArgonAvatar from './ArgonAvatar.vue';
import { useSessionTimer } from '@/store/sessionTimer'

const channelType = ref("" as "Text" | "Voice" | "Announcement");
const channelName = ref("");
const addChannelOpened = ref(false);
const addChannel_Loading = ref(false);
const servers = useServerStore();
const windows = useWindow();
const pool = usePoolStore();
const voice = useVoice();
const sessionTimerStore = useSessionTimer()


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
  try {
    await servers.deleteChannel(channelId);
    sessionTimerStore.stopTimer()
  } catch (error) {
    logger.error('Failed to delete channel:', error)
  }
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