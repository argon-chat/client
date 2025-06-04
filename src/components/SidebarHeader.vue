<template>
    <div class="header-list overflow-hidden bg-cover bg-no-repeat bg-center contrast-125 rounded-xl min-h-[8rem]"
        :style="{ backgroundImage: 'url(https://i.ppy.sh/f3bd9efc54c8464c7cfba57e7a8b8b6953444175/68747470733a2f2f612d7374617469632e62657374686477616c6c70617065722e636f6d2f6461726c696e672d64616e732d6c652d6672616e78782d7a65726f2d74776f2d666f6e642d642d656372616e2d32353630783936302d33333638395f38372e6a7067)' }"
        v-if="pool.selectedServer">

        <div class="relative p-4 flex justify-between items-center " v-if="pool.selectedServer">
            <h2 class="text-lg font-bold relative z-10 text-white ">
                {{ pool.getSelectedServer?.Name }}
            </h2>
            <DropdownMenu :modal="serverDropdownIsActive">
                <DropdownMenuTrigger as-child class="backdrop-blur-md">
                    <button v-show="IsMeOwnerOfCurrentServer">
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
</template>
<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import {
    MoreVerticalIcon
} from 'lucide-vue-next';
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
import { usePoolStore } from '@/store/poolStore';
import { logger } from '@/lib/logger';
import { useServerStore } from '@/store/serverStore';
import delay from '@/lib/delay';
import { useWindow } from '@/store/windowStore';
const pool = usePoolStore();
const servers = useServerStore();
const channelType = ref("" as "Text" | "Voice" | "Announcement");
const channelName = ref("");
const addChannelOpened = ref(false);
const addChannel_Loading = ref(false);
const serverDropdownIsActive = ref(false);
const IsMeOwnerOfCurrentServer = ref(false);
const windows = useWindow();

onMounted(async () => {
  await delay(1000);
  IsMeOwnerOfCurrentServer.value = await servers.IsIAmAdmin();
})

async function openServerSettings() {
  serverDropdownIsActive.value = false;
  windows.serverSettingsOpen = true;
}

const addChannel = () => {
  addChannel_Loading.value = true;
  logger.info(`Creation channel: ${channelType.value}, ${channelName.value}`);
  servers.addChannelToServer(channelName.value, channelType.value);

  setTimeout(() => {
    addChannel_Loading.value = false;
    addChannelOpened.value = false;
  }, 1000);
};
</script>
